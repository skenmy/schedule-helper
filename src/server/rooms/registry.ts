// Loads rooms on demand (disk first, then upstream), keeps schedules fresh
// while people are watching, and evicts idle rooms from memory.

import { roomKey } from '../../shared/sources.ts';
import type { RoomRef } from '../../shared/types.ts';
import { logger } from '../logger.ts';
import { Room, type RoomServices } from './room.ts';
import { seedDemoState } from '../sources/demo.ts';
import { initialState } from './state.ts';
import type { RoomStore } from './store.ts';

const log = logger('rooms');
const IDLE_EVICT_MS = 60 * 60_000;
const SCHEDULE_REFRESH_MS = 10 * 60_000;

export class RoomRegistry {
  private readonly rooms = new Map<string, Room>();
  private readonly pending = new Map<string, Promise<Room>>();
  private readonly store: RoomStore;
  private readonly services: RoomServices;

  constructor(opts: { store: RoomStore; services: RoomServices }) {
    this.store = opts.store;
    this.services = opts.services;
  }

  get(ref: RoomRef): Room | undefined {
    return this.rooms.get(roomKey(ref));
  }

  all(): IterableIterator<Room> {
    return this.rooms.values();
  }

  /** Returns the live room, loading it from disk or upstream if needed. */
  open(ref: RoomRef): Promise<Room> {
    const key = roomKey(ref);
    const live = this.rooms.get(key);
    if (live) return Promise.resolve(live);
    let loading = this.pending.get(key);
    if (!loading) {
      loading = this.load(ref).finally(() => this.pending.delete(key));
      this.pending.set(key, loading);
    }
    return loading;
  }

  private async load(ref: RoomRef): Promise<Room> {
    // Demo rooms live in memory only so every restart gets a fresh live marathon.
    const store = ref.source === 'demo' ? null : this.store;
    const saved = store ? await store.load(ref) : null;
    let room: Room;
    if (saved) {
      room = new Room({ ...saved, store, services: this.services });
      // Serve the saved schedule immediately; pick up upstream edits in the background.
      void room
        .refreshSchedule()
        .catch((err: Error) => log.warn(`refresh ${room.key}: ${err.message}`));
    } else {
      const schedule = await this.services.fetchSchedule(ref, { fresh: false });
      room = new Room({
        ref,
        schedule,
        state:
          ref.source === 'demo'
            ? seedDemoState(initialState(), schedule.lines, Date.now())
            : initialState(schedule.twitch),
        store,
        services: this.services,
      });
    }
    this.rooms.set(room.key, room);
    log.info(`opened ${room.key} (${saved ? 'from disk' : 'new'})`);
    return room;
  }

  /** Periodic housekeeping: refresh watched schedules, evict idle rooms. */
  sweep(now = Date.now()): void {
    for (const room of this.rooms.values()) {
      if (room.watcherCount > 0) {
        if (now - room.schedule.fetchedAt > SCHEDULE_REFRESH_MS) {
          void room
            .refreshSchedule({ fresh: true })
            .catch((err: Error) => log.warn(`refresh ${room.key}: ${err.message}`));
        }
      } else if (now - room.lastActive > IDLE_EVICT_MS && !room.state.captureBusy) {
        room.flush();
        this.rooms.delete(room.key);
        log.info(`evicted idle room ${room.key}`);
      }
    }
  }

  flushAll(): number {
    for (const room of this.rooms.values()) room.flush();
    return this.rooms.size;
  }
}
