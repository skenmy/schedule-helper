// Turns signals from the stream ("it looks like run X, started at T") into one
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
    const notStarted = runTiming(s.runs[signal.runKey], signal.at).phase === 'setup';
    if (!notStarted || signal.startedAt == null) return retract(s, signal.source);
    kind = 'start';
  } else {
    kind = 'advance';
  }

  const { runKey, ...rest } = signal;
  const entry: DetectionSignal = { ...rest };
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
    signal.at - settled.at < SETTLED_MS
  ) {
    return false;
  }

  const d = s.detection;
  if (d && d.runKey === runKey && d.kind === kind && d.currentKey === s.currentKey) {
    // Twitch says the same thing each time; keep its latest word. Timer readings
    // are kept apart, since two that agree corroborate each other.
    const keep = d.signals.filter((x) => entry.startedAt != null || x.source !== entry.source);
    const signals = [...keep, entry].slice(-MAX_SIGNALS);
    const timed = signals.filter((x) => x.startedAt != null).map((x) => x.startedAt!);
    const startedAt = timed.length ? median(timed) : null;
    s.detection = {
      ...d,
      // A start time appearing changes what accepting does: a fresh id, so a tap
      // on the old banner can't back-date a run the operator didn't see a time for.
      id: d.startedAt == null && startedAt != null ? idFor(entry) : d.id,
      startedAt,
      firstAt: Math.min(d.firstAt, entry.at),
      signals,
    };
    return true;
  }
  s.detection = {
    id: idFor(entry),
    runKey,
    kind,
    currentKey: s.currentKey,
    startedAt: entry.startedAt,
    firstAt: entry.at,
    signals: [entry],
  };
  return true;
}

const idFor = (x: DetectionSignal) => `${x.source}-${x.at.toString(36)}`;

/** A source now sees the live run: it no longer backs the detection. */
function retract(s: RoomState, source: Signal['source']): boolean {
  const d = s.detection;
  if (!d || !d.signals.some((x) => x.source === source)) return false;
  const left = d.signals.filter((x) => x.source !== source);
  s.detection = left.length ? { ...d, signals: left } : null;
  return true;
}

/** Records that a detection was dealt with, so it isn't raised again (see `settled`). */
export function settle(s: RoomState, d: Detection, now: number): void {
  s.settled = { runKey: d.runKey, kind: d.kind, currentKey: d.currentKey, at: now };
}

/**
 * Drops a detection the room has moved past: the live run changed (an
 * operator advanced, perhaps to that very run), the run it says to start has
 * started, its run is no longer one a detection may point at (skipped,
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
  const started = d.kind === 'start' && runTiming(s.runs[d.runKey], now).phase !== 'setup';
  const gone = !reachable(s, lines, indexOfKey(lines, d.runKey));
  if (!moved && !started && !gone && now - last <= STALE_MS) return changed;
  s.detection = null;
  return true;
}

/**
 * Whether a detection is solid enough to act on without asking: a trusted
 * stream-PC source reported it, two different sources agree, or two timer
 * readings taken a while apart put the start at the same moment.
 */
export function corroborated(d: Detection, now: number): boolean {
  const recent = d.signals.filter((x) => now - x.at <= AGREE_WINDOW_MS);
  if (recent.some((x) => TRUSTED_SOURCES.has(x.source))) return true;
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

/** "Spyro the Dragon is on stream" / "Spyro the Dragon has started on stream". */
export function describe(d: Detection, lines: readonly ScheduleLine[]): string {
  const line = lines[indexOfKey(lines, d.runKey)];
  const title = line ? lineTitle(line) : 'A later run';
  return d.kind === 'start' ? `${title} has started on stream` : `${title} is on stream`;
}

export { reachable as isReachable };
