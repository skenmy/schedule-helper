// Turns signals from the stream ("it looks like run X, started at T") into one
// detection the operators can accept. Pure functions over a state draft, so
// every rule is unit-tested; the sources and timers live in service.ts.
//
// Sources are edge-triggered: each reports when what it sees *changes*. So a
// dismissed or undone detection isn't raised again until the stream moves on.

import { indexOfKey, lineTitle, runTiming } from '../../shared/derive.ts';
import type {
  Detection,
  DetectionSignal,
  RoomState,
  RunKey,
  ScheduleLine,
} from '../../shared/types.ts';
import { candidateIndexes } from './match.ts';

export interface Signal extends DetectionSignal {
  runKey: RunKey;
}

/** Signals older than this no longer count towards two sources agreeing. */
export const AGREE_WINDOW_MS = 10 * 60_000;
/** A detection nobody acted on, with no fresh signal, is dropped after this. */
export const STALE_MS = 20 * 60_000;
/** Two timer readings agree when the starts they imply are this close. */
const SAME_START_MS = 8_000;
/** ...and were taken at least this far apart (one frame read twice proves nothing). */
const READINGS_APART_MS = 20_000;
const MAX_SIGNALS = 8;

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
  const line = lines[index];
  if (!line || line.setupBlock || !candidateIndexes(lines, s).includes(index)) return false;

  let kind: Detection['kind'];
  if (signal.runKey === s.currentKey) {
    const notStarted = runTiming(s.runs[signal.runKey], signal.at).phase === 'setup';
    if (!notStarted || signal.startedAt == null) return retract(s, signal.source);
    kind = 'start';
  } else {
    kind = 'advance';
  }

  const { runKey, ...rest } = signal;
  const entry: DetectionSignal = rest;
  const d = s.detection;
  if (d && d.runKey === runKey && d.kind === kind && d.currentKey === s.currentKey) {
    // Twitch says the same thing each time; keep its latest word. Timer readings
    // are kept apart, since two that agree corroborate each other.
    const keep = d.signals.filter((x) => entry.startedAt != null || x.source !== entry.source);
    d.signals = [...keep, entry].slice(-MAX_SIGNALS);
    if (entry.startedAt != null) d.startedAt = entry.startedAt;
    return true;
  }
  s.detection = {
    id: `${signal.source}-${signal.at.toString(36)}`,
    runKey,
    kind,
    currentKey: s.currentKey,
    startedAt: entry.startedAt,
    firstAt: entry.at,
    signals: [entry],
  };
  return true;
}

/** A source now sees the live run: it no longer backs the detection. */
function retract(s: RoomState, source: Signal['source']): boolean {
  const d = s.detection;
  if (!d || !d.signals.some((x) => x.source === source)) return false;
  const left = d.signals.filter((x) => x.source !== source);
  s.detection = left.length ? { ...d, signals: left } : null;
  return true;
}

/**
 * Drops a detection the room has moved past: the live run changed (an
 * operator advanced, perhaps to that very run), the run it says to start has
 * started, the marathon ended, or nothing has backed it up for a while.
 */
export function reconcile(s: RoomState, now: number): boolean {
  const d = s.detection;
  if (!d) return false;
  const last = Math.max(...d.signals.map((x) => x.at), d.firstAt);
  const moved = d.currentKey !== s.currentKey || s.finishedAt != null;
  const started = d.kind === 'start' && runTiming(s.runs[d.runKey], now).phase !== 'setup';
  if (!moved && !started && now - last <= STALE_MS) return false;
  s.detection = null;
  return true;
}

/**
 * Whether a detection is solid enough to act on without asking: two different
 * sources agree, or two timer readings taken a while apart put the start at
 * the same moment (the stream's timer is visibly running).
 */
export function corroborated(d: Detection, now: number): boolean {
  const recent = d.signals.filter((x) => now - x.at <= AGREE_WINDOW_MS);
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
