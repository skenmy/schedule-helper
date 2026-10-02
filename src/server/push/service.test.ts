import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { RoomRef } from '../../shared/types.ts';
import type { RoomRegistry } from '../rooms/registry.ts';
import { Room } from '../rooms/room.ts';
import { initialState } from '../rooms/state.ts';
import { demoSchedule } from '../sources/demo.ts';
import { loadVapidKeys } from './keys.ts';
import { PushService, type Notification } from './service.ts';
import { PushStore, type DeviceSubscription } from './store.ts';

const REF: RoomRef = { source: 'oengus', event: 'pushed', slug: 'main' };
const device = (n: number): DeviceSubscription => ({
  endpoint: `https://fcm.googleapis.com/fcm/send/device-${n}`,
  keys: { p256dh: 'p', auth: 'a' },
});
const dirs: string[] = [];
const tmp = () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'sh-push-'));
  dirs.push(d);
  return d;
};
afterEach(() => {
  for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
});

function setup(store = new PushStore(null)) {
  const schedule = { ...demoSchedule(), ref: REF };
  const state = initialState();
  state.currentKey = 'd0';
  state.runs.d0 = { startedAt: Date.now() - 60_000 };
  const room = new Room({
    ref: REF,
    schedule,
    state,
    store: null,
    services: { fetchSchedule: async () => schedule, capture: async () => {} },
  });
  const opened: RoomRef[] = [];
  const registry = {
    open: async (ref: RoomRef) => (opened.push(ref), room),
    get: () => room,
  } as unknown as RoomRegistry;
  const sent: { endpoint: string; n: Notification }[] = [];
  const failing = new Map<string, number>();
  const push = new PushService({
    registry,
    store,
    publicKey: 'public',
    send: async (sub, n) => {
      const status = failing.get(sub.endpoint);
      if (status) throw Object.assign(new Error('gone'), { statusCode: status });
      sent.push({ endpoint: sub.endpoint, n });
    },
  });
  return { room, push, sent, failing, store, opened };
}

describe('PushService', () => {
  it('tells every follower about a warning, except whoever caused it', async () => {
    const { room, push, sent } = setup();
    push.follow(room, device(1), 'op');
    push.follow(room, device(2), 'someone else');
    expect(room.watcherCount).toBe(1); // kept loaded for timed alerts

    room.dispatch({ action: 'runner:checkin', key: 'd2', status: 'missing' }, 'op');
    await Promise.resolve();
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({
      endpoint: device(2).endpoint,
      n: {
        title: expect.stringMatching(/^Heads up · /),
        body: expect.stringContaining('missing for'),
        tag: 'oengus/pushed/main:log-1',
        url: '/oengus/pushed/main',
      },
    });
  });

  it('forgets a device the push service says is gone', async () => {
    const { room, push, failing, store } = setup();
    push.follow(room, device(1), null);
    failing.set(device(1).endpoint, 410);
    room.dispatch({ action: 'runner:checkin', key: 'd2', status: 'missing' }, 'op');
    await new Promise((r) => setTimeout(r, 0));
    expect(store.has(REF, device(1).endpoint)).toBe(false);
    expect(room.watcherCount).toBe(0);
  });

  it('sends timed alerts from the clock, once each', () => {
    const { room, push, sent } = setup();
    push.follow(room, device(1), null);
    const est = room.schedule.lines[0]!.estimateSec * 1000;
    push.tick(room.state.runs.d0!.startedAt! + est + 16 * 60_000);
    push.tick(room.state.runs.d0!.startedAt! + est + 17 * 60_000);
    expect(sent.filter((s) => s.n.title.startsWith('Run over estimate'))).toHaveLength(1);
  });

  it('stops watching a room nobody follows', () => {
    const { room, push } = setup();
    push.follow(room, device(1), null);
    push.unfollow(REF, device(1).endpoint);
    expect(room.watcherCount).toBe(0);
    expect(push.isOn(REF, device(1).endpoint)).toBe(false);
  });

  it('remembers followers across a restart and reopens their rooms', async () => {
    const dir = tmp();
    const first = setup(new PushStore(dir));
    first.push.follow(first.room, device(1), 'op');
    const again = setup(new PushStore(dir));
    expect(again.push.isOn(REF, device(1).endpoint)).toBe(true);
    again.push.start();
    await new Promise((r) => setTimeout(r, 0));
    expect(again.opened).toEqual([REF]);
    expect(again.room.watcherCount).toBe(1);
    again.push.stop();
    expect(fs.statSync(path.join(dir, 'push-subscriptions.json')).mode & 0o777).toBe(0o600);
  });
});

describe('loadVapidKeys', () => {
  it('keeps one key pair in the data directory, unless pinned', () => {
    const dir = tmp();
    const keys = loadVapidKeys(dir);
    expect(keys.publicKey).toMatch(/^[A-Za-z0-9_-]{87}$/);
    expect(loadVapidKeys(dir)).toEqual(keys);
    expect(fs.statSync(path.join(dir, 'vapid.json')).mode & 0o777).toBe(0o600);
    expect(loadVapidKeys(dir, { publicKey: 'pub', privateKey: 'priv' })).toEqual({
      publicKey: 'pub',
      privateKey: 'priv',
    });
  });
});
