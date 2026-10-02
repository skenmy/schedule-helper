import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { WebSocket } from 'ws';
import type { ServerMessage } from '../../shared/protocol.ts';
import type { CaptureResult, RoomRef, RoomState, Schedule } from '../../shared/types.ts';
import { Room } from '../rooms/room.ts';
import { initialState } from '../rooms/state.ts';
import { startServer, type RunningServer } from '../server.ts';
import { demoSchedule } from '../sources/demo.ts';
import { AUTO_ACTOR, observeCapture, signal } from './service.ts';
import type { ChannelInfo, StreamLookup } from './twitch.ts';

const REF: RoomRef = { source: 'oengus', event: 'tracked', slug: 'main' };
const schedule = (): Schedule => ({ ...demoSchedule(), ref: REF, twitch: 'testchannel' });

/** A Twitch stand-in the test can steer. */
class FakeTwitch implements StreamLookup {
  info: ChannelInfo = { live: true, game: 'Celeste', title: 'Celeste by cerulean' };
  async lookup(logins: string[]) {
    return new Map(logins.map((l) => [l, this.info]));
  }
}

class Client {
  readonly ws: WebSocket;
  private waiters: { pred: (m: ServerMessage) => boolean; resolve: (m: ServerMessage) => void }[] =
    [];
  latest: RoomState | null = null;
  constructor(port: number) {
    this.ws = new WebSocket(`ws://localhost:${port}/ws`);
    this.ws.on('message', (raw) => {
      const msg = JSON.parse(raw.toString()) as ServerMessage;
      if (msg.type === 'state') this.latest = msg.state;
      this.waiters = this.waiters.filter((w) => (w.pred(msg) ? (w.resolve(msg), false) : true));
    });
  }
  opened() {
    return new Promise<void>((resolve) => this.ws.once('open', () => resolve()));
  }
  send(action: object) {
    this.ws.send(JSON.stringify(action));
  }
  state(pred: (s: RoomState) => boolean, ms = 3000): Promise<RoomState> {
    if (this.latest && pred(this.latest)) return Promise.resolve(this.latest);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('timed out waiting for state')), ms);
      this.waiters.push({
        pred: (m) => m.type === 'state' && pred(m.state),
        resolve: (m) => {
          clearTimeout(timer);
          resolve((m as Extract<ServerMessage, { type: 'state' }>).state);
        },
      });
    });
  }
}

let server: RunningServer;
let dataDir: string;
let twitch: FakeTwitch;
let client: Client;

beforeEach(async () => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sh-track-'));
  twitch = new FakeTwitch();
  server = await startServer({
    port: 0,
    dataDir,
    services: { fetchSchedule: async () => schedule() },
    streams: twitch,
    trackingTickMs: 25,
  });
  client = new Client(server.port);
  await client.opened();
  client.send({ action: 'join', ref: REF });
  await client.state(() => true);
  client.send({ action: 'timer:start' });
  await client.state((s) => s.currentKey === 'd0' && s.runs.d0?.startedAt != null);
});

afterEach(async () => {
  client.ws.close();
  await server.close();
  fs.rmSync(dataDir, { recursive: true, force: true });
});

describe('auto-tracking over the wire', () => {
  it('follows a Twitch category change once accepted, and stays put after an undo', async () => {
    client.send({ action: 'tracking:configure', twitch: true, vision: false, autoApply: false });
    await client.state((s) => s.stream?.game === 'Celeste');

    twitch.info = { live: true, game: 'Super Mario 64', title: 'SM64 120 Star by ptkay' };
    const detected = await client.state((s) => s.detection != null);
    expect(detected.detection).toMatchObject({ runKey: 'd1', kind: 'advance', currentKey: 'd0' });
    expect(detected.detection?.signals[0]?.detail).toContain('category “Super Mario 64”');
    expect(detected.currentKey).toBe('d0');

    client.send({ action: 'detection:accept', id: detected.detection!.id });
    const moved = await client.state((s) => s.currentKey === 'd1');
    expect(moved.detection).toBeNull();
    expect(moved.runs.d0?.endedAt).toBeLessThanOrEqual(detected.detection!.firstAt);
    expect(moved.log[0]?.text).toContain('Followed the stream (twitch) to Super Mario 64');

    // Undo goes back to Celeste; the stream hasn't changed again, so nothing re-fires.
    client.send({ action: 'undo' });
    await client.state((s) => s.currentKey === 'd0');
    await new Promise((r) => setTimeout(r, 150));
    expect(client.latest?.detection).toBeNull();
  });

  it('says when Twitch is unavailable', async () => {
    await server.close();
    server = await startServer({
      port: 0,
      dataDir,
      services: { fetchSchedule: async () => schedule() },
      streams: null,
      trackingTickMs: 25,
    });
    client.ws.close();
    client = new Client(server.port);
    await client.opened();
    client.send({ action: 'join', ref: REF });
    client.send({ action: 'tracking:configure', twitch: true, vision: false, autoApply: false });
    const s = await client.state((st) => st.stream?.error != null);
    expect(s.stream?.error).toContain('TWITCH_CLIENT_ID');
  });
});

describe('auto-apply', () => {
  function room(autoApply: boolean): Room {
    const state = initialState('testchannel');
    state.currentKey = 'd0';
    state.runs.d0 = { startedAt: Date.now() - 30 * 60_000 };
    state.tracking = { twitch: true, vision: true, autoApply };
    return new Room({
      ref: REF,
      schedule: schedule(),
      state,
      store: null,
      services: { fetchSchedule: async () => schedule(), capture: async () => {} },
    });
  }
  const now = Date.now();
  const twitchSaid = {
    runKey: 'd1',
    source: 'twitch' as const,
    at: now - 60_000,
    detail: 'Twitch',
    startedAt: null,
  };
  const visionSaw = {
    runKey: 'd1',
    source: 'vision' as const,
    at: now,
    detail: 'timer',
    startedAt: now - 90_000,
  };

  it('acts when two sources agree, as an undoable change by Auto-tracking', () => {
    const r = room(true);
    signal(r, twitchSaid);
    expect(r.state.currentKey).toBe('d0');
    signal(r, visionSaw);
    expect(r.state.currentKey).toBe('d1');
    expect(r.state.runs.d1?.startedAt).toBe(now - 90_000);
    expect(r.state.undo).toMatchObject({ actor: AUTO_ACTOR });
  });

  it('only asks when auto-apply is off', () => {
    const r = room(false);
    signal(r, twitchSaid);
    signal(r, visionSaw);
    expect(r.state.currentKey).toBe('d0');
    expect(r.state.detection?.signals).toHaveLength(2);
  });
});

describe('observeCapture', () => {
  const base: CaptureResult = {
    id: 'c',
    at: 1_000_000,
    auto: true,
    by: null,
    channel: 'testchannel',
    error: null,
    elapsedSec: null,
    estimateSec: null,
    game: 'Super Mario 64',
    runKey: 'd1',
    confidence: 'high',
    ourElapsedSec: null,
    driftSec: null,
    currentKey: 'd0',
  };
  const host = { schedule: schedule() };
  function live(): RoomState {
    const s = initialState();
    s.currentKey = 'd0';
    s.runs.d0 = { startedAt: 0 };
    s.tracking = { twitch: false, vision: true, autoApply: false };
    return s;
  }

  it('turns a reading of a later run into a detection, with the start from its timer', () => {
    const s = live();
    observeCapture(s, host, null, { ...base, elapsedSec: 60 });
    expect(s.detection).toMatchObject({ runKey: 'd1', startedAt: 1_000_000 - 60_000 });
  });

  it('ignores low-confidence readings, errors, and stream reading being off', () => {
    const s = live();
    observeCapture(s, host, null, { ...base, confidence: 'low' });
    observeCapture(s, host, null, { ...base, error: 'boom' });
    s.tracking.vision = false;
    observeCapture(s, host, null, base);
    expect(s.detection).toBeNull();
  });

  it('does not raise a dismissed reading again until the stream changes', () => {
    const s = live();
    const prev = { ...base, elapsedSec: 60 };
    // Same run, timer still running: a repeat, and nothing is pending for it.
    observeCapture(s, host, prev, { ...base, at: base.at + 60_000, elapsedSec: 120 });
    expect(s.detection).toBeNull();
    // The timer starting on stream is a change worth reporting.
    observeCapture(s, host, { ...base, elapsedSec: 0 }, { ...base, elapsedSec: 5 });
    expect(s.detection?.runKey).toBe('d1');
  });
});
