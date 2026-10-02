// Stream capture: grab a frame, read it with Claude, compare the stream's timer
// with ours, and store the result on the room. Also runs the periodic captures
// for rooms that opt in: the auto drift check, and auto-tracking's stream
// reading (tracking/service.ts), which looks more often around run changes.

import { randomUUID } from 'node:crypto';
import {
  currentIndex,
  indexOfKey,
  lineTitle,
  prevPlayableIndex,
  runTiming,
  scheduledStartOf,
} from '../../shared/derive.ts';
import { normalizeTwitchChannel } from '../../shared/sources.ts';
import { fmtDelta } from '../../shared/time.ts';
import type { CaptureResult, RoomState, RunKey, ScheduleLine } from '../../shared/types.ts';
import { logger } from '../logger.ts';
import { appendLog } from '../rooms/reducer.ts';
import type { RoomRegistry } from '../rooms/registry.ts';
import type { Room } from '../rooms/room.ts';
import { maybeAutoApply, observeCapture } from '../tracking/service.ts';
import { grabFrame } from './frame.ts';
import { readFrame, type VisionReading } from './vision.ts';

const log = logger('capture');
const MAX_GAME_NAMES = 200;
const MIN = 60_000;
/** Auto-tracking reads the stream this often when a run change is due… */
const TRANSITION_MS = MIN;
/** …and this often in the middle of a run, in case it ended early. */
const QUIET_MS = 10 * MIN;
/** "Due" means within this of the live run's estimated end, or between runs. */
const DUE_WINDOW_MS = 10 * MIN;
/** Due this long with nothing changing (an overnight break, a long overrun): slow down. */
const DUE_GIVE_UP_MS = 30 * MIN;

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '');

/**
 * Maps the game Claude read to a schedule line. The same game can appear more
 * than once (relays, category extensions), so prefer the current run, then the
 * nearest one after it.
 */
export function matchRunKey(
  lines: readonly ScheduleLine[],
  currentKey: RunKey | null,
  game: string | null,
): RunKey | null {
  if (!game) return null;
  const target = norm(game);
  if (!target) return null;
  let candidates = lines.filter((l) => !l.setupBlock && norm(l.game) === target);
  if (!candidates.length && target.length >= 4) {
    candidates = lines.filter((l) => {
      const g = norm(l.game);
      return !l.setupBlock && g.length >= 4 && (g.includes(target) || target.includes(g));
    });
  }
  if (!candidates.length) return null;
  if (currentKey && candidates.some((l) => l.key === currentKey)) return currentKey;
  const cur = indexOfKey(lines, currentKey);
  const after = candidates.find((l) => indexOfKey(lines, l.key) > cur);
  return (after ?? candidates[0]!).key;
}

/** Compares a reading taken at `at` against our timer for the run current at that moment. */
export function evaluateReading(
  lines: readonly ScheduleLine[],
  snapshot: Pick<RoomState, 'currentKey' | 'runs'>,
  reading: VisionReading,
  at: number,
): Pick<CaptureResult, 'runKey' | 'ourElapsedSec' | 'driftSec' | 'currentKey'> {
  const currentKey = snapshot.currentKey;
  const runKey = matchRunKey(lines, currentKey, reading.game);
  const rec = currentKey ? snapshot.runs[currentKey] : undefined;
  let ourElapsedSec: number | null = null;
  if (rec?.startedAt != null && at >= rec.startedAt) {
    ourElapsedSec = Math.round((Math.min(at, rec.endedAt ?? at) - rec.startedAt) / 1000);
  }
  const sameRun = runKey == null || runKey === currentKey;
  const driftSec =
    sameRun && reading.elapsedSec != null && ourElapsedSec != null
      ? reading.elapsedSec - ourElapsedSec
      : null;
  return { runKey, ourElapsedSec, driftSec, currentKey };
}

/** Auto checks log a warning when something is off, without repeating themselves. */
function warn(
  s: RoomState,
  lines: readonly ScheduleLine[],
  prev: CaptureResult | null,
  c: CaptureResult,
): void {
  const title = (key: RunKey | null) => {
    const line = lines[indexOfKey(lines, key)];
    return line ? lineTitle(line) : 'unknown run';
  };
  let text: string | null = null;
  if (c.error) {
    if (!(prev?.auto && prev.error === c.error)) text = `⚠ Auto drift check failed: ${c.error}`;
  } else if (c.runKey && c.currentKey && c.runKey !== c.currentKey) {
    if (!(prev?.auto && prev.runKey === c.runKey && prev.currentKey === c.currentKey)) {
      text = `⚠ Stream shows ${title(c.runKey)}, but the current run is ${title(c.currentKey)}`;
    }
  } else if (c.driftSec != null && Math.abs(c.driftSec) > s.drift.thresholdSec) {
    const repeat =
      prev?.auto &&
      prev.currentKey === c.currentKey &&
      prev.driftSec != null &&
      Math.abs(prev.driftSec - c.driftSec) < 2;
    if (!repeat) {
      text = `⚠ Stream timer is ${fmtDelta(c.driftSec)} vs ours on ${title(c.currentKey)}`;
    }
  }
  if (text) appendLog(s, { kind: 'warning', text, runKey: c.currentKey, actor: null, at: c.at });
}

export async function runCapture(
  room: Room,
  { auto, actor }: { auto: boolean; actor: string | null },
): Promise<void> {
  if (room.state.captureBusy) return;
  const epoch = room.epoch;
  const channel = room.state.twitchChannel || normalizeTwitchChannel(room.schedule.twitch);
  const base: CaptureResult = {
    id: `${Date.now().toString(36)}${randomUUID().slice(0, 6)}`,
    at: Date.now(),
    auto,
    by: actor,
    channel,
    error: null,
    elapsedSec: null,
    estimateSec: null,
    game: null,
    runKey: null,
    confidence: null,
    ourElapsedSec: null,
    driftSec: null,
    currentKey: room.state.currentKey,
  };

  let result: CaptureResult;
  if (!channel) {
    result = { ...base, error: 'Set a Twitch channel first.' };
  } else {
    room.mutate((s) => {
      s.captureBusy = true;
    });
    try {
      const frame = await grabFrame(channel);
      const snapshot = structuredClone({
        currentKey: room.state.currentKey,
        runs: room.state.runs,
      });
      if (room.epoch === epoch) room.addFrame(base.id, frame);
      const names = [
        ...new Set(room.schedule.lines.filter((l) => !l.setupBlock && l.game).map((l) => l.game)),
      ];
      const reading = await readFrame(frame, names.slice(0, MAX_GAME_NAMES));
      result = {
        ...base,
        at: frame.at,
        elapsedSec: reading.elapsedSec,
        estimateSec: reading.estimateSec,
        game: reading.game,
        confidence: reading.confidence,
        ...evaluateReading(room.schedule.lines, snapshot, reading, frame.at),
      };
      log.info(
        `${room.key}: ${channel} → ${reading.game ?? '?'} @ ${reading.elapsedSec ?? '?'}s (drift ${result.driftSec ?? '—'})`,
      );
    } catch (err) {
      result = { ...base, error: err instanceof Error ? err.message : String(err) };
      log.warn(`${room.key}: capture failed: ${result.error}`);
    }
  }

  room.mutate((s) => {
    const prev = s.capture;
    s.captureBusy = false;
    // The room was reset while we were reading: the result belongs to the old run.
    if (room.epoch !== epoch) return;
    s.capture = result;
    // Drift warnings are about a live run, whichever feature took the reading.
    const line = room.schedule.lines[currentIndex(room.schedule.lines, s)];
    const live = line && runTiming(s.runs[line.key], result.at).phase === 'running';
    if (auto && s.drift.enabled && live) warn(s, room.schedule.lines, prev, result);
    observeCapture(s, room, result);
  });
  maybeAutoApply(room);
}

/**
 * How long to wait between automatic captures of a room right now, or null
 * for none. The drift check runs at its own interval while a run is live.
 * Stream reading for auto-tracking runs every minute while a suggestion waits
 * for a second reading or a change is due (near the live run's estimated end,
 * between runs, around the marathon's start), and every ten otherwise — about
 * $0.01 a reading. Due for half an hour with nothing happening (a break, a long
 * overrun) drops back to every ten; Twitch saying the channel is offline stops it.
 */
export function captureInterval(
  state: RoomState,
  lines: readonly ScheduleLine[],
  now: number,
): number | null {
  if (state.finishedAt != null) return null;
  const index = currentIndex(lines, state);
  const line = lines[index];
  const timing = line ? runTiming(state.runs[line.key], now) : null;
  const every: number[] = [];
  if (state.drift.enabled && timing?.phase === 'running') every.push(state.drift.intervalMin * MIN);
  const offline =
    state.tracking.twitch && state.stream?.error == null && state.stream?.live === false;
  // A live run that's gone from the schedule stops detection, so don't pay to read for it.
  if (state.tracking.vision && !offline && !(state.currentKey && index < 0)) {
    /** When a run change became due, or null if it isn't. */
    let dueSince: number | null;
    if (!line) {
      const start = scheduledStartOf(lines);
      dueSince = start == null ? null : start - DUE_WINDOW_MS;
      if (start == null) every.push(QUIET_MS);
    } else if (timing!.phase === 'running') {
      dueSince = timing!.startedAt! + line.estimateSec * 1000 - DUE_WINDOW_MS;
    } else {
      // Setting up (since the previous run ended) or finished (since it ended).
      const prev = prevPlayableIndex(lines, state.runs, index);
      dueSince =
        timing!.endedAt ?? (prev >= 0 ? (state.runs[lines[prev]!.key]?.endedAt ?? now) : now);
    }
    if (state.detection) every.push(TRANSITION_MS);
    else if (dueSince != null && now >= dueSince) {
      every.push(now - dueSince < DUE_GIVE_UP_MS ? TRANSITION_MS : QUIET_MS);
    } else if (line) every.push(QUIET_MS); // mid-run, in case it ends early
    // Before the marathon and not near its start: nothing to read yet.
  }
  return every.length ? Math.min(...every) : null;
}

/** Periodically captures for rooms with the drift check or stream reading on (see captureInterval). */
export function startDriftScheduler(registry: RoomRegistry, tickMs = 20_000): () => void {
  const lastRun = new WeakMap<Room, number>();
  const timer = setInterval(() => {
    const now = Date.now();
    for (const room of registry.all()) {
      // Only while an operator has the room open (not kiosks or viewers): each reading costs money.
      if (room.state.captureBusy || ![...room.clients].some((c) => c.operator)) continue;
      const every = captureInterval(room.state, room.schedule.lines, now);
      if (every == null) continue;
      const last = Math.max(lastRun.get(room) ?? 0, room.state.capture?.at ?? 0);
      if (now - last < every) continue;
      lastRun.set(room, now);
      void runCapture(room, { auto: true, actor: null });
    }
  }, tickMs);
  timer.unref();
  return () => clearInterval(timer);
}
