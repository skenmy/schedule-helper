// Push notifications for operators: watches every room some device follows,
// turns changes and the clock into alerts (alerts.ts), and delivers them
// through the browsers' push services (web-push, VAPID).
//
// A followed room stays loaded (its listener counts as a watcher), so timed
// alerts keep coming with nobody looking at it, and rooms with followers are
// reopened on start-up.

import dns from 'node:dns';
import https from 'node:https';
import net from 'node:net';
import { parse as legacyParse } from 'node:url';
import webpush from 'web-push';
import { isPushEndpoint } from '../../shared/protocol.ts';
import { scheduledEndOf } from '../../shared/derive.ts';
import { roomPath } from '../../shared/sources.ts';
import type { RoomRef, RoomState } from '../../shared/types.ts';
import { logger } from '../logger.ts';
import type { RoomRegistry } from '../rooms/registry.ts';
import type { Room } from '../rooms/room.ts';
import { changeAlerts, timedAlerts, type Alert } from './alerts.ts';
import type { VapidKeys } from './keys.ts';
import type { DeviceSubscription, PushRecord, PushStore } from './store.ts';

const log = logger('push');
/** More than this many alerts at once become one summary, not a buzzing phone. */
const MAX_BATCH = 3;

export interface Notification {
  title: string;
  body: string;
  tag: string;
  /** Where tapping it goes. */
  url: string;
}

/** Sends one notification to one device; rejects with `statusCode` on failure. */
export type PushSender = (sub: DeviceSubscription, n: Notification) => Promise<void>;

/** Addresses a push service never lives at: whatever a hostname resolves to, don't go there. */
const PRIVATE = new net.BlockList();
for (const [net4, bits] of [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  ['172.16.0.0', 12],
  ['192.168.0.0', 16],
] as const) {
  PRIVATE.addSubnet(net4, bits, 'ipv4');
}
for (const [net6, bits] of [
  ['::', 127],
  ['fc00::', 7],
  ['fe80::', 10],
] as const) {
  PRIVATE.addSubnet(net6, bits, 'ipv6');
}

export function isPrivateAddress(address: string): boolean {
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(address)?.[1];
  if (mapped) return PRIVATE.check(mapped, 'ipv4');
  return PRIVATE.check(address, net.isIPv6(address) ? 'ipv6' : 'ipv4');
}

/** Resolves like Node does, but refuses private, loopback and link-local answers. */
const publicLookup: typeof dns.lookup = ((
  hostname: string,
  options: dns.LookupOptions,
  callback: (...args: unknown[]) => void,
) => {
  dns.lookup(hostname, { ...options, all: true }, (err, addresses) => {
    if (err) return callback(err);
    const list = addresses as dns.LookupAddress[];
    if (!list.length || list.some((a) => isPrivateAddress(a.address))) {
      return callback(new Error(`refused to send to ${hostname}: not a public address`));
    }
    if (options.all) return callback(null, list);
    callback(null, list[0]!.address, list[0]!.family);
  });
}) as typeof dns.lookup;

export function webPushSender(keys: VapidKeys, subject: string): PushSender {
  const agent = new https.Agent({ keepAlive: true, lookup: publicLookup });
  return async (sub, n) => {
    // Checked when it was stored; checked again with the parser web-push itself uses.
    if (
      !isPushEndpoint(sub.endpoint) ||
      legacyParse(sub.endpoint).hostname !== new URL(sub.endpoint).hostname
    ) {
      throw Object.assign(new Error('not a push service endpoint'), { statusCode: 410 });
    }
    await webpush.sendNotification(sub, JSON.stringify(n), {
      TTL: 15 * 60,
      urgency: 'high',
      vapidDetails: { subject, publicKey: keys.publicKey, privateKey: keys.privateKey },
      timeout: 10_000,
      agent,
    });
  };
}

interface Watch {
  room: Room;
  seen: RoomState;
  epoch: number;
  sent: Set<string>;
  stop: () => void;
}

/** A device the push service won't take messages for any more (gone, or our keys changed). */
const GONE = new Set([401, 403, 404, 410]);
/** Enough for every operator's phone and tablet at an event. */
export const MAX_FOLLOWERS = 100;
/** A finished marathon is let go this long after it ends (records are kept for next time). */
const RETIRE_AFTER_MS = 2 * 3_600_000;
/** How often to retry reopening a followed room that couldn't be loaded. */
const REOPEN_EVERY_MS = 5 * 60_000;

export class FollowRefused extends Error {}

export class PushService {
  readonly publicKey: string;
  readonly #registry: RoomRegistry;
  readonly #store: PushStore;
  readonly #send: PushSender;
  readonly #tickMs: number;
  readonly #watches = new Map<Room, Watch>();
  /** When each followed room was last tried, so a failing one is retried, slowly. */
  readonly #opened = new Map<string, number>();
  #timer: NodeJS.Timeout | null = null;

  constructor(opts: {
    registry: RoomRegistry;
    store: PushStore;
    publicKey: string;
    send: PushSender;
    tickMs?: number;
  }) {
    this.#registry = opts.registry;
    this.#store = opts.store;
    this.publicKey = opts.publicKey;
    this.#send = opts.send;
    this.#tickMs = opts.tickMs ?? 30_000;
  }

  /** Reopens followed rooms and starts the clock for timed alerts. */
  start(): void {
    this.#reopen(Date.now());
    this.#timer = setInterval(() => this.tick(), this.#tickMs);
    this.#timer.unref();
  }

  stop(): void {
    if (this.#timer) clearInterval(this.#timer);
    for (const w of this.#watches.values()) w.stop();
    this.#watches.clear();
  }

  isOn(ref: RoomRef, endpoint: string): boolean {
    return this.#store.has(ref, endpoint);
  }

  follow(room: Room, sub: DeviceSubscription, user: string | null): void {
    const followers = this.#store.forRoom(room.ref);
    if (followers.length >= MAX_FOLLOWERS && !followers.some((r) => r.endpoint === sub.endpoint)) {
      throw new FollowRefused(`At most ${MAX_FOLLOWERS} devices can get alerts for a schedule.`);
    }
    this.#store.add({ ...sub, room: room.ref, user, at: Date.now() });
    this.#watch(room);
  }

  unfollow(ref: RoomRef, endpoint: string): void {
    this.#store.remove(ref, endpoint);
    this.#release();
  }

  /** A test notification to one device, so an operator can see it works. */
  async test(room: Room, endpoint: string): Promise<void> {
    const record = this.#store.forRoom(room.ref).find((r) => r.endpoint === endpoint);
    if (!record) throw new FollowRefused('This device isn’t getting alerts for this schedule.');
    await this.#deliver(room, record, {
      title: 'Alerts are on',
      body: `This device will hear about ${room.schedule.eventName}: runners late or missing, runs well over, and run changes on stream.`,
      tag: 'test',
      actor: null,
    });
  }

  /** Checks the clock-based alerts for every followed room (also run by the timer). */
  tick(now = Date.now()): void {
    this.#reopen(now);
    for (const w of [...this.#watches.values()]) {
      if (this.#retired(w.room, now)) {
        this.#unwatch(w.room);
        continue;
      }
      this.#sync(w);
      this.#fanOut(w.room, timedAlerts(w.room.state, w.room.schedule.lines, now, w.sent));
    }
  }

  /** Watches every followed room that's live, loading any that aren't loaded (retrying failures). */
  #reopen(now: number): void {
    for (const ref of this.#store.rooms()) {
      const room = this.#registry.get(ref);
      if (room) {
        if (!this.#watches.has(room) && !this.#retired(room, now)) this.#watch(room);
        continue;
      }
      const key = roomPath(ref);
      if (now - (this.#opened.get(key) ?? 0) < REOPEN_EVERY_MS) continue;
      this.#opened.set(key, now);
      void this.#registry
        .open(ref)
        .then((r) => {
          if (!this.#retired(r, Date.now()) && this.#store.forRoom(ref).length) this.#watch(r);
        })
        .catch((err: Error) => log.warn(`couldn't reopen ${key}: ${err.message}`));
    }
  }

  /**
   * Done with: finished a while ago, or a day past the end of its schedule with
   * nothing live. It's let go (and can be evicted); following it again, or
   * anyone opening it, brings it back.
   */
  #retired(room: Room, now: number): boolean {
    const s = room.state;
    if (s.finishedAt != null) return now - s.finishedAt > RETIRE_AFTER_MS;
    const end = scheduledEndOf(room.schedule.lines);
    return end != null && now - end > 24 * 3_600_000 && s.currentKey == null;
  }

  #watch(room: Room): void {
    if (this.#watches.has(room)) return;
    const w: Watch = {
      room,
      seen: room.state,
      epoch: room.epoch,
      sent: new Set(),
      stop: room.subscribe(() => this.#changed(w)),
    };
    // What's already due was due before this watch (a restart, a new follower): it's not news.
    timedAlerts(room.state, room.schedule.lines, Date.now(), w.sent);
    this.#watches.set(room, w);
  }

  #unwatch(room: Room): void {
    this.#watches.get(room)?.stop();
    this.#watches.delete(room);
  }

  /** Lets go of every watched room nobody follows any more. */
  #release(): void {
    for (const room of [...this.#watches.keys()]) {
      if (!this.#store.forRoom(room.ref).length) this.#unwatch(room);
    }
  }

  /** A reset starts the marathon over: what was already said can be said again. */
  #sync(w: Watch): void {
    if (w.epoch === w.room.epoch) return;
    w.epoch = w.room.epoch;
    w.sent.clear();
  }

  #changed(w: Watch): void {
    const prev = w.seen;
    w.seen = w.room.state;
    this.#sync(w);
    this.#fanOut(w.room, changeAlerts(prev, w.room.state, w.room.schedule.lines));
  }

  #fanOut(room: Room, alerts: Alert[]): void {
    if (!alerts.length) return;
    const batch =
      alerts.length > MAX_BATCH
        ? [
            ...alerts.slice(0, MAX_BATCH - 1),
            {
              title: `${alerts.length - MAX_BATCH + 1} more alerts`,
              body: 'Open the app to see them all in the log.',
              tag: 'more',
              actor: null,
            },
          ]
        : alerts;
    for (const record of this.#store.forRoom(room.ref)) {
      for (const alert of batch) {
        // Nobody needs telling about what they just did themselves.
        if (alert.actor && record.user && alert.actor === record.user) continue;
        void this.#deliver(room, record, alert).catch(() => {});
      }
    }
  }

  async #deliver(room: Room, record: PushRecord, alert: Alert): Promise<void> {
    try {
      await this.#send(record, {
        title: `${alert.title} · ${room.schedule.eventName}`,
        body: alert.body,
        tag: `${room.key}:${alert.tag}`,
        url: roomPath(room.ref),
      });
    } catch (err) {
      const status = (err as { statusCode?: number }).statusCode;
      if (status != null && GONE.has(status)) {
        // Uninstalled, permission revoked, or subscribed with keys we no longer have.
        this.#store.forget(record.endpoint);
        this.#release();
      } else {
        log.warn(`push to ${new URL(record.endpoint).host} failed: ${(err as Error).message}`);
      }
      throw err;
    }
  }
}
