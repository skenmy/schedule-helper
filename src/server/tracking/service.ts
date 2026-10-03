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
import type {
  CaptureResult,
  RoomState,
  SignalSource,
  TrackingSettings,
} from '../../shared/types.ts';
import { logger } from '../logger.ts';
import type { RoomRegistry } from '../rooms/registry.ts';
import type { Room } from '../rooms/room.ts';
import {
  corroborated,
  observe,
  reconcile,
  TRUSTED_SETTLE_MS,
  TRUSTED_SOURCES,
  type Signal,
} from './detect.ts';
import { matchStream } from './match.ts';
import type { ChannelInfo, StreamLookup } from './twitch.ts';

const log = logger('tracking');
/** Shown in the log and undo label for changes auto-apply makes. */
export const AUTO_ACTOR = 'Auto-tracking';

export function channelOf(room: Room): string {
  return room.state.twitchChannel || normalizeTwitchChannel(room.schedule.twitch);
}

/** Whether a source is switched on for the room (stream-PC sources are on when they post). */
function enabled(t: TrackingSettings, source: SignalSource): boolean {
  if (source === 'twitch') return t.twitch;
  if (source === 'vision') return t.vision;
  // Rooms saved before the setting existed have no value: on.
  if (source === 'nodecg') return t.nodecg !== false;
  return true;
}

/** Feeds one signal to a room's detection, then acts on it if allowed. */
export function signal(room: Room, sig: Signal): void {
  // A source switched off mid-flight (a poll in progress) has nothing to say.
  if (!enabled(room.state.tracking, sig.source)) return;
  // Try it on a copy first, so a signal that changes nothing doesn't bump the revision.
  if (observe(structuredClone(room.state), room.schedule.lines, sig)) {
    room.mutate((s) => void observe(s, room.schedule.lines, sig));
  }
  maybeAutoApply(room, sig.at);
  scheduleSettled(room, sig.at);
}

const settleTimers = new WeakMap<Room, NodeJS.Timeout>();

/**
 * A detection the stream PC backs, waiting out `TRUSTED_SETTLE_MS`: check again
 * the moment that's up, not when its next report (up to 15 s away) happens to come.
 */
function scheduleSettled(room: Room, now: number): void {
  clearTimeout(settleTimers.get(room));
  settleTimers.delete(room);
  const d = room.state.detection;
  if (!d || !room.state.tracking.autoApply) return;
  if (!d.signals.some((x) => TRUSTED_SOURCES.has(x.source))) return;
  const wait = d.firstAt + TRUSTED_SETTLE_MS - now;
  if (wait <= 0) return;
  const timer = setTimeout(() => {
    settleTimers.delete(room);
    maybeAutoApply(room);
  }, wait + 50);
  timer.unref();
  settleTimers.set(room, timer);
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

/**
 * The run each room's Twitch info last pointed at. Only a change of run is a
 * signal: retitling the stream (donation totals) or a blip offline isn't. A
 * dismissed or undone suggestion is kept down by `state.settled`, which also
 * survives a restart that loses this.
 */
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
  if (!info.live) return;
  const match = matchStream(room.schedule.lines, room.state, info);
  const fingerprint = match?.key ?? '';
  if (lastSeen.get(room) === fingerprint) return;
  lastSeen.set(room, fingerprint);
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
  const all = [...registry.all()].filter(
    (r) => r.state.tracking.twitch && r.watcherCount > 0 && channelOf(r),
  );
  if (!all.length) return;
  // Twitch logins are 4–25 characters; a shorter one would fail the whole batch.
  const rooms = all.filter((r) => channelOf(r).length >= 4);
  for (const r of all) {
    if (!rooms.includes(r)) reportError(r, `“${channelOf(r)}” isn’t a Twitch channel name.`, now);
  }
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
    // Switched off while we were asking: nothing to record.
    if (info && r.state.tracking.twitch) observeTwitch(r, info, now);
  }
}

// ─── Vision ──────────────────────────────────────────────────────────────────

/**
 * Turns a stream capture into a signal, inside the capture's own state change.
 * Every usable reading counts (repeats add weight to a detection, and a run's
 * timer starting after an operator advanced by hand is still noticed); what
 * was already dealt with stays down through `state.settled`. Failed,
 * low-confidence and unmatched readings say nothing.
 */
export function observeCapture(s: RoomState, room: Pick<Room, 'schedule'>, c: CaptureResult): void {
  if (!s.tracking.vision || c.error || !c.runKey || c.confidence === 'low') return;
  // No timer visible is "unknown", not "stopped".
  const running = c.elapsedSec != null && c.elapsedSec > 0;
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
      if (!room.state.detection && !room.state.settled) continue;
      const lines = room.schedule.lines;
      if (reconcile(structuredClone(room.state), lines, now)) {
        room.mutate((s) => void reconcile(s, lines, now));
      }
    }
    pollTwitch(registry, opts.lookup)
      .catch((err) => log.error('poll failed', err))
      .finally(() => (busy = false));
  }, opts.tickMs);
  timer.unref();
  return () => clearInterval(timer);
}
