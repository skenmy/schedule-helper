// The live connection to one room. Holds server-pushed state as reactive,
// read-only snapshots; the server stays authoritative for everything shared.

import { getContext, setContext } from 'svelte';
import type { ClientAction, ServerMessage } from '../../shared/protocol.ts';
import type { AuthInfo, RoomRef, RoomState, Schedule } from '../../shared/types.ts';
import { clock } from './clock.svelte.ts';
import { router } from './router.svelte.ts';
import { toasts } from './toasts.svelte.ts';

export type ConnectionStatus = 'connecting' | 'open' | 'reconnecting' | 'closed';

const PING_MS = 30_000;
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

  canWrite = $derived(this.auth?.canWrite ?? false);

  #ws: WebSocket | null = null;
  #retries = 0;
  #retryTimer: ReturnType<typeof setTimeout> | null = null;
  #pingTimer: ReturnType<typeof setInterval> | null = null;
  #closed = false;

  constructor(ref: RoomRef) {
    this.ref = ref;
  }

  connect(): void {
    this.#closed = false;
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    const ws = new WebSocket(`${proto}://${location.host}/ws`);
    this.#ws = ws;
    this.status = this.#retries ? 'reconnecting' : 'connecting';

    ws.addEventListener('open', () => {
      this.#retries = 0;
      this.status = 'open';
      this.#raw({ action: 'join', ref: this.ref });
      this.#ping();
      this.#pingTimer = setInterval(() => this.#ping(), PING_MS);
    });
    ws.addEventListener('message', (e) => {
      try {
        this.#handle(JSON.parse(e.data as string) as ServerMessage);
      } catch (err) {
        console.error('bad message', err);
      }
    });
    ws.addEventListener('close', () => {
      if (this.#pingTimer) clearInterval(this.#pingTimer);
      this.#pingTimer = null;
      if (this.#ws !== ws) return;
      this.#ws = null;
      if (this.#closed) {
        this.status = 'closed';
        return;
      }
      this.status = 'reconnecting';
      const delay = Math.min(15_000, 800 * 2 ** this.#retries++) + Math.random() * 400;
      this.#retryTimer = setTimeout(() => this.connect(), delay);
    });
  }

  close(): void {
    this.#closed = true;
    if (this.#retryTimer) clearTimeout(this.#retryTimer);
    this.#ws?.close();
    this.#ws = null;
    this.status = 'closed';
  }

  /**
   * Sends an operator action. Returns false (and tells the user why) when it
   * can't go through; there is no offline queue on purpose — replaying stale
   * timer presses later would do more harm than good.
   */
  send(action: ClientAction): boolean {
    if (action.action !== 'join' && action.action !== 'ping' && !this.canWrite) {
      this.promptSignIn();
      return false;
    }
    if (this.status !== 'open') {
      toasts.push({
        kind: 'error',
        title: 'Not connected',
        body: 'Reconnecting… that action wasn’t sent.',
      });
      return false;
    }
    this.#raw(action);
    return true;
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

  #raw(action: ClientAction): void {
    if (this.#ws?.readyState === WebSocket.OPEN) this.#ws.send(JSON.stringify(action));
  }

  #ping(): void {
    this.#raw({ action: 'ping', t: Date.now() });
  }

  #handle(msg: ServerMessage): void {
    switch (msg.type) {
      case 'hello':
        if (firstBuild == null) firstBuild = msg.build;
        else if (msg.build !== firstBuild && msg.build !== 'dev') this.newBuild = msg.build;
        break;
      case 'pong':
        clock.calibrate(msg.t, msg.serverTime);
        break;
      case 'auth':
        this.auth = msg.auth;
        break;
      case 'joined':
        this.fatal = null;
        break;
      case 'schedule':
        this.schedule = msg.schedule;
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
        break;
      case 'presence':
        this.presence = msg.count;
        break;
      case 'error':
        if (msg.action === 'schedule:refresh') this.refreshing = false;
        if (msg.action === 'join') {
          this.fatal = { code: msg.code, message: msg.message };
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
