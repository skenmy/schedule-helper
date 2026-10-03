// Pure schedule maths. Every view (conductor, kiosk, mobile, overlay feed) and
// the server derive timing from these functions so they can never disagree.

import type { RoomState, RunKey, RunRecord, ScheduleLine } from './types.ts';

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
/**
 * Interludes (setup blocks) are flexible: the run after one starts at its
 * scheduled time, the interlude stretching when the event is early and
 * shrinking (to nothing at most) when it's late. When the line after the
 * setup block at `j` is scheduled to start: what the interlude flexes to.
 */
function resumesAt(lines: Lines, j: number): number | null {
  for (let k = j + 1; k < lines.length; k++) {
    if (!lines[k]!.setupBlock) return lines[k]!.scheduledStart;
  }
  return null;
}

/** The scheduled start an interlude just before the run at `i` holds it to, if there's one. */
function interludeStart(lines: Lines, runs: Runs, i: number): number | null {
  const prev = prevPlayableIndex(lines, runs, i);
  for (let j = i - 1; j > prev; j--) {
    if (lines[j]!.setupBlock) return resumesAt(lines, j);
  }
  return null;
}

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
 * in setup counts as starting "now", or at its slot after an interlude, which
 * waits for it). Once the clock passes the next line's scheduled start without
 * us getting there, that overrun wins — so a run that eats its whole setup
 * buffer and keeps going pushes the delta down live.
 */
export function computeDelta(lines: Lines, state: RoomState, now: number): number | null {
  const cur = currentIndex(lines, state);
  const line = lines[cur];
  if (!line || line.scheduledStart == null) return null;
  const actualStart =
    state.runs[line.key]?.startedAt ?? Math.max(now, interludeStart(lines, state.runs, cur) ?? now);
  let delta = (line.scheduledStart - actualStart) / 1000;
  for (let j = cur + 1; j < lines.length; j++) {
    const next = lines[j]!.scheduledStart;
    // A skipped run's slot isn't a deadline: the run after it can still start on time.
    // Nor is an interlude's: it flexes, and the run after it is the deadline.
    if (next == null || lines[j]!.setupBlock || state.runs[lines[j]!.key]?.skipped) continue;
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

/** How this event is actually running, learnt from the runs it has finished. */
export interface Pace {
  /** Runs take this × their estimate (1 = spot on; shrunk towards 1 with few samples). */
  runRatio: number;
  /** Changeovers take this many seconds more (+) or less (−) than planned. */
  setupDeltaSec: number;
  /** Finished runs and measured changeovers the figures come from. */
  runs: number;
  setups: number;
}

/** No pace until this many runs have finished: two runs say little about a weekend. */
export const PACE_MIN_RUNS = 3;
/** Samples worth of "on plan" mixed in, so early figures don't swing the projection. */
const PACE_PRIOR = 5;
const RATIO_LIMITS = [0.75, 1.35] as const;
const SETUP_LIMIT_SEC = 20 * 60;
/** A gap this long between runs is a break (overnight, a pause), not a changeover. */
const BREAK_SEC = 90 * 60;

/** The middle value (the mean of the middle two for an even count); NaN for none. */
export const median = (xs: readonly number[]): number => {
  const s = [...xs].sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
};
const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));

export interface Changeover {
  /** The run that ended, and the run started next after it. */
  from: RunKey;
  to: RunKey;
  actualSec: number;
  /**
   * What the schedule allowed: the setup buffer plus any interludes between.
   * Null when `to` isn't the run the schedule had next (swapped on the day, or
   * a run in between was passed over), so there's no plan to compare with.
   */
  plannedSec: number | null;
  /**
   * Not a changeover: long enough to be a break (overnight, a pause), or across
   * an interlude, which flexes to start the next run on time.
   */
  isBreak: boolean;
}

/**
 * Changeovers as they happened: from each finished run to whichever run was
 * started next, in the order they were played (not schedule order, which
 * swaps on the day and re-imports can change).
 */
export function changeovers(lines: Lines, state: RoomState): Changeover[] {
  const played = lines
    .map((line, index) => ({ line, index, rec: state.runs[line.key] }))
    .filter((p) => !p.line.setupBlock && p.rec?.startedAt != null)
    .sort((a, b) => a.rec!.startedAt! - b.rec!.startedAt!);
  const out: Changeover[] = [];
  for (let k = 0; k + 1 < played.length; k++) {
    const a = played[k]!;
    const b = played[k + 1]!;
    const end = a.rec!.endedAt;
    const start = b.rec!.startedAt!;
    if (end == null || end <= a.rec!.startedAt! || start < end) continue;
    let plannedSec: number | null = null;
    let interlude = false;
    for (let j = Math.min(a.index, b.index) + 1; j < Math.max(a.index, b.index); j++) {
      if (lines[j]!.setupBlock) interlude = true;
    }
    if (nextPlayableIndex(lines, state.runs, a.index) === b.index) {
      plannedSec = a.line.setupSec;
      for (let j = a.index + 1; j < b.index; j++) {
        const between = lines[j]!;
        if (between.setupBlock) plannedSec += between.estimateSec + between.setupSec;
      }
    }
    const actualSec = (start - end) / 1000;
    out.push({
      from: a.line.key,
      to: b.line.key,
      actualSec,
      plannedSec,
      isBreak: interlude || actualSec > BREAK_SEC + (plannedSec ?? 0),
    });
  }
  return out;
}

/**
 * Measures the event so far: the median of each finished run's actual time
 * over its estimate, and the median overrun of changeovers (end of one run to
 * the start of the next, against its setup buffer plus any interludes between).
 * Medians, shrunk towards "on plan" and clamped, so one disaster or a run
 * edited after the fact can't drag the whole projection with it.
 */
export function eventPace(lines: Lines, state: RoomState): Pace | null {
  const ratios: number[] = [];
  for (const line of lines) {
    const rec = state.runs[line.key];
    if (line.setupBlock || rec?.skipped || rec?.startedAt == null || rec.endedAt == null) continue;
    if (rec.endedAt > rec.startedAt && line.estimateSec > 0) {
      ratios.push((rec.endedAt - rec.startedAt) / 1000 / line.estimateSec);
    }
  }
  const setupDeltas = changeovers(lines, state)
    .filter((c) => c.plannedSec != null && !c.isBreak)
    .map((c) => c.actualSec - c.plannedSec!);
  if (ratios.length < PACE_MIN_RUNS) return null;
  const shrink = (n: number) => n / (n + PACE_PRIOR);
  const ratio = 1 + (median(ratios) - 1) * shrink(ratios.length);
  const setup = setupDeltas.length
    ? median(setupDeltas.map((d) => clamp(d, -SETUP_LIMIT_SEC, SETUP_LIMIT_SEC))) *
      shrink(setupDeltas.length)
    : 0;
  return {
    runRatio: clamp(ratio, RATIO_LIMITS[0], RATIO_LIMITS[1]),
    setupDeltaSec: Math.round(setup),
    runs: ratios.length,
    setups: setupDeltas.length,
  };
}

/**
 * Projected start/end for the current line and everything after it, chaining
 * each line's estimate + setup from where the current run will realistically
 * finish. Skipped lines get no projection. Before the marathon starts the chain
 * is anchored to the scheduled start; if nothing is current it starts now.
 * Interludes flex: the run after one starts at its scheduled time unless the
 * chain gets there later (`resumesAt`), so each interlude resets the projection.
 *
 * With a `pace`, runs still to come are scaled by how this event's runs have
 * gone and changeovers by how long they've really taken: the "likely" view.
 */
export function project(
  lines: Lines,
  state: RoomState,
  now: number,
  pace: Pace | null = null,
): (Span | null)[] {
  const runMs = (line: ScheduleLine) =>
    line.estimateSec * 1000 * (pace && !line.setupBlock ? pace.runRatio : 1);
  const setupMs = (line: ScheduleLine) =>
    Math.max(0, line.setupSec + (pace && !line.setupBlock ? pace.setupDeltaSec : 0)) * 1000;
  const out: (Span | null)[] = lines.map(() => null);
  if (state.finishedAt != null || lines.length === 0) return out;

  let i = currentIndex(lines, state);
  let cursor: number;
  if (i >= 0) {
    const line = lines[i]!;
    const t = runTiming(state.runs[line.key], now);
    const est = runMs(line);
    let start: number;
    let end: number;
    if (t.phase === 'setup') {
      // Still setting up: earliest start is when the previous run's setup buffer runs out.
      const prev = prevPlayableIndex(lines, state.runs, i);
      const prevRec = prev >= 0 ? state.runs[lines[prev]!.key] : undefined;
      const ready = prevRec?.endedAt != null ? prevRec.endedAt + setupMs(lines[prev]!) : now;
      // After an interlude, not before its slot either.
      start = Math.max(now, ready, interludeStart(lines, state.runs, i) ?? now);
      end = start + est;
    } else if (t.phase === 'running') {
      start = t.startedAt!;
      end = Math.max(start + est, now);
    } else {
      start = t.startedAt!;
      end = t.endedAt!;
    }
    out[i] = { start, end };
    // A finished run waiting to be advanced can't make the next one start in the past.
    cursor = Math.max(end + setupMs(line), now);
  } else {
    const first = scheduledStartOf(lines);
    cursor = first != null && first > now ? first : now;
    i = -1;
  }

  for (let j = i + 1; j < lines.length; j++) {
    const line = lines[j]!;
    if (state.runs[line.key]?.skipped) continue;
    const resume = line.setupBlock ? resumesAt(lines, j) : null;
    if (resume != null) {
      // Stretches when we're early, shrinks (to nothing) when we're late.
      const end = Math.max(cursor, resume);
      out[j] = { start: cursor, end };
      cursor = end;
      continue;
    }
    const span = { start: cursor, end: cursor + runMs(line) };
    out[j] = span;
    cursor = span.end + setupMs(line);
  }
  return out;
}

export interface CatchUpOption {
  /** Trim a run's setup buffer. (Interludes flex on their own, so they're never an option.) */
  kind: 'setup';
  /** The run whose buffer it is. */
  key: RunKey;
  /** Seconds it gives back. */
  savesSec: number;
  /** When it's projected to happen. */
  at: number | null;
  /** Savings so far, taking options in order up to and including this one. */
  cumulativeSec: number;
  /** The projected end after taking options up to and including this one. */
  endAfter: number;
}

export interface CatchUpPlan {
  /** How late the end is projected to be (seconds). */
  behindSec: number;
  /** The end the plan works from: the likely end with a pace, else the plain projection. */
  projectedEnd: number;
  scheduledEnd: number;
  options: CatchUpOption[];
  /** Index of the option that gets back on schedule, or −1 if all of them together don't. */
  enoughAt: number;
}

/** Buffers aren't trimmed below this: a changeover still needs time. */
export const MIN_SETUP_SEC = 5 * 60;
/** Below this lateness there's nothing worth planning. */
export const CATCH_UP_FROM_SEC = 5 * 60;

/**
 * When the marathon is projected to finish late, what could give the time
 * back: trimming the setup buffers still to come down to MIN_SETUP_SEC
 * (largest first: least visible on stream). Interludes flex by themselves,
 * so a buffer before one that's already soaking up the delay gives nothing
 * back: only those after the last such interlude count. Advisory only;
 * nothing here changes the schedule.
 */
export function catchUpPlan(
  lines: Lines,
  state: RoomState,
  now: number,
  pace: Pace | null = null,
): CatchUpPlan | null {
  const scheduledEnd = scheduledEndOf(lines);
  const projection = project(lines, state, now, pace);
  const end = projectedEnd(projection);
  if (scheduledEnd == null || end == null || state.finishedAt != null) return null;
  const behindSec = Math.round((end - scheduledEnd) / 1000);
  if (behindSec < CATCH_UP_FROM_SEC) return null;

  const cur = currentIndex(lines, state);
  // The live run's own buffer hasn't happened yet either, unless it's finished and advanced.
  let from = Math.max(cur, 0);
  for (let i = lines.length - 1; i > from; i--) {
    const resume = lines[i]!.setupBlock ? resumesAt(lines, i) : null;
    const span = projection[i];
    // An interlude still waiting for its slot: everything before it is absorbed.
    if (resume != null && span && span.end <= resume) {
      from = i + 1;
      break;
    }
  }
  const setups: Omit<CatchUpOption, 'cumulativeSec' | 'endAfter'>[] = [];
  for (let i = from; i < lines.length; i++) {
    const line = lines[i]!;
    if (state.runs[line.key]?.skipped || line.setupBlock) continue;
    // The last line's buffer comes after the end, so it can't help.
    const last = i === lines.length - 1;
    if (!last && line.setupSec > MIN_SETUP_SEC) {
      const at = projection[i]?.end ?? null;
      setups.push({ kind: 'setup', key: line.key, savesSec: line.setupSec - MIN_SETUP_SEC, at });
    }
  }
  const bySavings = (a: { savesSec: number }, b: { savesSec: number }) => b.savesSec - a.savesSec;
  let cumulativeSec = 0;
  let enoughAt = -1;
  const options = setups.sort(bySavings).map((o, i) => {
    cumulativeSec += o.savesSec;
    if (enoughAt < 0 && cumulativeSec >= behindSec) enoughAt = i;
    return { ...o, cumulativeSec, endAfter: end - cumulativeSec * 1000 };
  });
  return { behindSec, projectedEnd: end, scheduledEnd, options, enoughAt };
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
  /** Said they're on their way (and haven't checked in since). */
  late: number;
  missing: number;
  unchecked: number;
}

export function checkInSummary(
  lines: Lines,
  runs: Runs,
  indexes: readonly number[],
): CheckInSummary {
  const summary: CheckInSummary = { ready: 0, late: 0, missing: 0, unchecked: 0 };
  for (const i of indexes) {
    const line = lines[i];
    if (!line || line.setupBlock) continue;
    const r = runs[line.key];
    if (r?.checkIn === 'ready') summary.ready++;
    else if (r?.late) summary.late++;
    else if (r?.checkIn === 'missing') summary.missing++;
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
