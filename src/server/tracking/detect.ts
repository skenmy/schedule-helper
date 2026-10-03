// Turns signals from the stream ("it looks like run X, started at T", "run X
// finished at T") into one
// detection the operators can accept. Pure functions over a state draft, so
// every rule is unit-tested; the sources and timers live in service.ts.
//
// Once a detection is dealt with (accepted, dismissed, or accepted and then
// undone), `state.settled` remembers it: the same suggestion isn't raised again
// while the live run is the same, however often the stream keeps showing it.

import {
  currentIndex,
  indexOfKey,
  lineTitle,
  prevPlayableIndex,
  runTiming,
} from '../../shared/derive.ts';
import type {
  Detection,
  DetectionSignal,
  RoomState,
  RunKey,
  ScheduleLine,
  SignalSource,
} from '../../shared/types.ts';
import { candidateIndexes } from './match.ts';

export interface Signal extends DetectionSignal {
  runKey: RunKey;
}

/** Signals older than this no longer count towards two sources agreeing. */
export const AGREE_WINDOW_MS = 10 * 60_000;
/** A detection nobody acted on, with no fresh signal, is dropped after this. */
export const STALE_MS = 20 * 60_000;
/** A settled detection stops suppressing after this, even on the same live run. */
export const SETTLED_MS = 30 * 60_000;
/** Two timer readings agree when the starts they imply are this close… */
const SAME_START_MS = 8_000;
/** …and were taken at least this far apart (one frame read twice proves nothing). */
const READINGS_APART_MS = 20_000;
/**
 * Sources on the stream PC (NodeCG speedcontrol, a timer bridge) report the
 * timer itself, not a reading of a picture of it: one of them is enough.
 */
export const TRUSTED_SOURCES: ReadonlySet<SignalSource> = new Set(['nodecg', 'push']);
/**
 * On its own word, a trusted source acts once what it said has stood this long
 * with nothing contradicting it: a misclick on the stream PC (next, next, back)
 * settles before anything moves. It reports every change at once (the bundle
 * within 250 ms, the bridge within a second), so a few seconds is enough, and
 * the service checks again when they're up rather than waiting for the next
 * report. Starts and finishes are back-dated to the stream PC's timer anyway.
 */
export const TRUSTED_SETTLE_MS = 3_000;
/**
 * A finish is news when it's reported: the stream PC reports on every change.
 * One older than this is one somebody already dealt with (stopped our timer by
 * hand, then resumed it), not a reason to stop ours again.
 */
export const FINISH_FRESH_MS = 2 * 60_000;
const MAX_SIGNALS = 8;

const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 ? s[mid]! : Math.round((s[mid - 1]! + s[mid]!) / 2);
};

/** Whether `index` is still somewhere a detection may point: the live run or the next few. */
function reachable(s: RoomState, lines: readonly ScheduleLine[], index: number): boolean {
  const line = lines[index];
  return !!line && !line.setupBlock && candidateIndexes(lines, s).includes(index);
}

/**
 * The earliest a run's start can plausibly be back-dated to: not before the
 * live run started (moving on from it), and not before the previous run ended
 * (starting the live run). A reading implying earlier is a frozen or misread
 * timer, not a start.
 */
export function startFloor(
  s: RoomState,
  lines: readonly ScheduleLine[],
  kind: Detection['kind'],
): number {
  if (kind === 'advance') return (s.currentKey && s.runs[s.currentKey]?.startedAt) || 0;
  const prev = prevPlayableIndex(lines, s.runs, currentIndex(lines, s));
  return (prev >= 0 && s.runs[lines[prev]!.key]?.endedAt) || 0;
}

/**
 * Folds a signal into `s.detection`. Returns whether anything changed.
 *
 * - A later run (within the lookahead) on stream → an `advance` detection.
 * - The live run's timer finished on stream while ours still runs → a `finish`
 *   detection (only the stream PC's timer can say when). Moving on wins: while
 *   an `advance` is pending, a finish only tells it when the live run ended
 *   (`endedAt`), and an `advance` replacing a `finish` keeps that time.
 * - The live run on stream with its timer running while ours hasn't started →
 *   a `start` detection.
 * - The live run on stream otherwise → that source no longer backs any
 *   detection it raised (another source may still).
 */
export function observe(s: RoomState, lines: readonly ScheduleLine[], signal: Signal): boolean {
  const index = indexOfKey(lines, signal.runKey);
  if (!reachable(s, lines, index)) return false;

  let kind: Detection['kind'];
  if (signal.runKey === s.currentKey) {
    const ours = runTiming(s.runs[signal.runKey], signal.at);
    if (ours.phase === 'running' && signal.endedAt != null) {
      // Finished before ours started: not this run's finish (a stale or wrong report).
      if (signal.endedAt < ours.startedAt!) return retract(s, signal.source);
      kind = 'finish';
    } else if (ours.phase === 'setup' && signal.startedAt != null) {
      kind = 'start';
    } else {
      return retract(s, signal.source);
    }
  } else {
    kind = 'advance';
  }

  const { runKey, endedAt, ...rest } = signal;
  // A finish time only means something for `finish`; elsewhere it would be noise.
  const entry: DetectionSignal = kind === 'finish' ? { ...rest, endedAt } : { ...rest };
  if (entry.startedAt != null && entry.startedAt < startFloor(s, lines, kind)) {
    // Implausible as a start: keep what the source saw, without the time.
    entry.startedAt = null;
    if (kind === 'start') return false;
  }

  const settled = s.settled;
  if (
    settled &&
    settled.runKey === runKey &&
    settled.kind === kind &&
    settled.currentKey === s.currentKey &&
    // A finish dealt with stays dealt with; one that happened since is new.
    (kind === 'finish' ? entry.endedAt! <= settled.at : signal.at - settled.at < SETTLED_MS)
  ) {
    return false;
  }

  const d = s.detection;
  const sameLive = d != null && d.currentKey === s.currentKey;
  const fresh = kind !== 'finish' || signal.at - entry.endedAt! <= FINISH_FRESH_MS;
  if (kind === 'finish' && sameLive && d.kind === 'advance') {
    // Not backing the advance (a finish doesn't say what's next), just timing the end.
    if (!fresh || d.endedAt === entry.endedAt) return false;
    s.detection = { ...d, endedAt: entry.endedAt ?? null };
    return true;
  }
  if (d && d.runKey === runKey && d.kind === kind && d.currentKey === s.currentKey) {
    // Twitch says the same thing each time; keep its latest word. Timer readings
    // are kept apart, since two that agree corroborate each other.
    const keep = d.signals.filter((x) => entry.startedAt != null || x.source !== entry.source);
    const signals = [...keep, entry].slice(-MAX_SIGNALS);
    const timed = signals.filter((x) => x.startedAt != null).map((x) => x.startedAt!);
    const startedAt = timed.length ? median(timed) : null;
    const ended = signals.filter((x) => x.endedAt != null).map((x) => x.endedAt!);
    s.detection = {
      ...d,
      ...(kind === 'finish' ? { endedAt: ended.length ? median(ended) : null } : {}),
      // A start time appearing changes what accepting does: a fresh id, so a tap
      // on the old banner can't back-date a run the operator didn't see a time for.
      id: d.startedAt == null && startedAt != null ? idFor(entry) : d.id,
      startedAt,
      firstAt: Math.min(d.firstAt, entry.at),
      signals,
    };
    return true;
  }
  if (!fresh) return false;
  s.detection = {
    id: idFor(entry),
    runKey,
    kind,
    currentKey: s.currentKey,
    startedAt: entry.startedAt,
    ...(kind === 'finish'
      ? { endedAt: entry.endedAt ?? null }
      : kind === 'advance' && sameLive && d.endedAt != null
        ? { endedAt: d.endedAt }
        : {}),
    firstAt: entry.at,
    signals: [entry],
  };
  return true;
}

const idFor = (x: DetectionSignal) => `${x.source}-${x.at.toString(36)}`;

/**
 * A source now sees the live run: it no longer backs the detection. A stream PC
 * timer that isn't finished any more also takes back the finish time it gave.
 */
function retract(s: RoomState, source: Signal['source']): boolean {
  const d = s.detection;
  if (!d) return false;
  const unfinish = d.kind === 'advance' && d.endedAt != null && source === 'nodecg';
  if (!unfinish && !d.signals.some((x) => x.source === source)) return false;
  const left = d.signals.filter((x) => x.source !== source);
  s.detection = left.length
    ? { ...d, signals: left, ...(unfinish ? { endedAt: null } : {}) }
    : null;
  return true;
}

/** Records that a detection was dealt with, so it isn't raised again (see `settled`). */
export function settle(s: RoomState, d: Detection, now: number): void {
  s.settled = { runKey: d.runKey, kind: d.kind, currentKey: d.currentKey, at: now };
}

/**
 * Drops a detection the room has moved past: the live run changed (an
 * operator advanced, perhaps to that very run), the run it says to start has
 * started (or to stop has stopped), its run is no longer one a detection may point at (skipped,
 * re-ordered, removed), the marathon ended, or nothing has backed it for a
 * while.
 *
 * Also lets a settled record go once the room is somewhere else entirely. It
 * stays while the room is on either side of it: where it was dealt with, or the
 * run it pointed at. Accepting moves the room to that run, so an undo (or a
 * step back) lands where it was dealt with, and the same suggestion stays down.
 */
export function reconcile(s: RoomState, lines: readonly ScheduleLine[], now: number): boolean {
  let changed = false;
  const st = s.settled;
  if (
    st &&
    ((st.currentKey !== s.currentKey && st.runKey !== s.currentKey) || now - st.at >= SETTLED_MS)
  ) {
    s.settled = null;
    changed = true;
  }
  const d = s.detection;
  if (!d) return changed;
  const last = Math.max(...d.signals.map((x) => x.at), d.firstAt);
  const moved = d.currentKey !== s.currentKey || s.finishedAt != null;
  const phase = runTiming(s.runs[d.runKey], now).phase;
  const started = d.kind === 'start' && phase !== 'setup';
  const stopped = d.kind === 'finish' && phase !== 'running';
  const gone = !reachable(s, lines, indexOfKey(lines, d.runKey));
  if (!moved && !started && !stopped && !gone && now - last <= STALE_MS) return changed;
  // Our timer stopped by hand: that finish is dealt with, and stays so if it's resumed.
  if (stopped) settle(s, d, now);
  s.detection = null;
  return true;
}

/**
 * Whether a detection is solid enough to act on without asking: a trusted
 * stream-PC source has held it for a few seconds, two different sources agree,
 * or two timer readings taken a while apart put the start at the same moment.
 */
export function corroborated(d: Detection, now: number): boolean {
  const recent = d.signals.filter((x) => now - x.at <= AGREE_WINDOW_MS);
  const trusted = recent.filter((x) => TRUSTED_SOURCES.has(x.source));
  // Any change of mind (another run, back to the live one) replaces or withdraws the
  // detection, so one still standing has held since `firstAt`.
  if (trusted.length && now - d.firstAt >= TRUSTED_SETTLE_MS) return true;
  if (new Set(recent.map((x) => x.source)).size >= 2) return true;
  const timed = recent.filter((x) => x.startedAt != null);
  return timed.some((a, i) =>
    timed.some(
      (b, j) =>
        j > i &&
        Math.abs(b.at - a.at) >= READINGS_APART_MS &&
        Math.abs(a.startedAt! - b.startedAt!) <= SAME_START_MS,
    ),
  );
}

/** "Spyro the Dragon is on stream" / "… has started on stream" / "… has finished on stream". */
export function describe(d: Detection, lines: readonly ScheduleLine[]): string {
  const line = lines[indexOfKey(lines, d.runKey)];
  const title = line ? lineTitle(line) : 'A later run';
  if (d.kind === 'start') return `${title} has started on stream`;
  if (d.kind === 'finish') return `${title} has finished on stream`;
  return `${title} is on stream`;
}

export { reachable as isReachable };
