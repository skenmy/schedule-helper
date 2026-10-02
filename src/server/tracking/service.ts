// Auto-tracking: follows the stream to notice run changes. Sources report what
// the stream looks like; detect.ts folds that into one suggestion on the room;
// operators accept it with a tap, or it applies itself when auto-apply is on and
// two independent signals agree. Sources so far:
//   - twitch: the channel's category and title, polled (this file);
//   - vision: stream captures, read by Claude (fed in from capture/service.ts).
// A stream-PC source (NodeCG speedcontrol, a timer bridge) plugs in the same
// way: build a Signal and call `signal(room, …)`.

import { normalizeTwitchChannel } from '../../shared/sources.ts';
import { fmtHMS } from '../../shared/time.ts';
import type { CaptureResult, RoomState } from '../../shared/types.ts';
import { logger } from '../logger.ts';
import type { RoomRegistry } from '../rooms/registry.ts';
import type { Room } from '../rooms/room.ts';
import { corroborated, observe, reconcile, type Signal } from './detect.ts';
import { matchStream } from './match.ts';
import type { ChannelInfo, StreamLookup } from './twitch.ts';

const log = logger('tracking');
/** Shown in the log and undo label for changes auto-apply makes. */
export const AUTO_ACTOR = 'Auto-tracking';

export function channelOf(room: Room): string {
  return room.state.twitchChannel || normalizeTwitchChannel(room.schedule.twitch);
}

/** Feeds one signal to a room's detection, then acts on it if allowed. */
export function signal(room: Room, sig: Signal): void {
  // Try it on a copy first, so a signal that changes nothing doesn't bump the revision.
  if (observe(structuredClone(room.state), room.schedule.lines, sig)) {
    room.mutate((s) => void observe(s, room.schedule.lines, sig));
  }
  maybeAutoApply(room);
}

/** Applies the room's detection when auto-apply is on and two signals agree. */
export function maybeAutoApply(room: Room, now = Date.now()): void {
  const d = room.state.detection;
  if (!d || !room.state.tracking.autoApply || !corroborated(d, now)) return;
  const res = room.dispatch({ action: 'detection:accept', id: d.id }, AUTO_ACTOR);
  if (!res.ok) log.warn(`${room.key}: auto-apply refused: ${res.message}`);
  else log.info(`${room.key}: auto-applied ${d.kind} to ${d.runKey}`);
}

// ─── Twitch ──────────────────────────────────────────────────────────────────

/** The last channel info each room acted on: sources report changes, not levels. */
const lastSeen = new WeakMap<Room, string>();

const sameInfo = (a: RoomState['stream'], b: ChannelInfo) =>
  a != null && a.error == null && a.live === b.live && a.game === b.game && a.title === b.title;

/** Records what Twitch reports for a room and, when it changed, looks for a run change. */
export function observeTwitch(room: Room, info: ChannelInfo, now = Date.now()): void {
  if (!sameInfo(room.state.stream, info)) {
    room.mutate((s) => {
      s.stream = { ...info, at: now, error: null };
    });
  }
  const fingerprint = info.live ? `${info.game}\n${info.title}` : 'offline';
  if (lastSeen.get(room) === fingerprint) return;
  lastSeen.set(room, fingerprint);
  if (!info.live) return;
  const match = matchStream(room.schedule.lines, room.state, info);
  if (!match) return;
  signal(room, {
    runKey: match.key,
    source: 'twitch',
    at: now,
    detail: `Twitch ${match.detail}`,
    startedAt: null,
  });
}

function reportError(room: Room, error: string, now: number): void {
  if (room.state.stream?.error === error) return;
  room.mutate((s) => {
    s.stream = { live: false, game: null, title: null, at: now, error };
  });
}

/** Polls Twitch for every watched room with Twitch tracking on. */
export async function pollTwitch(
  registry: RoomRegistry,
  lookup: StreamLookup | null,
): Promise<void> {
  const now = Date.now();
  const rooms = [...registry.all()].filter(
    (r) => r.state.tracking.twitch && r.watcherCount > 0 && channelOf(r),
  );
  if (!rooms.length) return;
  if (!lookup) {
    for (const r of rooms) {
      reportError(r, 'Twitch isn’t set up on the server (TWITCH_CLIENT_ID / SECRET).', now);
    }
    return;
  }
  let infos: Map<string, ChannelInfo>;
  try {
    infos = await lookup.lookup(rooms.map(channelOf));
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log.warn(`lookup failed: ${message}`);
    for (const r of rooms) reportError(r, message, now);
    return;
  }
  for (const r of rooms) {
    const info = infos.get(channelOf(r));
    if (info) observeTwitch(r, info, now);
  }
}

// ─── Vision ──────────────────────────────────────────────────────────────────

/**
 * Turns a stream capture into a signal, inside the capture's own state change.
 * Like Twitch, only a change counts: the run read, or its timer starting.
 * Repeats of the same reading only add weight to a detection already raised.
 */
export function observeCapture(
  s: RoomState,
  room: Pick<Room, 'schedule'>,
  prev: CaptureResult | null,
  c: CaptureResult,
): void {
  if (!s.tracking.vision || c.error || !c.runKey || c.confidence === 'low') return;
  const running = c.elapsedSec != null && c.elapsedSec > 0;
  const prevRunning = prev?.elapsedSec != null && prev.elapsedSec > 0;
  const repeat = prev != null && !prev.error && prev.runKey === c.runKey && prevRunning === running;
  if (repeat && s.detection?.runKey !== c.runKey) return;
  observe(s, room.schedule.lines, {
    runKey: c.runKey,
    source: 'vision',
    at: c.at,
    detail: running ? `Stream timer at ${fmtHMS(c.elapsedSec!)}` : 'Stream shows the run',
    startedAt: running ? c.at - c.elapsedSec! * 1000 : null,
  });
}

// ─── Scheduler ───────────────────────────────────────────────────────────────

export function startTracking(
  registry: RoomRegistry,
  opts: { lookup: StreamLookup | null; tickMs: number },
): () => void {
  let busy = false;
  const timer = setInterval(() => {
    if (busy) return;
    busy = true;
    const now = Date.now();
    // Stale suggestions go even when nothing new arrives.
    for (const room of registry.all()) {
      const draft = structuredClone(room.state);
      if (reconcile(draft, now)) room.mutate((s) => void reconcile(s, now));
    }
    pollTwitch(registry, opts.lookup)
      .catch((err) => log.error('poll failed', err))
      .finally(() => (busy = false));
  }, opts.tickMs);
  timer.unref();
  return () => clearInterval(timer);
}
