import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { WebSocket } from 'ws';
import type { ServerMessage } from '../shared/protocol.ts';
import type { RoomRef, RoomState, Schedule } from '../shared/types.ts';
import { startServer, type RunningServer } from './server.ts';
import { demoSchedule } from './sources/demo.ts';
import { UpstreamError } from './sources/index.ts';

const REF: RoomRef = { source: 'oengus', event: 'testmarathon', slug: 'main' };

function fixtureSchedule(ref: RoomRef): Schedule {
  return { ...demoSchedule(), ref, eventName: 'Test Marathon', twitch: 'testchannel' };
}

class Client {
  readonly messages: ServerMessage[] = [];
  private waiters: { pred: (m: ServerMessage) => boolean; resolve: (m: ServerMessage) => void }[] =
    [];
  readonly ws: WebSocket;

  constructor(port: number) {
    this.ws = new WebSocket(`ws://localhost:${port}/ws`);
    this.ws.on('message', (raw) => {
      const msg = JSON.parse(raw.toString()) as ServerMessage;
      this.messages.push(msg);
      this.waiters = this.waiters.filter((w) => (w.pred(msg) ? (w.resolve(msg), false) : true));
    });
  }

  opened(): Promise<void> {
    return new Promise((resolve) => this.ws.once('open', () => resolve()));
  }

  send(action: object): void {
    this.ws.send(JSON.stringify(action));
  }

  next<T extends ServerMessage['type']>(
    type: T,
    pred: (m: Extract<ServerMessage, { type: T }>) => boolean = () => true,
  ): Promise<Extract<ServerMessage, { type: T }>> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`timed out waiting for ${type}`)), 3000);
      this.waiters.push({
        pred: (m) => m.type === type && pred(m as Extract<ServerMessage, { type: T }>),
        resolve: (m) => {
          clearTimeout(timer);
          resolve(m as Extract<ServerMessage, { type: T }>);
        },
      });
    });
  }

  nextState(pred: (s: RoomState) => boolean): Promise<RoomState> {
    return this.next('state', (m) => pred(m.state)).then((m) => m.state);
  }

  async join(ref: RoomRef = REF): Promise<RoomState> {
    const state = this.next('state');
    this.send({ action: 'join', ref });
    return (await state).state;
  }
}

let server: RunningServer;
let dataDir: string;
const clients: Client[] = [];

async function connect(): Promise<Client> {
  const c = new Client(server.port);
  clients.push(c);
  await c.opened();
  return c;
}

async function boot() {
  server = await startServer({
    port: 0,
    dataDir,
    services: {
      fetchSchedule: async (ref) => {
        if (ref.event === 'missing') throw new UpstreamError('Not found', 404);
        return fixtureSchedule(ref);
      },
    },
  });
}

beforeEach(async () => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sh-test-'));
  await boot();
});

afterEach(async () => {
  for (const c of clients.splice(0)) c.ws.close();
  await server.close();
  fs.rmSync(dataDir, { recursive: true, force: true });
});

describe('websocket protocol', () => {
  it('greets, joins and sends schedule + state', async () => {
    const c = await connect();
    const schedule = c.next('schedule');
    const state = await c.join();
    expect((await schedule).schedule.eventName).toBe('Test Marathon');
    expect(state.twitchChannel).toBe('testchannel');
    expect(c.messages[0]).toMatchObject({ type: 'hello', build: expect.any(String) });
    expect(c.messages.find((m) => m.type === 'auth')).toMatchObject({ auth: { canWrite: true } });
  });

  it('applies actions, broadcasts to everyone, and undoes', async () => {
    const a = await connect();
    const b = await connect();
    await a.join();
    await b.join();

    a.send({ action: 'timer:start' });
    const started = await b.nextState((s) => s.currentKey === 'd0' && s.runs.d0?.startedAt != null);
    expect(started.undo?.summary).toBe('▶ Started Celeste');

    a.send({ action: 'undo' });
    const undone = await b.nextState((s) => s.runs.d0?.startedAt == null);
    expect(undone.currentKey).toBeNull();
    expect(undone.log[0]?.text).toBe('↶ Undid “▶ Started Celeste”');
    expect(undone.undo).toBeNull();
  });

  it('reports presence', async () => {
    const a = await connect();
    await a.join();
    const presence = a.next('presence', (m) => m.count === 2);
    const b = await connect();
    await b.join();
    expect((await presence).count).toBe(2);
  });

  it('rejects malformed and invalid actions without breaking the session', async () => {
    const c = await connect();
    await c.join();
    c.ws.send('not json');
    expect((await c.next('error')).code).toBe('invalid');
    c.send({ action: 'timer:set', seconds: -5 });
    expect((await c.next('error')).action).toBe('timer:set');
    c.send({ action: 'run:select', key: 'does-not-exist' });
    expect((await c.next('error')).message).toMatch(/no longer on the schedule/);
    c.send({ action: 'ping', t: 1 });
    expect((await c.next('pong')).t).toBe(1);
  });

  it('refuses actions before joining and unknown schedules', async () => {
    const c = await connect();
    c.send({ action: 'timer:start' });
    expect((await c.next('error')).code).toBe('not_joined');
    c.send({ action: 'join', ref: { ...REF, event: 'missing' } });
    expect((await c.next('error')).code).toBe('not_found');
  });
});

describe('overlay feed', () => {
  it('serves JSON with CORS and streams updates', async () => {
    const res = await fetch(
      `http://localhost:${server.port}/api/rooms/oengus/testmarathon/main/feed`,
    );
    expect(res.headers.get('access-control-allow-origin')).toBe('*');
    const feed = await res.json();
    expect(feed).toMatchObject({ phase: 'idle', current: null, event: { name: 'Test Marathon' } });

    const controller = new AbortController();
    const stream = await fetch(
      `http://localhost:${server.port}/api/rooms/oengus/testmarathon/main/feed/stream`,
      {
        signal: controller.signal,
      },
    );
    const reader = stream.body!.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    const readUntil = async (needle: string) => {
      while (!buffer.includes(needle)) buffer += decoder.decode((await reader.read()).value);
    };
    await readUntil('event: feed');

    const c = await connect();
    await c.join();
    c.send({ action: 'timer:start' });
    await readUntil('"phase":"running"');
    controller.abort();
  });

  it('rejects invalid refs', async () => {
    const res = await fetch(
      `http://localhost:${server.port}/api/rooms/oengus/..%2F..%2Fetc/main/feed`,
    );
    expect(res.status).toBe(400);
  });
});

describe('persistence', () => {
  it('survives a restart', async () => {
    const c = await connect();
    await c.join();
    c.send({ action: 'runner:checkin', key: 'd3', status: 'ready' });
    await c.nextState((s) => s.runs.d3?.checkIn === 'ready');
    c.ws.close();
    clients.length = 0;

    expect(await server.close()).toBe(1);
    expect(fs.existsSync(path.join(dataDir, 'rooms', 'oengus--testmarathon--main.json'))).toBe(
      true,
    );
    await boot();

    const d = await connect();
    const state = await d.join();
    expect(state.runs.d3?.checkIn).toBe('ready');
    expect(state.undo?.summary).toMatch(/checked in/);
  });
});
