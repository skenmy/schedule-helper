// The last state each room was seen in, kept on this device so an installed
// app can open with no signal (read-only), and every launch paints instantly
// instead of showing a spinner. Never used to act: until the server sends a
// fresh state over a live connection, every control stays disabled.

import { roomKey } from '../../shared/sources.ts';
import type { RoomRef, RoomState, Schedule } from '../../shared/types.ts';

export interface Snapshot {
  v: number;
  schedule: Schedule;
  state: RoomState;
  /** When the server last confirmed this state (local clock, epoch ms). */
  savedAt: number;
  /** The clock offset measured then, so timers keep ticking at the right time. */
  offset: number;
}

type Store = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

const VERSION = 1;
const PREFIX = 'sh.snap.';
const INDEX = 'sh.snaps';
/** Rooms kept per device; the oldest go first, and whenever storage runs out. */
export const KEEP = 4;

const keyOf = (ref: RoomRef) => PREFIX + roomKey(ref);

function readIndex(store: Store): string[] {
  try {
    const raw = JSON.parse(store.getItem(INDEX) ?? '[]') as unknown;
    return Array.isArray(raw) ? raw.filter((k): k is string => typeof k === 'string') : [];
  } catch {
    return [];
  }
}

export function loadSnapshot(ref: RoomRef, storage?: Store): Snapshot | null {
  try {
    const store = storage ?? localStorage;
    const raw = store.getItem(keyOf(ref));
    if (!raw) return null;
    const snap = JSON.parse(raw) as Partial<Snapshot>;
    const valid =
      snap.v === VERSION &&
      snap.schedule != null &&
      Array.isArray(snap.schedule.lines) &&
      roomKey(snap.schedule.ref) === roomKey(ref) &&
      snap.state != null &&
      typeof snap.state.runs === 'object' &&
      typeof snap.savedAt === 'number';
    if (valid) return { ...(snap as Snapshot), offset: Number(snap.offset) || 0 };
    store.removeItem(keyOf(ref));
  } catch {
    // unreadable — treat as absent
  }
  return null;
}

/** Saves a room's snapshot, evicting older rooms if storage is full. */
export function saveSnapshot(ref: RoomRef, snap: Omit<Snapshot, 'v'>, storage?: Store): boolean {
  try {
    // Inside the try: merely touching localStorage throws when it's blocked.
    const store = storage ?? localStorage;
    const key = keyOf(ref);
    const body = JSON.stringify({ v: VERSION, ...snap });
    const index = [key, ...readIndex(store).filter((k) => k !== key)];
    for (const old of index.splice(KEEP)) store.removeItem(old);
    for (;;) {
      try {
        store.setItem(key, body);
        store.setItem(INDEX, JSON.stringify(index));
        return true;
      } catch {
        // Out of room: drop the least recently saved other room and retry.
        const victim = index.length > 1 ? index.pop() : undefined;
        if (!victim) {
          dropSnapshot(ref, store);
          return false;
        }
        store.removeItem(victim);
      }
    }
  } catch {
    return false; // storage blocked
  }
}

export function dropSnapshot(ref: RoomRef, storage?: Store): void {
  try {
    const store = storage ?? localStorage;
    const key = keyOf(ref);
    store.removeItem(key);
    store.setItem(INDEX, JSON.stringify(readIndex(store).filter((k) => k !== key)));
  } catch {
    // ignore
  }
}
