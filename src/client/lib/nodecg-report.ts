// What the NodeCG bridge page (bridge.ts) reads and sends, kept pure so it's
// tested. The bundle in integrations/nodecg-schedule-helper builds the same
// report in plain CommonJS; keep the two in step.

import type { NodecgReport } from '../../shared/protocol.ts';
import { isValidRef } from '../../shared/sources.ts';
import type { RoomRef, ScheduleSource } from '../../shared/types.ts';

export interface RunData {
  externalID?: string | number;
  game?: string;
  category?: string;
  teams?: { players?: { name?: string }[] }[];
}
export interface Timer {
  state?: 'stopped' | 'running' | 'paused' | 'finished';
  milliseconds?: number;
  timestamp?: number;
}

/**
 * Speedcontrol ticks every 100 ms; between ticks, add the time since its last
 * one. Clamped: the bridge's clock and NodeCG's may differ, and right after a
 * resume `timestamp` can be from before the pause.
 */
const sinceTick = (timer: Timer, now: number) =>
  timer.state === 'running' && timer.timestamp
    ? Math.min(1_000, Math.max(0, now - timer.timestamp))
    : 0;

export function buildReport(
  run: RunData | undefined | null,
  timer: Timer | undefined | null,
  now = Date.now(),
): Omit<NodecgReport, 't'> {
  return {
    via: 'bridge',
    run: run
      ? {
          externalID: run.externalID != null ? String(run.externalID) : null,
          game: run.game || null,
          category: run.category || null,
          players: (run.teams ?? [])
            .flatMap((t) => (t.players ?? []).map((p) => p?.name ?? ''))
            .filter(Boolean)
            .slice(0, 32),
        }
      : null,
    timer: timer?.state
      ? {
          state: timer.state,
          elapsedMs: Math.round(Math.max(0, (timer.milliseconds ?? 0) + sinceTick(timer, now))),
        }
      : null,
  };
}

/** A `replicant:declare` acknowledgement: NodeCG 1 sends `(data)`, NodeCG 2 `(error, data)`. */
export function ackValue<T>(args: unknown[]): T | undefined {
  const [error, data] = args.length > 1 ? args : [null, args[0]];
  return error ? undefined : (data as { value?: T } | undefined)?.value;
}

export interface BridgeParams {
  room: RoomRef;
  /** NodeCG's address, as the stream PC sees it. */
  nodecg: string;
  token: string;
  /** NodeCG's login key, when it has one (sent as NodeCG's `token` query). */
  key: string | null;
}

/**
 * The bridge's address: `?room=oengus/event/slug&nodecg=http://localhost:9090`
 * and, in the fragment so it never reaches a server log, `#t=TOKEN[&key=KEY]`.
 */
export function parseBridgeParams(search: string, hash: string): BridgeParams | string {
  const q = new URLSearchParams(search);
  const f = new URLSearchParams(hash.replace(/^#/, ''));
  const [source, event, slug, ...rest] = (q.get('room') ?? '').split('/');
  const room = { source: source as ScheduleSource, event: event ?? '', slug: slug ?? '' };
  if (rest.length || !isValidRef(room)) {
    return 'This address has no schedule in it. Copy it again from Schedule Helper (Stream capture → Stream PC).';
  }
  const token = f.get('t') ?? '';
  if (!/^[\w-]{22}$/.test(token)) {
    return 'This address has no stream PC token. Copy it again from Schedule Helper.';
  }
  let nodecg: URL;
  try {
    nodecg = new URL(q.get('nodecg') || 'http://localhost:9090');
  } catch {
    return 'The NodeCG address isn’t a web address. It looks like http://localhost:9090.';
  }
  if (nodecg.protocol !== 'http:' && nodecg.protocol !== 'https:') {
    return 'The NodeCG address must start with http:// or https://.';
  }
  return { room, nodecg: nodecg.origin, token, key: f.get('key') || null };
}
