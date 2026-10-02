// The live connection to one room. Holds server-pushed state as reactive,
// read-only snapshots; the server stays authoritative for everything shared.

import { getContext, setContext } from 'svelte';
import type {
  ClientAction,
  ErrorCode,
  MutatingAction,
  ServerMessage,
} from '../../shared/protocol.ts';
import type { AuthInfo, RoomRef, RoomState, Schedule, UndoInfo } from '../../shared/types.ts';
import { clock } from './clock.svelte.ts';
import { dropSnapshot, loadSnapshot, saveSnapshot } from './offline.ts';
import { router } from './router.svelte.ts';
import { toasts } from './toasts.svelte.ts';

export type ConnectionStatus = 'connecting' | 'open' | 'reconnecting' | 'closed';

export type ActionResult =
  { ok: true; undo: UndoInfo | null } | { ok: false; code: ErrorCode; message: string };

const PING_MS = 30_000;
/** Silence for this long on an "open" socket means it died without closing (iOS, Wi-Fi handover). */
const DEAD_MS = 2 * PING_MS + 5_000;
/** Snapshots for offline use are written at most this often. */
const SAVE_MS = 2_000;
/** First build this tab saw; a different one later means a deploy landed. */
let firstBuild: string | null = null;

export class RoomConnection {
  readonly ref: RoomRef;
  status = $state<ConnectionStatus>('connecting');
  schedule = $state.raw<Schedule | null>(null);
  state = $state.raw<RoomState | null>(null);
  auth = $state.raw<AuthInfo | null>(null);
  presence = $state(0);
  /** A join failure (schedule not found, upstream down) with nothing to show. */
  fatal = $state<{ code: string; message: string } | null>(null);
  newBuild = $state<string | null>(null);
  refreshing = $state(false);
  /** The state shown arrived over the current connection (not from the offline cache). */
  fresh = $state(false);
  /** When the server last confirmed the state shown (local clock). */
  syncedAt = $state<number | null>(null);

  /** Has operator access (whether or not it can act right now). */
  isOperator = $derived(this.auth?.canWrite ?? false);
  /** Connected, with state straight from the server. */
  synced = $derived(this.status === 'open' && this.fresh);
  /** Showing state we can't vouch for: from this device's cache, or since the connection dropped. */
  offline = $derived(!this.synced && this.state != null);
  /**
   * May send operator actions *now*: operator access and live, fresh state.
   * Everything that changes the room gates on this, so nothing can act on a
   * cached or stale view.
   */
  canWrite = $derived(this.isOperator && this.synced);

  #ws: WebSocket | null = null;
  #retries = 0;
  #retryTimer: ReturnType<typeof setTimeout> | null = null;
  #pingTimer: ReturnType<typeof setInterval> | null = null;
  #closed = false;
  #listening = false;
  #lastMessageAt = 0;
  #saveTimer: ReturnType<typeof setTimeout> | null = null;
  #lastSave = 0;
  /** Actions awaiting the server's verdict, by request id. Bookkeeping, not UI state. */
  // eslint-disable-next-line svelte/prefer-svelte-reactivity
  #pending = new Map<string, (result: ActionResult) => void>();
  #nextRid = 1;

  constructor(ref: RoomRef) {
    this.ref = ref;
    // Paint the last known state at once (read-only until the server confirms it).
    const snap = loadSnapshot(ref);
    if (snap) {
      this.schedule = snap.schedule;
      this.state = snap.state;
      this.syncedAt = snap.savedAt;
      clock.adopt(snap.offset);
    }
  }

  connect(): void {
    this.#closed = false;
    if (this.#retryTimer) clearTimeout(this.#retryTimer);
    this.#retryTimer = null;
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    const ws = new WebSocket(`${proto}://${location.host}/ws`);
    this.#ws = ws;
    this.status = this.#retries ? 'reconnecting' : 'connecting';

    ws.addEventListener('open', () => {
      if (this.#ws !== ws) return;
      this.#retries = 0;
      this.#lastMessageAt = Date.now();
      this.status = 'open';
      this.#raw({ action: 'join', ref: this.ref });
      this.#ping();
      this.#pingTimer = setInterval(() => this.#ping(), PING_MS);
    });
    ws.addEventListener('message', (e) => {
      if (this.#ws !== ws) return;
      this.#lastMessageAt = Date.now();
      try {
        this.#handle(JSON.parse(e.data as string) as ServerMessage);
      } catch (err) {
        console.error('bad message', err);
      }
    });
    ws.addEventListener('close', () => {
      // A socket we already replaced (see #reconnectNow) has nothing left to clean up.
      if (this.#ws !== ws) return;
      this.#detach('Disconnected');
      if (this.#closed) {
        this.status = 'closed';
        return;
      }
      this.status = 'reconnecting';
      const delay = Math.min(15_000, 800 * 2 ** this.#retries++) + Math.random() * 400;
      this.#retryTimer = setTimeout(() => this.connect(), delay);
    });

    if (!this.#listening) {
      this.#listening = true;
      window.addEventListener('online', this.#wake);
      document.addEventListener('visibilitychange', this.#wake);
      window.addEventListener('pagehide', this.#flush);
    }
  }

  close(): void {
    this.#closed = true;
    this.#flush();
    const ws = this.#ws;
    this.#detach('Closed');
    if (this.#retryTimer) clearTimeout(this.#retryTimer);
    this.#retryTimer = null;
    ws?.close();
    this.status = 'closed';
    if (this.#listening) {
      this.#listening = false;
      window.removeEventListener('online', this.#wake);
      document.removeEventListener('visibilitychange', this.#wake);
      window.removeEventListener('pagehide', this.#flush);
    }
  }

  /** Forgets the current socket's session: timers, pending verdicts, freshness. */
  #detach(reason: string): void {
    if (this.#pingTimer) clearInterval(this.#pingTimer);
    this.#pingTimer = null;
    this.#ws = null;
    this.fresh = false;
    // Anything awaiting a verdict won't get one from this socket.
    for (const settle of [...this.#pending.values()]) {
      settle({ ok: false, code: 'not_joined', message: reason });
    }
  }

  /** Drops the current socket (dead or not) and dials again straight away. */
  #reconnectNow(): void {
    const old = this.#ws;
    this.#detach('Reconnecting');
    old?.close();
    // Counts as a retry, so the status reads "reconnecting" and a failure backs off.
    this.#retries = Math.max(1, this.#retries);
    this.connect();
  }

  /**
   * Back online, or back in the foreground: don't sit out the retry backoff,
   * and don't trust a socket that's been silent — iOS freezes background
   * pages and their sockets often die without a close event.
   */
  #wake = (): void => {
    if (this.#closed) return;
    if (document.visibilityState === 'hidden') {
      this.#flush();
      return;
    }
    if (this.status === 'reconnecting') this.#reconnectNow();
    else if (this.status === 'open' && Date.now() - this.#lastMessageAt > PING_MS + 5_000)
      this.#reconnectNow();
    else if (this.status === 'open') this.#ping();
  };

  /**
   * Sends an operator action. Returns false (and tells the user why) when it
   * can't go through; there is no offline queue on purpose — replaying stale
   * timer presses later would do more harm than good.
   */
  send(action: ClientAction): boolean {
    if (!this.#canSend(action)) return false;
    this.#raw(action);
    return true;
  }

  /**
   * Sends an action and resolves with the server's verdict — including the undo
   * entry it created, if any. Resolves null when it couldn't be sent or no
   * answer arrived.
   */
  request(action: MutatingAction): Promise<ActionResult | null> {
    if (!this.#canSend(action)) return Promise.resolve(null);
    const rid = String(this.#nextRid++);
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.#pending.delete(rid);
        resolve(null);
      }, 10_000);
      this.#pending.set(rid, (result) => {
        clearTimeout(timer);
        this.#pending.delete(rid);
        resolve(result);
      });
      this.#raw({ ...action, rid });
    });
  }

  #canSend(action: ClientAction): boolean {
    if (action.action === 'join' || action.action === 'ping') return this.status === 'open';
    if (!this.synced) {
      this.explainOffline();
      return false;
    }
    if (!this.isOperator) {
      this.promptSignIn();
      return false;
    }
    return true;
  }

  /** Why an action can't be sent while disconnected or still syncing. */
  explainOffline(): void {
    toasts.push({
      kind: 'error',
      title: this.status === 'open' ? 'Still syncing' : 'Not connected',
      body:
        this.status === 'open'
          ? 'Waiting for the latest state… that action wasn’t sent.'
          : 'Reconnecting… that action wasn’t sent.',
    });
  }

  /** Tells the operator why they can't act: offline, or no operator access. */
  explainReadOnly(): void {
    if (!this.synced) this.explainOffline();
    else this.promptSignIn();
  }

  signIn(): void {
    if (!this.auth?.loginUrl) return;
    router.rememberReturn();
    location.href = this.auth.loginUrl;
  }

  promptSignIn(): void {
    const auth = this.auth;
    if (auth?.authenticated) {
      toasts.push({
        kind: 'warning',
        title: 'Read-only access',
        body: 'You’re signed in, but don’t have operator access. Ask an admin on tools.skenmy.com.',
      });
    } else {
      toasts.push({
        kind: 'warning',
        title: 'Sign in to control the schedule',
        action: auth?.loginUrl ? { label: 'Sign in', run: () => this.signIn() } : undefined,
      });
    }
  }

  #raw(action: ClientAction & { rid?: string }): void {
    if (this.#ws?.readyState === WebSocket.OPEN) this.#ws.send(JSON.stringify(action));
  }

  #ping(): void {
    if (this.status === 'open' && Date.now() - this.#lastMessageAt > DEAD_MS) {
      this.#reconnectNow();
      return;
    }
    this.#raw({ action: 'ping', t: Date.now() });
  }

  /** Keeps a snapshot of the latest state for offline launches, at most every SAVE_MS. */
  #scheduleSave(): void {
    if (this.#saveTimer) return;
    const wait = Math.max(0, this.#lastSave + SAVE_MS - Date.now());
    this.#saveTimer = setTimeout(this.#flush, wait);
  }

  #flush = (): void => {
    if (this.#saveTimer) clearTimeout(this.#saveTimer);
    this.#saveTimer = null;
    if (!this.fresh || !this.schedule || !this.state) return;
    this.#lastSave = Date.now();
    saveSnapshot(this.ref, {
      schedule: this.schedule,
      state: this.state,
      savedAt: this.syncedAt ?? Date.now(),
      offset: clock.offset,
    });
  };

  #handle(msg: ServerMessage): void {
    switch (msg.type) {
      case 'hello':
        if (firstBuild == null) firstBuild = msg.build;
        else if (msg.build !== firstBuild && msg.build !== 'dev') this.newBuild = msg.build;
        break;
      case 'pong':
        clock.calibrate(msg.t, msg.serverTime);
        if (this.fresh) this.syncedAt = Date.now();
        break;
      case 'auth':
        this.auth = msg.auth;
        break;
      case 'joined':
        this.fatal = null;
        break;
      case 'schedule':
        this.schedule = msg.schedule;
        if (this.fresh) this.#scheduleSave();
        if (msg.by && this.refreshing) {
          toasts.push({
            kind: 'success',
            title: 'Schedule re-imported',
            body: `${msg.schedule.lines.filter((l) => !l.setupBlock).length} runs from ${msg.schedule.ref.source === 'horaro' ? 'Horaro' : 'Oengus'}.`,
          });
        }
        this.refreshing = false;
        break;
      case 'state':
        this.state = msg.state;
        this.fresh = true;
        this.syncedAt = Date.now();
        this.#scheduleSave();
        break;
      case 'presence':
        this.presence = msg.count;
        break;
      case 'applied':
        this.#pending.get(msg.rid)?.({ ok: true, undo: msg.undo });
        break;
      case 'error':
        if (msg.rid)
          this.#pending.get(msg.rid)?.({ ok: false, code: msg.code, message: msg.message });
        if (msg.action === 'schedule:refresh') this.refreshing = false;
        if (msg.action === 'join') {
          this.fatal = { code: msg.code, message: msg.message };
          if (msg.code === 'not_found') {
            // Gone upstream: a cached copy would only mislead.
            dropSnapshot(this.ref);
            if (!this.fresh) {
              this.schedule = null;
              this.state = null;
            }
          }
        } else if (msg.code === 'signin_required' || msg.code === 'forbidden') {
          this.promptSignIn();
        } else {
          toasts.push({ kind: 'error', title: msg.message });
        }
        break;
    }
  }
}

const KEY = Symbol('room');

export function setRoom(room: RoomConnection): void {
  setContext(KEY, room);
}

export function getRoom(): RoomConnection {
  return getContext<RoomConnection>(KEY);
}
