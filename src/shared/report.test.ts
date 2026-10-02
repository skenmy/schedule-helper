import { describe, expect, it } from 'vitest';
import { buildReport, reportCsv } from './report.ts';
import type { RoomState, Schedule, ScheduleLine } from './types.ts';

const MIN = 60_000;
const T0 = Date.UTC(2026, 4, 24, 10, 0, 0);

function line(
  key: string,
  start: number,
  estMin: number,
  extra: Partial<ScheduleLine> = {},
): ScheduleLine {
  return {
    key,
    game: `Game ${key}`,
    category: 'Any%',
    console: 'PC',
    type: 'SINGLE',
    runners: [`runner-${key}`],
    estimateSec: estMin * 60,
    setupSec: 10 * 60,
    scheduledStart: start,
    setupBlock: false,
    setupBlockText: '',
    ...extra,
  };
}

// a: 10:00–10:30, b: 10:40–11:40, interview: 11:50–12:00, c: 12:10–12:30
const LINES: ScheduleLine[] = [
  line('a', T0, 30),
  line('b', T0 + 40 * MIN, 60),
  line('s', T0 + 110 * MIN, 10, { setupBlock: true, setupBlockText: 'Interview', runners: [] }),
  line('c', T0 + 130 * MIN, 20, { setupSec: 0 }),
];

const schedule = (lines = LINES): Schedule => ({
  ref: { source: 'oengus', event: 'uksg', slug: 'main' },
  eventName: 'UKSG Autumn',
  scheduleName: 'Main',
  twitch: '',
  lines,
  fetchedAt: 0,
});

function state(partial: Partial<RoomState> = {}): RoomState {
  return {
    rev: 0,
    currentKey: null,
    finishedAt: null,
    runs: {},
    log: [],
    logSeq: 0,
    message: null,
    announcement: null,
    twitchChannel: '',
    drift: { enabled: false, intervalMin: 5, thresholdSec: 10 },
    capture: null,
    captureBusy: false,
    tracking: { twitch: false, vision: false, autoApply: false },
    detection: null,
    settled: null,
    stream: null,
    undo: null,
    updatedAt: 0,
    ...partial,
  };
}

// a ran 10:02–10:35 (+3m), b 10:47–11:40 (−7m), c 12:05–12:30 (+5m); finished 12:31.
const FINISHED = state({
  finishedAt: T0 + 151 * MIN,
  runs: {
    a: { startedAt: T0 + 2 * MIN, endedAt: T0 + 35 * MIN },
    b: { startedAt: T0 + 47 * MIN, endedAt: T0 + 100 * MIN },
    c: { startedAt: T0 + 125 * MIN, endedAt: T0 + 150 * MIN },
  },
});

describe('buildReport', () => {
  it('compares a finished marathon with its schedule', () => {
    const r = buildReport(schedule(), FINISHED, T0 + 200 * MIN);
    expect(r).toMatchObject({
      event: { name: 'UKSG Autumn', schedule: 'Main' },
      complete: true,
      scheduledStart: T0,
      scheduledEnd: T0 + 150 * MIN,
      actualStart: T0 + 2 * MIN,
      actualEnd: T0 + 151 * MIN,
      projectedEnd: null,
      likelyEnd: null,
      runs: { total: 3, done: 3, skipped: 0 },
      runTimeSec: 111 * 60,
      runEstimateSec: 110 * 60,
    });
  });

  it('works out each run: time taken, start against schedule, and the changeover after it', () => {
    const [a, b, s, c] = buildReport(schedule(), FINISHED, T0 + 200 * MIN).rows;
    expect(a).toMatchObject({
      number: 1,
      status: 'done',
      actualSec: 33 * 60,
      overSec: 3 * 60,
      startDeltaSec: -2 * 60,
      changeoverSec: 12 * 60,
      plannedChangeoverSec: 10 * 60,
    });
    // The interview sits in b's changeover: 10m setup + 10m interview + its 10m setup.
    expect(b).toMatchObject({
      number: 2,
      overSec: -7 * 60,
      startDeltaSec: -7 * 60,
      changeoverSec: 25 * 60,
      plannedChangeoverSec: 30 * 60,
    });
    expect(s).toMatchObject({ number: null, status: 'interlude', startedAt: null });
    expect(c).toMatchObject({ number: 3, startDeltaSec: 5 * 60, changeoverSec: null });
  });

  it('takes the median changeover against plan, and ranks over- and underruns', () => {
    const r = buildReport(schedule(), FINISHED, T0 + 200 * MIN);
    expect(r.changeoverDeltaSec).toBe(-90); // median of +2m and −5m
    expect(r.overruns.map((x) => x.key)).toEqual(['c', 'a']);
    expect(r.underruns.map((x) => x.key)).toEqual(['b']);
  });

  it('reports a marathon in progress with where it is headed', () => {
    const now = T0 + 60 * MIN;
    const r = buildReport(
      schedule(),
      state({
        currentKey: 'b',
        runs: {
          a: { startedAt: T0 + 2 * MIN, endedAt: T0 + 35 * MIN },
          b: { startedAt: T0 + 47 * MIN },
        },
      }),
      now,
    );
    expect(r.complete).toBe(false);
    expect(r.actualEnd).toBeNull();
    // b ends 11:47; 10m setup + 10m interview + 10m setup; c 20m → 12:37.
    expect(r.projectedEnd).toBe(T0 + 157 * MIN);
    expect(r.likelyEnd).toBeNull(); // too few runs finished to know the pace
    expect(r.rows.map((x) => x.status)).toEqual(['done', 'live', 'interlude', 'upcoming']);
    expect(r.rows[1]).toMatchObject({ actualSec: null, overSec: null, startDeltaSec: -7 * 60 });
  });

  it('leaves skipped runs out of the timings', () => {
    const r = buildReport(
      schedule(),
      state({
        finishedAt: T0 + 140 * MIN,
        runs: {
          a: { startedAt: T0, endedAt: T0 + 30 * MIN },
          b: { skipped: true },
          c: { startedAt: T0 + 40 * MIN, endedAt: T0 + 60 * MIN },
        },
      }),
      T0 + 200 * MIN,
    );
    expect(r.runs).toEqual({ total: 3, done: 2, skipped: 1 });
    expect(r.rows[1]).toMatchObject({ status: 'skipped', actualSec: null, changeoverSec: null });
    // a's changeover runs to c, the next run played: its setup and the interview were planned, not b.
    expect(r.rows[0]).toMatchObject({ changeoverSec: 10 * 60, plannedChangeoverSec: 30 * 60 });
    expect(r.runTimeSec).toBe(50 * 60);
  });

  it('has nothing to say before the marathon starts', () => {
    const r = buildReport(schedule(), state(), T0 - 60 * MIN);
    expect(r).toMatchObject({
      actualStart: null,
      runs: { total: 3, done: 0, skipped: 0 },
      changeoverDeltaSec: null,
      overruns: [],
      underruns: [],
    });
  });
});

describe('reportCsv', () => {
  it('writes one row per line with ISO times, H:MM:SS durations and signed seconds', () => {
    const csv = reportCsv(buildReport(schedule(), FINISHED, T0 + 200 * MIN));
    const rows = csv.trimEnd().split('\r\n');
    expect(rows).toHaveLength(5);
    expect(rows[0]).toBe(
      'number,title,category,runners,status,scheduled_start,started,ended,estimate,actual,over_estimate_sec,start_vs_schedule_sec,changeover,planned_changeover',
    );
    expect(rows[1]).toBe(
      '1,Game a,Any%,runner-a,done,2026-05-24T10:00:00.000Z,2026-05-24T10:02:00.000Z,2026-05-24T10:35:00.000Z,00:30:00,00:33:00,180,-120,00:12:00,00:10:00',
    );
    expect(rows[3]).toMatch(/^,Interview,/);
    expect(csv.endsWith('\r\n')).toBe(true);
  });

  it('quotes commas and quotes, and keeps names from running as spreadsheet formulas', () => {
    const lines = [
      line('x', T0, 30, {
        game: 'Say "Hi", World',
        runners: ['=HYPERLINK("http://evil")', '-dash', 'plain'],
        category: '+any%',
      }),
    ];
    const csv = reportCsv(buildReport(schedule(lines), state(), T0));
    const row = csv.split('\r\n')[1]!;
    expect(row).toContain('"Say ""Hi"", World"');
    expect(row).toContain(`'+any%`);
    expect(row).toContain(`"'=HYPERLINK(""http://evil""), -dash, plain"`);
  });
});
