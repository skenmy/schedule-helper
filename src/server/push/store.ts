// Which devices want alerts for which rooms. One record per device and room,
// kept in DATA_DIR so a restart doesn't silently stop anyone's notifications.

import fs from 'node:fs';
import path from 'node:path';
import { roomKey } from '../../shared/sources.ts';
import type { RoomRef } from '../../shared/types.ts';
import { logger } from '../logger.ts';

const log = logger('push');
const FILE = 'push-subscriptions.json';

export interface DeviceSubscription {
  endpoint: string;
  keys: { p256dh: string; auth: string };
}

export interface PushRecord extends DeviceSubscription {
  room: RoomRef;
  /** The operator who turned it on: they aren't alerted about what they did themselves. */
  user: string | null;
  at: number;
}

const id = (room: RoomRef, endpoint: string) => `${roomKey(room)}\n${endpoint}`;

export class PushStore {
  readonly #file: string | null;
  readonly #records = new Map<string, PushRecord>();

  /** `dataDir` null keeps everything in memory (tests). */
  constructor(dataDir: string | null) {
    this.#file = dataDir ? path.join(dataDir, FILE) : null;
    if (!this.#file || !fs.existsSync(this.#file)) return;
    try {
      const records = JSON.parse(fs.readFileSync(this.#file, 'utf8')) as PushRecord[];
      for (const r of records) this.#records.set(id(r.room, r.endpoint), r);
    } catch (err) {
      log.warn(`couldn't read ${this.#file}: ${(err as Error).message}`);
    }
  }

  add(record: PushRecord): void {
    this.#records.set(id(record.room, record.endpoint), record);
    this.#save();
  }

  remove(room: RoomRef, endpoint: string): boolean {
    const removed = this.#records.delete(id(room, endpoint));
    if (removed) this.#save();
    return removed;
  }

  /** A device the push service says is gone: every room it followed. */
  forget(endpoint: string): void {
    let changed = false;
    for (const [k, r] of this.#records) {
      if (r.endpoint === endpoint) changed = this.#records.delete(k) || changed;
    }
    if (changed) this.#save();
  }

  has(room: RoomRef, endpoint: string): boolean {
    return this.#records.has(id(room, endpoint));
  }

  forRoom(room: RoomRef): PushRecord[] {
    const key = roomKey(room);
    return [...this.#records.values()].filter((r) => roomKey(r.room) === key);
  }

  /** Every room with at least one device following it. */
  rooms(): RoomRef[] {
    const seen = new Map<string, RoomRef>();
    for (const r of this.#records.values()) seen.set(roomKey(r.room), r.room);
    return [...seen.values()];
  }

  #save(): void {
    if (!this.#file) return;
    try {
      const tmp = `${this.#file}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify([...this.#records.values()]), { mode: 0o600 });
      fs.renameSync(tmp, this.#file);
    } catch (err) {
      log.error(`couldn't save ${this.#file}`, err);
    }
  }
}
