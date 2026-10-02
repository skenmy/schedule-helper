// Push notifications for operators: watches every room some device follows,
// turns changes and the clock into alerts (alerts.ts), and delivers them
// through the browsers' push services (web-push, VAPID).
//
// A followed room stays loaded (its listener counts as a watcher), so timed
// alerts keep coming with nobody looking at it, and rooms with followers are
// reopened on start-up.

import webpush from 'web-push';
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

export function webPushSender(keys: VapidKeys, subject: string): PushSender {
  return async (sub, n) => {
    await webpush.sendNotification(sub, JSON.stringify(n), {
      TTL: 15 * 60,
      urgency: 'high',
      vapidDetails: { subject, publicKey: keys.publicKey, privateKey: keys.privateKey },
      timeout: 10_000,
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

export class PushService {
  readonly publicKey: string;
  readonly #registry: RoomRegistry;
  readonly #store: PushStore;
  readonly #send: PushSender;
  readonly #tickMs: number;
  readonly #watches = new Map<Room, Watch>();
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
    for (const ref of this.#store.rooms()) {
      void this.#registry
        .open(ref)
        .then((room) => this.#watch(room))
        .catch((err: Error) => log.warn(`couldn't reopen ${roomPath(ref)}: ${err.message}`));
    }
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
    this.#store.add({ ...sub, room: room.ref, user, at: Date.now() });
    this.#watch(room);
  }

  unfollow(ref: RoomRef, endpoint: string): void {
    this.#store.remove(ref, endpoint);
    const room = this.#registry.get(ref);
    if (room && !this.#store.forRoom(ref).length) this.#unwatch(room);
  }

  /** A test notification to one device, so an operator can see it works. */
  async test(room: Room, endpoint: string): Promise<void> {
    const record = this.#store.forRoom(room.ref).find((r) => r.endpoint === endpoint);
    if (!record) throw new Error('This device isn’t getting alerts for this schedule.');
    await this.#deliver(room, record, {
      title: 'Alerts are on',
      body: `This device will hear about ${room.schedule.eventName}: runners late or missing, runs well over, and run changes on stream.`,
      tag: 'test',
      actor: null,
    });
  }

  /** Checks the clock-based alerts for every followed room (also run by the timer). */
  tick(now = Date.now()): void {
    for (const w of this.#watches.values()) {
      this.#sync(w);
      this.#fanOut(w.room, timedAlerts(w.room.state, w.room.schedule.lines, now, w.sent));
    }
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
    this.#watches.set(room, w);
  }

  #unwatch(room: Room): void {
    this.#watches.get(room)?.stop();
    this.#watches.delete(room);
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
      if (status === 404 || status === 410) {
        // The browser dropped the subscription (uninstalled, permission revoked).
        this.#store.forget(record.endpoint);
        if (!this.#store.forRoom(room.ref).length) this.#unwatch(room);
      } else {
        log.warn(`push to ${new URL(record.endpoint).host} failed: ${(err as Error).message}`);
      }
      throw err;
    }
  }
}
