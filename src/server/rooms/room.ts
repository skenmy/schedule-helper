// A sync room: authoritative state + schedule for one marathon schedule, the
// sockets watching it, an undo stack, and debounced persistence.

import type { MutatingAction, ServerMessage } from '../../shared/protocol.ts';
import { roomKey } from '../../shared/sources.ts';
import type { RoomRef, RoomState, Schedule } from '../../shared/types.ts';
import { logger } from '../logger.ts';
import { appendLog, reduce } from './reducer.ts';
import { UNDO_LIMIT, takeSnapshot, type UndoEntry } from './state.ts';
import { ROOM_FILE_FORMAT, type RoomFile, type RoomStore } from './store.ts';

const log = logger('room');
const SAVE_DEBOUNCE_MS = 1_000;
const FRAME_LIMIT = 3;

export interface RoomClient {
  send(msg: ServerMessage): void;
}

export interface CaptureFrame {
  data: Buffer;
  mediaType: 'image/jpeg' | 'image/png';
}

export interface RoomServices {
  fetchSchedule(ref: RoomRef, opts: { fresh: boolean }): Promise<Schedule>;
  capture(room: Room, opts: { auto: boolean; actor: string | null }): Promise<void>;
}

export type DispatchResult =
  { ok: true } | { ok: false; code: 'invalid' | 'conflict' | 'upstream'; message: string };

export class Room {
  readonly ref: RoomRef;
  readonly key: string;
  schedule: Schedule;
  state: RoomState;
  readonly clients = new Set<RoomClient>();
  readonly frames = new Map<string, CaptureFrame>();
  lastActive = Date.now();

  private undoStack: UndoEntry[];
  private readonly listeners = new Set<() => void>();
  private readonly store: RoomStore | null;
  private readonly services: RoomServices;
  private saveTimer: NodeJS.Timeout | null = null;
  private refreshing: Promise<void> | null = null;

  constructor(opts: {
    ref: RoomRef;
    schedule: Schedule;
    state: RoomState;
    undo?: UndoEntry[];
    store: RoomStore | null;
    services: RoomServices;
  }) {
    this.ref = opts.ref;
    this.key = roomKey(opts.ref);
    this.schedule = opts.schedule;
    this.state = { ...opts.state, captureBusy: false };
    this.undoStack = opts.undo ?? [];
    this.store = opts.store;
    this.services = opts.services;
  }

  get watcherCount(): number {
    return this.clients.size + this.listeners.size;
  }

  // ─── Clients ───────────────────────────────────────────────────────────────

  join(client: RoomClient): void {
    this.clients.add(client);
    this.lastActive = Date.now();
    client.send({ type: 'joined', ref: this.ref });
    client.send({ type: 'schedule', schedule: this.schedule, by: null });
    client.send({ type: 'state', state: this.state });
    this.broadcastPresence();
  }

  leave(client: RoomClient): void {
    if (!this.clients.delete(client)) return;
    this.lastActive = Date.now();
    this.broadcastPresence();
  }

  /** Change notifications for non-socket consumers (the overlay feed). */
  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
      this.lastActive = Date.now();
    };
  }

  broadcast(msg: ServerMessage): void {
    for (const c of this.clients) c.send(msg);
  }

  private broadcastPresence(): void {
    this.broadcast({ type: 'presence', count: this.clients.size });
  }

  private notify(): void {
    for (const fn of this.listeners) {
      try {
        fn();
      } catch (err) {
        log.error('listener failed', err);
      }
    }
  }

  // ─── Mutations ─────────────────────────────────────────────────────────────

  /**
   * Applies an operator action. Slow actions (capture, schedule refresh) start
   * in the background and report failures through `reply`.
   */
  dispatch(
    action: MutatingAction,
    actor: string | null,
    reply: (msg: ServerMessage) => void = () => {},
  ): DispatchResult {
    switch (action.action) {
      case 'undo':
        return this.undo(actor);
      case 'schedule:refresh':
        void this.refreshSchedule({ by: actor ?? 'an operator', fresh: true }).catch((err: Error) =>
          reply({ type: 'error', code: 'upstream', message: err.message, action: action.action }),
        );
        return { ok: true };
      case 'capture:run':
        if (this.state.captureBusy) {
          return { ok: false, code: 'conflict', message: 'A capture is already running.' };
        }
        void this.services.capture(this, { auto: false, actor });
        return { ok: true };
    }

    const now = Date.now();
    const before = takeSnapshot(this.state);
    const res = reduce(this.state, action, { lines: this.schedule.lines, now, actor });
    if (!res.ok) return res;
    if (!res.changed) return { ok: true };
    if (res.undo) {
      this.undoStack.push({ summary: res.undo, actor, at: now, snapshot: before });
      if (this.undoStack.length > UNDO_LIMIT) this.undoStack.shift();
    }
    this.commit(res.state);
    return { ok: true };
  }

  private undo(actor: string | null): DispatchResult {
    const entry = this.undoStack.pop();
    if (!entry) return { ok: false, code: 'conflict', message: 'Nothing to undo.' };
    this.mutate((s) => {
      Object.assign(s, structuredClone(entry.snapshot));
      const by = entry.actor && entry.actor !== actor ? ` (by ${entry.actor})` : '';
      appendLog(s, {
        kind: 'system',
        text: `↶ Undid “${entry.summary}”${by}`,
        runKey: s.currentKey,
        actor,
        at: Date.now(),
      });
    });
    return { ok: true };
  }

  /** System-initiated change (capture results, schedule notices). */
  mutate(fn: (draft: RoomState) => void): void {
    const draft = structuredClone(this.state);
    fn(draft);
    this.commit(draft);
  }

  private commit(next: RoomState): void {
    const top = this.undoStack.at(-1);
    next.rev = this.state.rev + 1;
    next.updatedAt = Date.now();
    next.undo = top ? { summary: top.summary, actor: top.actor, at: top.at } : null;
    this.state = next;
    this.broadcast({ type: 'state', state: next });
    this.notify();
    this.schedulePersist();
  }

  // ─── Schedule ──────────────────────────────────────────────────────────────

  /** Re-fetches upstream. `by` is set for operator-requested re-imports. */
  refreshSchedule({
    by = null,
    fresh = false,
  }: { by?: string | null; fresh?: boolean } = {}): Promise<void> {
    this.refreshing ??= this.services
      .fetchSchedule(this.ref, { fresh })
      .then((schedule) => this.setSchedule(schedule, by))
      .finally(() => {
        this.refreshing = null;
      });
    return this.refreshing;
  }

  setSchedule(schedule: Schedule, by: string | null): void {
    const changed =
      JSON.stringify(schedule.lines) !== JSON.stringify(this.schedule.lines) ||
      schedule.eventName !== this.schedule.eventName ||
      schedule.scheduleName !== this.schedule.scheduleName;
    this.schedule = schedule;
    // Operators who asked for a re-import always get a response, even if nothing changed.
    if (changed || by) this.broadcast({ type: 'schedule', schedule, by });
    if (changed) {
      const runs = schedule.lines.filter((l) => !l.setupBlock).length;
      this.mutate((s) => {
        appendLog(s, {
          kind: 'system',
          text: by
            ? `↻ Re-imported the schedule (${runs} runs)`
            : `↻ Schedule updated upstream (${runs} runs)`,
          runKey: s.currentKey,
          actor: by,
          at: Date.now(),
        });
        if (s.currentKey && !schedule.lines.some((l) => l.key === s.currentKey)) {
          appendLog(s, {
            kind: 'warning',
            text: '⚠ The current run was removed upstream. Select the run that’s live.',
            runKey: null,
            actor: null,
            at: Date.now(),
          });
        }
      });
    } else {
      this.schedulePersist();
    }
  }

  // ─── Capture frames ────────────────────────────────────────────────────────

  addFrame(id: string, frame: CaptureFrame): void {
    this.frames.set(id, frame);
    while (this.frames.size > FRAME_LIMIT) this.frames.delete(this.frames.keys().next().value!);
  }

  // ─── Persistence ───────────────────────────────────────────────────────────

  private snapshot(): RoomFile {
    return {
      format: ROOM_FILE_FORMAT,
      ref: this.ref,
      schedule: this.schedule,
      state: this.state,
      undo: this.undoStack,
    };
  }

  private schedulePersist(): void {
    if (!this.store || this.saveTimer) return;
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null;
      this.store
        ?.save(this.snapshot())
        .catch((err) => log.error(`save failed for ${this.key}`, err));
    }, SAVE_DEBOUNCE_MS);
  }

  /** Synchronous write for shutdown and eviction. */
  flush(): void {
    if (this.saveTimer) clearTimeout(this.saveTimer);
    this.saveTimer = null;
    if (!this.store) return;
    try {
      this.store.saveSync(this.snapshot());
    } catch (err) {
      log.error(`flush failed for ${this.key}`, err);
    }
  }
}
