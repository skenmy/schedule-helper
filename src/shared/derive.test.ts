import { describe, expect, it } from 'vitest';
import {
  checkInSummary,
  computeDelta,
  marathonPhase,
  marathonStats,
  nextPlayableIndex,
  prevPlayableIndex,
  project,
  projectedEnd,
  runTiming,
  scheduleStatus,
  upcomingIndexes,
} from './derive.ts';
import type { RoomState, ScheduleLine } from './types.ts';

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

// a: 10:00–10:30, b: 10:40–11:40, setup block: 11:50–12:00, c: 12:10–12:30 (setup after c: 0)
const LINES: ScheduleLine[] = [
  line('a', T0, 30),
  line('b', T0 + 40 * MIN, 60),
  line('s', T0 + 110 * MIN, 10, { setupBlock: true, setupBlockText: 'Interview', runners: [] }),
  line('c', T0 + 130 * MIN, 20, { setupSec: 0 }),
];

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
    undo: null,
    updatedAt: 0,
    ...partial,
  };
}

describe('runTiming', () => {
  it('derives phase from the record', () => {
    expect(runTiming(undefined, T0).phase).toBe('setup');
    expect(runTiming({ startedAt: T0 }, T0 + 5000)).toMatchObject({
      phase: 'running',
      elapsedMs: 5000,
    });
    expect(runTiming({ startedAt: T0, endedAt: T0 + 9000 }, T0 + 60_000)).toMatchObject({
      phase: 'finished',
      elapsedMs: 9000,
    });
  });
});

describe('playable navigation', () => {
  it('skips setup blocks and skipped runs', () => {
    const runs = { c: { skipped: true } };
    expect(nextPlayableIndex(LINES, {}, 1)).toBe(3);
    expect(nextPlayableIndex(LINES, runs, 1)).toBe(-1);
    expect(prevPlayableIndex(LINES, {}, 3)).toBe(1);
    expect(prevPlayableIndex(LINES, {}, 0)).toBe(-1);
  });
});

describe('computeDelta', () => {
  it('is null with no current run', () => {
    expect(computeDelta(LINES, state(), T0)).toBeNull();
  });

  it('measures a late start as behind', () => {
    const s = state({ currentKey: 'a', runs: { a: { startedAt: T0 + 5 * MIN } } });
    expect(computeDelta(LINES, s, T0 + 6 * MIN)).toBe(-300);
  });

  it('treats a run still in setup as starting now', () => {
    const s = state({ currentKey: 'b' });
    expect(computeDelta(LINES, s, T0 + 35 * MIN)).toBe(300);
  });

  it('lets an overrun past the next slot take over', () => {
    // a started on time but is still running at 10:45, past b's 10:40 slot.
    const s = state({ currentKey: 'a', runs: { a: { startedAt: T0 } } });
    expect(computeDelta(LINES, s, T0 + 45 * MIN)).toBe(-300);
  });

  it('ignores the slot of a skipped next run', () => {
    // a started on time; b (10:40) is skipped, so the 11:50 interlude is the next deadline.
    const s = state({ currentKey: 'a', runs: { a: { startedAt: T0 }, b: { skipped: true } } });
    expect(computeDelta(LINES, s, T0 + 45 * MIN)).toBe(0);
    expect(computeDelta(LINES, s, T0 + 115 * MIN)).toBe(-5 * 60);
  });

  it('does not drift while a finished run waits to be advanced', () => {
    const s = state({
      currentKey: 'a',
      runs: { a: { startedAt: T0 + MIN, endedAt: T0 + 25 * MIN } },
    });
    expect(computeDelta(LINES, s, T0 + 26 * MIN)).toBe(-60);
    expect(computeDelta(LINES, s, T0 + 30 * MIN)).toBe(-60);
  });
});

describe('scheduleStatus', () => {
  it('buckets by window', () => {
    expect(scheduleStatus(0)).toBe('on');
    expect(scheduleStatus(-15 * 60)).toBe('on');
    expect(scheduleStatus(-15 * 60 - 1)).toBe('behind');
    expect(scheduleStatus(16 * 60)).toBe('ahead');
    expect(scheduleStatus(-61, 60)).toBe('behind');
  });
});

describe('project', () => {
  it('uses the scheduled chain before the marathon', () => {
    const p = project(LINES, state(), T0 - 60 * MIN);
    expect(p[0]).toEqual({ start: T0, end: T0 + 30 * MIN });
    expect(p[1]).toEqual({ start: T0 + 40 * MIN, end: T0 + 100 * MIN });
    expect(projectedEnd(p)).toBe(T0 + 150 * MIN);
  });

  it('pushes everything back while the current run overruns', () => {
    const s = state({ currentKey: 'a', runs: { a: { startedAt: T0 } } });
    const p = project(LINES, s, T0 + 50 * MIN);
    expect(p[0]).toEqual({ start: T0, end: T0 + 50 * MIN });
    expect(p[1]?.start).toBe(T0 + 60 * MIN);
  });

  it('waits for the previous setup buffer when the current run is in setup', () => {
    const s = state({ currentKey: 'b', runs: { a: { startedAt: T0, endedAt: T0 + 20 * MIN } } });
    const p = project(LINES, s, T0 + 22 * MIN);
    expect(p[0]).toBeNull();
    expect(p[1]?.start).toBe(T0 + 30 * MIN);
  });

  it('never projects the next run into the past after a finished run', () => {
    const s = state({ currentKey: 'a', runs: { a: { startedAt: T0, endedAt: T0 + 30 * MIN } } });
    const p = project(LINES, s, T0 + 70 * MIN);
    expect(p[1]?.start).toBe(T0 + 70 * MIN);
  });

  it('drops skipped runs from the chain', () => {
    const s = state({ currentKey: 'a', runs: { a: { startedAt: T0 }, b: { skipped: true } } });
    const p = project(LINES, s, T0 + 10 * MIN);
    expect(p[1]).toBeNull();
    expect(p[2]?.start).toBe(T0 + 40 * MIN);
  });

  it('is empty once the marathon is complete', () => {
    expect(project(LINES, state({ finishedAt: T0 }), T0).every((x) => x === null)).toBe(true);
  });
});

describe('marathon summaries', () => {
  it('reports phase', () => {
    expect(marathonPhase(LINES, state(), T0 - MIN)).toBe('pre');
    expect(marathonPhase(LINES, state(), T0 + MIN)).toBe('idle');
    expect(marathonPhase(LINES, state({ currentKey: 'a' }), T0)).toBe('live');
    expect(marathonPhase(LINES, state({ finishedAt: T0 }), T0)).toBe('complete');
  });

  it('counts runs, skips and runners', () => {
    const s = state({ currentKey: 'c', runs: { b: { skipped: true } } });
    const stats = marathonStats(LINES, s, T0 + 2 * 60 * MIN);
    expect(stats).toMatchObject({
      runsTotal: 3,
      runsDone: 1,
      runsSkipped: 1,
      estimateTotalSec: 110 * 60,
      runnersTotal: 3,
      hourNow: 2,
      hoursTotal: 3,
    });
  });

  it('lists upcoming runs and their check-ins', () => {
    const s = state({ currentKey: 'a', runs: { b: { checkIn: 'ready' } } });
    const next = upcomingIndexes(LINES, s, 5);
    expect(next).toEqual([1, 3]);
    expect(checkInSummary(LINES, s.runs, next)).toEqual({ ready: 1, missing: 0, unchecked: 1 });
  });
});
