import { describe, expect, it } from 'vitest';
import type { RoomRef, RoomState, Schedule, ScheduleLine } from '../../shared/types.ts';
import { Room } from '../rooms/room.ts';
import { initialState } from '../rooms/state.ts';
import { matchRunData } from './match.ts';
import { nodecgReport, readReport } from './nodecg.ts';

const MIN = 60_000;
const T0 = Date.UTC(2026, 4, 24, 10, 0, 0);
const mk = (key: string, i: number, extra: Partial<ScheduleLine> = {}): ScheduleLine => ({
  key,
  game: `Game ${key}`,
  category: 'Any%',
  console: '',
  type: 'SINGLE',
  runners: [`r${key}`],
  estimateSec: 1800,
  setupSec: 600,
  scheduledStart: T0 + i * 40 * MIN,
  setupBlock: false,
  setupBlockText: '',
  ...extra,
});
// Oengus keys; o102 and o103 are the same game, told apart by category and runner.
const LINES = [
  mk('o101', 0, { game: 'Celeste' }),
  mk('o102', 1, { game: 'Super Mario 64', category: '16 Star', runners: ['ptkay'] }),
  mk('o103', 2, { game: 'Super Mario 64', category: '70 Star', runners: ['cheese'] }),
  mk('o104', 3, { game: 'Hades' }),
];
const REF: RoomRef = { source: 'oengus', event: 'nodecg', slug: 'main' };

function live(partial: Partial<RoomState> = {}): RoomState {
  return { ...initialState(), currentKey: 'o101', runs: { o101: { startedAt: T0 } }, ...partial };
}

describe('matchRunData', () => {
  it('trusts the Oengus line ID speedcontrol imported', () => {
    expect(matchRunData(LINES, live(), { externalID: 103, game: 'whatever' })?.key).toBe('o103');
  });

  it('otherwise matches the game, using category and runners between runs of it', () => {
    const s = live();
    expect(matchRunData(LINES, s, { game: 'Super Mario 64', players: ['cheese'] })?.key).toBe(
      'o103',
    );
    expect(matchRunData(LINES, s, { game: 'super mario 64', category: '16 star' })?.key).toBe(
      'o102',
    );
    expect(matchRunData(LINES, s, { game: 'Tetris' })).toBeNull();
  });

  it('never guesses past a run ID it knows: speedcontrol lagging behind matches nothing', () => {
    // Operators moved on to o102; speedcontrol still shows o101, a run of a game that
    // also appears later. The ID names o101, which can't be live: no match at all.
    const lines = [...LINES, mk('o105', 4, { game: 'Celeste', category: 'Any% B-sides' })];
    const s = live({ currentKey: 'o102', runs: { o102: { startedAt: T0 } } });
    expect(matchRunData(lines, s, { externalID: 101, game: 'Celeste' })).toBeNull();
    // An ID we don't know (a run added in speedcontrol only) falls back to the game.
    expect(matchRunData(lines, s, { externalID: 999, game: 'Celeste' })?.key).toBe('o105');
  });

  it('only looks at the live run and the next few', () => {
    const s = live({ currentKey: 'o104', runs: { o104: { startedAt: T0 } } });
    expect(matchRunData(LINES, s, { externalID: 101, game: 'Celeste' })).toBeNull();
  });
});

describe('readReport', () => {
  it('turns a running timer on the next run into a start time, whatever the PC’s clock says', () => {
    const now = T0 + 45 * MIN;
    const { status, signal } = readReport(
      LINES,
      live(),
      {
        via: 'bundle',
        run: { externalID: '102', game: 'Super Mario 64', players: [] },
        timer: { state: 'running', elapsedMs: 90_000 },
      },
      now,
    );
    expect(status).toMatchObject({ runKey: 'o102', timer: 'running', elapsedSec: 90 });
    expect(signal).toMatchObject({
      runKey: 'o102',
      source: 'nodecg',
      startedAt: now - 90_000,
      detail: 'speedcontrol run ID, timer 00:01:30',
    });
  });

  it('reports a stopped timer without a start, and an unknown run without a signal', () => {
    const r = readReport(
      LINES,
      live(),
      {
        via: 'bridge',
        run: { game: 'Hades', players: [] },
        timer: { state: 'stopped', elapsedMs: 0 },
      },
      T0,
    );
    expect(r.signal).toMatchObject({ runKey: 'o104', startedAt: null });
    const none = readReport(LINES, live(), { via: 'bridge', run: null, timer: null }, T0);
    expect(none.signal).toBeNull();
    expect(none.status).toMatchObject({ game: null, runKey: null, timer: null });
  });
});

describe('readReport: finishes', () => {
  const celeste = { game: 'Celeste', players: [] };
  const report = (state: 'running' | 'paused' | 'finished' | 'stopped', elapsedMs: number) => ({
    via: 'bundle' as const,
    run: celeste,
    timer: { state, elapsedMs },
  });
  /** Feeds reports in order, keeping the status as the room would. */
  function feed(steps: [at: number, r: ReturnType<typeof report>][]) {
    const state = live();
    let last: ReturnType<typeof readReport> | null = null;
    for (const [at, r] of steps) {
      last = readReport(LINES, state, r, at);
      state.nodecg = last.status;
    }
    return last!;
  }

  it('times the finish from the start it saw while running plus the final time', () => {
    // Running since T0 + 5 s (as the stream PC measures it), finished at 40:00.
    const r = feed([
      [T0 + MIN, report('running', 55_000)],
      [T0 + 41 * MIN, report('finished', 40 * MIN)],
    ]);
    expect(r.status).toMatchObject({ timer: 'finished', startedAt: T0 + 5_000 });
    expect(r.signal).toMatchObject({
      runKey: 'o101',
      startedAt: null,
      endedAt: T0 + 5_000 + 40 * MIN,
      detail: 'speedcontrol: Celeste, finished in 00:40:00',
    });
  });

  it('keeps the finish where it was as heartbeats come in, and counts pauses', () => {
    const r = feed([
      [T0 + MIN, report('running', 60_000)],
      [T0 + 10 * MIN, report('paused', 9 * MIN)],
      // A minute's pause: after it, the start it implies is a minute later.
      [T0 + 12 * MIN, report('running', 10 * MIN)],
      [T0 + 31 * MIN, report('finished', 29 * MIN)],
      [T0 + 33 * MIN, report('finished', 29 * MIN)],
    ]);
    expect(r.signal?.endedAt).toBe(T0 + 2 * MIN + 29 * MIN);
  });

  it('offers no finish time when it never saw the timer running', () => {
    const r = feed([[T0 + 41 * MIN, report('finished', 40 * MIN)]]);
    expect(r.signal).toMatchObject({ runKey: 'o101', endedAt: null });
  });
});

describe('nodecgReport', () => {
  function room(autoApply: boolean) {
    const schedule: Schedule = {
      ref: REF,
      eventName: 'NodeCG Test',
      scheduleName: 'Main',
      twitch: '',
      lines: LINES,
      fetchedAt: 0,
    };
    const state = initialState();
    state.currentKey = 'o101';
    state.runs.o101 = { startedAt: Date.now() - 40 * MIN };
    state.tracking = { twitch: false, vision: false, autoApply, nodecg: true };
    return new Room({
      ref: REF,
      schedule,
      state,
      store: null,
      services: { fetchSchedule: async () => schedule, capture: async () => {} },
    });
  }
  const next = {
    via: 'bundle' as const,
    run: { externalID: '102', game: 'Super Mario 64', players: [] },
    timer: { state: 'running' as const, elapsedMs: 30_000 },
  };

  it('acts on its own word once it has held for a few seconds, when auto-apply is on', () => {
    const r = room(true);
    const now = Date.now();
    nodecgReport(r, next, now);
    // One report could be a misclick on the stream PC: it waits for the next.
    expect(r.state.currentKey).toBe('o101');
    expect(r.state.detection).toMatchObject({ runKey: 'o102' });
    nodecgReport(r, next, now + 15_000);
    expect(r.state.currentKey).toBe('o102');
    expect(r.state.runs.o102?.startedAt).toBeGreaterThan(Date.now() - 31_000);
    expect(r.state.log[0]?.text).toContain('Followed the stream (nodecg)');
  });

  it('asks first otherwise, and is ignored when switched off', () => {
    const r = room(false);
    nodecgReport(r, next);
    expect(r.state.currentKey).toBe('o101');
    expect(r.state.detection).toMatchObject({ runKey: 'o102', kind: 'advance' });

    const off = room(true);
    off.state.tracking.nodecg = false;
    nodecgReport(off, next);
    expect(off.state.detection).toBeNull();
    expect(off.state.nodecg).toMatchObject({ runKey: 'o102' }); // still shown
  });

  it('settles a misclick (next, next, back) before moving anything', () => {
    const r = room(true);
    const now = Date.now();
    const at = (id: string) => ({ ...next, run: { externalID: id, game: '', players: [] } });
    nodecgReport(r, at('102'), now);
    nodecgReport(r, at('103'), now + 2_000);
    nodecgReport(r, at('102'), now + 4_000);
    expect(r.state.currentKey).toBe('o101');
    nodecgReport(r, at('102'), now + 19_000);
    expect(r.state.currentKey).toBe('o102');
  });

  it('stops our timer when speedcontrol’s finished, once it has held, with auto-apply on', () => {
    const r = room(true);
    const ours = r.state.runs.o101!.startedAt!;
    const celeste = { via: 'bundle' as const, run: { game: 'Celeste', players: [] } };
    // Speedcontrol started 3 s after us and finished at 30:00; reports are a few minutes old.
    const base = ours + 30 * MIN;
    const final = 30 * MIN;
    nodecgReport(
      r,
      { ...celeste, timer: { state: 'running', elapsedMs: 27 * MIN } },
      base - 3 * MIN + 3_000,
    );
    nodecgReport(r, { ...celeste, timer: { state: 'finished', elapsedMs: final } }, base + 10_000);
    expect(r.state.detection).toMatchObject({ kind: 'finish', runKey: 'o101' });
    expect(r.state.runs.o101?.endedAt).toBeUndefined();
    nodecgReport(r, { ...celeste, timer: { state: 'finished', elapsedMs: final } }, base + 25_000);
    expect(r.state.runs.o101?.endedAt).toBe(ours + 3_000 + final);
    expect(r.state.currentKey).toBe('o101');
    expect(r.state.log[0]).toMatchObject({ actor: 'Auto-tracking' });
    expect(r.state.log[0]?.text).toMatch(/^■ Finished Celeste in 00:30:03, when the stream/);
  });

  it('doesn’t commit every heartbeat', () => {
    const r = room(false);
    const now = Date.now();
    nodecgReport(r, { ...next, run: { game: 'Celeste', players: [] } }, now);
    const rev = r.state.rev;
    nodecgReport(r, { ...next, run: { game: 'Celeste', players: [] } }, now + 15_000);
    expect(r.state.rev).toBe(rev);
    nodecgReport(r, { ...next, run: { game: 'Celeste', players: [] } }, now + 61_000);
    expect(r.state.rev).toBe(rev + 1);
  });
});
