// Pure schedule maths. Every view (conductor, kiosk, mobile, overlay feed) and
// the server derive timing from these functions so they can never disagree.

import type { RoomState, RunRecord, ScheduleLine } from './types.ts';

/** |delta| within this many seconds counts as "on schedule". */
export const ON_SCHEDULE_WINDOW_SEC = 15 * 60;

type Lines = readonly ScheduleLine[];
type Runs = RoomState['runs'];

export function indexOfKey(lines: Lines, key: string | null | undefined): number {
  return key == null ? -1 : lines.findIndex((l) => l.key === key);
}

export function currentIndex(lines: Lines, state: Pick<RoomState, 'currentKey'>): number {
  return indexOfKey(lines, state.currentKey);
}

/** A line operators can make current: a real run that hasn't been skipped. */
export function isPlayable(line: ScheduleLine | undefined, runs: Runs): boolean {
  return !!line && !line.setupBlock && !runs[line.key]?.skipped;
}

export function nextPlayableIndex(lines: Lines, runs: Runs, fromExclusive: number): number {
  for (let i = fromExclusive + 1; i < lines.length; i++) if (isPlayable(lines[i], runs)) return i;
  return -1;
}

export function prevPlayableIndex(lines: Lines, runs: Runs, fromExclusive: number): number {
  for (let i = Math.min(fromExclusive, lines.length) - 1; i >= 0; i--) {
    if (isPlayable(lines[i], runs)) return i;
  }
  return -1;
}

export function firstPlayableIndex(lines: Lines, runs: Runs): number {
  return nextPlayableIndex(lines, runs, -1);
}

export type RunPhase = 'setup' | 'running' | 'finished';

export interface RunTiming {
  phase: RunPhase;
  elapsedMs: number;
  startedAt: number | null;
  endedAt: number | null;
}

/** The timer for one run, derived from its record. */
export function runTiming(rec: RunRecord | undefined, now: number): RunTiming {
  const startedAt = rec?.startedAt ?? null;
  const endedAt = rec?.endedAt ?? null;
  if (startedAt == null) return { phase: 'setup', elapsedMs: 0, startedAt: null, endedAt: null };
  if (endedAt == null) {
    return { phase: 'running', elapsedMs: Math.max(0, now - startedAt), startedAt, endedAt };
  }
  return { phase: 'finished', elapsedMs: Math.max(0, endedAt - startedAt), startedAt, endedAt };
}

export type MarathonPhase = 'pre' | 'live' | 'idle' | 'complete';

export function marathonPhase(lines: Lines, state: RoomState, now: number): MarathonPhase {
  if (state.finishedAt != null) return 'complete';
  if (currentIndex(lines, state) >= 0) return 'live';
  const start = scheduledStartOf(lines);
  return start != null && now < start ? 'pre' : 'idle';
}

export function scheduledStartOf(lines: Lines): number | null {
  return lines.find((l) => l.scheduledStart != null)?.scheduledStart ?? null;
}

export function scheduledEndOf(lines: Lines): number | null {
  for (let i = lines.length - 1; i >= 0; i--) {
    const l = lines[i]!;
    if (l.scheduledStart != null) return l.scheduledStart + l.estimateSec * 1000;
  }
  return null;
}

/**
 * Seconds ahead (+) or behind (−) schedule.
 *
 * Baseline is how late the current run started versus its slot (a run still
 * in setup counts as starting "now"). Once the clock passes the next line's
 * scheduled start without us getting there, that overrun wins — so a run that
 * eats its whole setup buffer and keeps going pushes the delta down live.
 */
export function computeDelta(lines: Lines, state: RoomState, now: number): number | null {
  const cur = currentIndex(lines, state);
  const line = lines[cur];
  if (!line || line.scheduledStart == null) return null;
  const actualStart = state.runs[line.key]?.startedAt ?? now;
  let delta = (line.scheduledStart - actualStart) / 1000;
  for (let j = cur + 1; j < lines.length; j++) {
    const next = lines[j]!.scheduledStart;
    if (next == null) continue;
    if (now > next) delta = Math.min(delta, (next - now) / 1000);
    break;
  }
  return Math.round(delta);
}

export type ScheduleStatus = 'ahead' | 'on' | 'behind';

export function scheduleStatus(delta: number, windowSec = ON_SCHEDULE_WINDOW_SEC): ScheduleStatus {
  if (Math.abs(delta) <= windowSec) return 'on';
  return delta > 0 ? 'ahead' : 'behind';
}

export interface Span {
  start: number;
  end: number;
}

/**
 * Projected start/end for the current line and everything after it, chaining
 * each line's estimate + setup from where the current run will realistically
 * finish. Skipped lines get no projection. Before the marathon starts the chain
 * is anchored to the scheduled start; if nothing is current it starts now.
 */
export function project(lines: Lines, state: RoomState, now: number): (Span | null)[] {
  const out: (Span | null)[] = lines.map(() => null);
  if (state.finishedAt != null || lines.length === 0) return out;

  let i = currentIndex(lines, state);
  let cursor: number;
  if (i >= 0) {
    const line = lines[i]!;
    const t = runTiming(state.runs[line.key], now);
    const est = line.estimateSec * 1000;
    let start: number;
    let end: number;
    if (t.phase === 'setup') {
      // Still setting up: earliest start is when the previous run's setup buffer runs out.
      const prev = prevPlayableIndex(lines, state.runs, i);
      const prevRec = prev >= 0 ? state.runs[lines[prev]!.key] : undefined;
      const ready = prevRec?.endedAt != null ? prevRec.endedAt + lines[prev]!.setupSec * 1000 : now;
      start = Math.max(now, ready);
      end = start + est;
    } else if (t.phase === 'running') {
      start = t.startedAt!;
      end = Math.max(start + est, now);
    } else {
      start = t.startedAt!;
      end = t.endedAt!;
    }
    out[i] = { start, end };
    cursor = end + line.setupSec * 1000;
  } else {
    const first = scheduledStartOf(lines);
    cursor = first != null && first > now ? first : now;
    i = -1;
  }

  for (let j = i + 1; j < lines.length; j++) {
    const line = lines[j]!;
    if (state.runs[line.key]?.skipped) continue;
    const span = { start: cursor, end: cursor + line.estimateSec * 1000 };
    out[j] = span;
    cursor = span.end + line.setupSec * 1000;
  }
  return out;
}

export function projectedEnd(projection: readonly (Span | null)[]): number | null {
  for (let i = projection.length - 1; i >= 0; i--) {
    const p = projection[i];
    if (p) return p.end;
  }
  return null;
}

/** Next `count` playable indexes after the current run (or from the start). */
export function upcomingIndexes(lines: Lines, state: RoomState, count: number): number[] {
  if (state.finishedAt != null) return [];
  const out: number[] = [];
  let i = currentIndex(lines, state);
  while (out.length < count) {
    i = nextPlayableIndex(lines, state.runs, i);
    if (i < 0) break;
    out.push(i);
  }
  return out;
}

export interface CheckInSummary {
  ready: number;
  missing: number;
  unchecked: number;
}

export function checkInSummary(
  lines: Lines,
  runs: Runs,
  indexes: readonly number[],
): CheckInSummary {
  const summary: CheckInSummary = { ready: 0, missing: 0, unchecked: 0 };
  for (const i of indexes) {
    const line = lines[i];
    if (!line || line.setupBlock) continue;
    const status = runs[line.key]?.checkIn;
    if (status === 'ready') summary.ready++;
    else if (status === 'missing') summary.missing++;
    else summary.unchecked++;
  }
  return summary;
}

export interface MarathonStats {
  runsTotal: number;
  runsDone: number;
  runsSkipped: number;
  estimateTotalSec: number;
  setupTotalSec: number;
  runnersTotal: number;
  scheduledStart: number | null;
  scheduledEnd: number | null;
  /** Hours elapsed since the scheduled start (0 before it). */
  hourNow: number;
  hoursTotal: number;
}

export function marathonStats(lines: Lines, state: RoomState, now: number): MarathonStats {
  const cur = currentIndex(lines, state);
  const done = state.finishedAt != null ? lines.length : cur;
  let runsTotal = 0;
  let runsDone = 0;
  let runsSkipped = 0;
  let estimateTotalSec = 0;
  let setupTotalSec = 0;
  const runners = new Set<string>();
  lines.forEach((line, i) => {
    setupTotalSec += line.setupSec + (line.setupBlock ? line.estimateSec : 0);
    if (line.setupBlock) return;
    runsTotal++;
    estimateTotalSec += line.estimateSec;
    for (const r of line.runners) runners.add(r.toLowerCase());
    if (state.runs[line.key]?.skipped) runsSkipped++;
    else if (i < done) runsDone++;
  });
  const scheduledStart = scheduledStartOf(lines);
  const scheduledEnd = scheduledEndOf(lines);
  const hour = 3_600_000;
  return {
    runsTotal,
    runsDone,
    runsSkipped,
    estimateTotalSec,
    setupTotalSec,
    runnersTotal: runners.size,
    scheduledStart,
    scheduledEnd,
    hourNow: scheduledStart != null ? Math.max(0, Math.floor((now - scheduledStart) / hour)) : 0,
    hoursTotal:
      scheduledStart != null && scheduledEnd != null
        ? Math.max(1, Math.round((scheduledEnd - scheduledStart) / hour))
        : 0,
  };
}

export function lineTitle(line: ScheduleLine): string {
  return line.setupBlock ? line.setupBlockText || 'Setup' : line.game || 'Untitled run';
}
