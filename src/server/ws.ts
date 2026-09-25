// WebSocket sessions: identity, room membership, validated actions.

import type { IncomingMessage, Server } from 'node:http';
import { WebSocketServer, type WebSocket } from 'ws';
import {
  ClientActionSchema,
  isMutating,
  type ClientAction,
  type ServerMessage,
} from '../shared/protocol.ts';
import type { AuthInfo, RoomRef } from '../shared/types.ts';
import { actorName, anonymousIdentity, resolveIdentity } from './auth.ts';
import { config } from './config.ts';
import { logger } from './logger.ts';
import type { RoomRegistry } from './rooms/registry.ts';
import type { Room, RoomClient } from './rooms/room.ts';
import { UpstreamError } from './sources/index.ts';

const log = logger('ws');
const AUTH_REFRESH_MS = 5 * 60_000;
const AUTH_RETRY_MS = 10_000;
const HEARTBEAT_MS = 30_000;

class Session implements RoomClient {
  private room: Room | null = null;
  private auth: AuthInfo | null = null;
  private readonly authReady: Promise<void>;
  /** Messages are handled strictly in arrival order. */
  private queue: Promise<void> = Promise.resolve();
  private alive = true;
  private authRetry: NodeJS.Timeout | undefined;
  private readonly ws: WebSocket;
  private readonly cookie: string | undefined;
  private readonly registry: RoomRegistry;

  constructor(ws: WebSocket, req: IncomingMessage, registry: RoomRegistry) {
    this.ws = ws;
    this.cookie = req.headers.cookie;
    this.registry = registry;
    this.send({ type: 'hello', build: config.build, serverTime: Date.now() });
    this.authReady = this.refreshAuth();

    const refresh = setInterval(() => void this.refreshAuth(), AUTH_REFRESH_MS);
    const heartbeat = setInterval(() => {
      if (!this.alive) return ws.terminate();
      this.alive = false;
      ws.ping();
    }, HEARTBEAT_MS);

    ws.on('pong', () => (this.alive = true));
    ws.on('message', (raw) => {
      this.queue = this.queue
        .then(() => this.handle(raw.toString()))
        .catch((err) => log.error(err));
    });
    ws.on('close', () => {
      clearInterval(refresh);
      clearInterval(heartbeat);
      clearTimeout(this.authRetry);
      this.room?.leave(this);
    });
  }

  send(msg: ServerMessage): void {
    if (this.ws.readyState === this.ws.OPEN) this.ws.send(JSON.stringify(msg));
  }

  private async refreshAuth(): Promise<void> {
    const next = await resolveIdentity(this.cookie);
    clearTimeout(this.authRetry);
    if (next) {
      this.auth = next;
    } else {
      // Auth service unreachable (e.g. mid-deploy): keep what we knew, retry soon.
      this.auth ??= anonymousIdentity();
      this.authRetry = setTimeout(() => void this.refreshAuth(), AUTH_RETRY_MS);
    }
    this.send({ type: 'auth', auth: this.auth });
  }

  private async handle(raw: string): Promise<void> {
    let json: unknown;
    try {
      json = JSON.parse(raw);
    } catch {
      return this.send({ type: 'error', code: 'invalid', message: 'Malformed message.' });
    }
    const parsed = ClientActionSchema.safeParse(json);
    if (!parsed.success) {
      const action = (json as { action?: unknown })?.action;
      return this.send({
        type: 'error',
        code: 'invalid',
        message: 'That request wasn’t valid.',
        action: typeof action === 'string' ? action : undefined,
      });
    }
    const action: ClientAction = parsed.data;
    // Optional request id, echoed back so the client can match the outcome.
    const rawRid = (json as { rid?: unknown }).rid;
    const rid = typeof rawRid === 'string' ? rawRid.slice(0, 40) : undefined;

    if (action.action === 'ping') {
      return this.send({ type: 'pong', t: action.t, serverTime: Date.now() });
    }
    if (action.action === 'join') return this.join(action.ref);

    await this.authReady;
    if (!isMutating(action)) return;
    const auth = this.auth!;
    if (!auth.canWrite) {
      return this.send({
        type: 'error',
        code: auth.authenticated ? 'forbidden' : 'signin_required',
        message: auth.authenticated
          ? 'You’re signed in, but don’t have operator access to this app.'
          : 'Sign in to control the schedule.',
        action: action.action,
        rid,
      });
    }
    if (!this.room) {
      return this.send({
        type: 'error',
        code: 'not_joined',
        message: 'Not in a room.',
        action: action.action,
        rid,
      });
    }
    const res = this.room.dispatch(action, actorName(auth), (msg) => this.send(msg));
    if (!res.ok) {
      this.send({
        type: 'error',
        code: res.code,
        message: res.message,
        action: action.action,
        rid,
      });
    } else if (rid) {
      this.send({ type: 'applied', rid, undo: res.undo });
    }
  }

  private async join(ref: RoomRef): Promise<void> {
    this.room?.leave(this);
    this.room = null;
    try {
      const room = await this.registry.open(ref);
      if (this.ws.readyState !== this.ws.OPEN) return;
      this.room = room;
      room.join(this);
    } catch (err) {
      if (err instanceof UpstreamError) {
        this.send({
          type: 'error',
          code: err.notFound ? 'not_found' : 'upstream',
          message: err.notFound ? 'That schedule doesn’t exist (or isn’t published).' : err.message,
          action: 'join',
        });
      } else {
        log.error('join failed', err);
        this.send({
          type: 'error',
          code: 'upstream',
          message: 'Couldn’t load that schedule.',
          action: 'join',
        });
      }
    }
  }
}

export function attachWebSocket(server: Server, registry: RoomRegistry): WebSocketServer {
  const wss = new WebSocketServer({ noServer: true, maxPayload: 64 * 1024 });
  server.on('upgrade', (req, socket, head) => {
    if (new URL(req.url ?? '/', 'http://x').pathname !== '/ws') {
      socket.destroy();
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => new Session(ws, req, registry));
  });
  return wss;
}
