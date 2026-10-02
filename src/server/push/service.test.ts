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
import { isPrivateAddress, MAX_FOLLOWERS, PushService, type Notification } from './service.ts';
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

function makeRoom(ref: RoomRef, startedAgoMs = 60_000) {
  const schedule = { ...demoSchedule(), ref };
  const state = initialState();
  state.currentKey = 'd0';
  state.runs.d0 = { startedAt: Date.now() - startedAgoMs };
  return new Room({
    ref,
    schedule,
    state,
    store: null,
    services: { fetchSchedule: async () => schedule, capture: async () => {} },
  });
}

function setup(store = new PushStore(null), rooms = [makeRoom(REF)]) {
  const room = rooms[0]!;
  const opened: RoomRef[] = [];
  const loaded = new Set<Room>();
  const find = (ref: RoomRef) =>
    rooms.find((r) => r.key === `${ref.source}/${ref.event}/${ref.slug}`);
  // Like the real registry: a room is loaded once something has opened it.
  const registry = {
    open: async (ref: RoomRef) => {
      opened.push(ref);
      const r = find(ref)!;
      loaded.add(r);
      return r;
    },
    get: (ref: RoomRef) => [...loaded].find((r) => r === find(ref)),
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

describe('PushService lifecycle', () => {
  const OTHER: RoomRef = { ...REF, slug: 'side' };

  it('lets go of every room a gone device followed', async () => {
    const rooms = [makeRoom(REF), makeRoom(OTHER)];
    const { push, failing } = setup(new PushStore(null), rooms);
    push.follow(rooms[0]!, device(1), null);
    push.follow(rooms[1]!, device(1), null);
    failing.set(device(1).endpoint, 403); // subscribed with keys we no longer have
    rooms[0]!.dispatch({ action: 'runner:checkin', key: 'd2', status: 'missing' }, 'op');
    await new Promise((r) => setTimeout(r, 0));
    expect(rooms.map((r) => r.watcherCount)).toEqual([0, 0]);
  });

  it('stops watching a marathon that finished a while ago, but keeps the follower', () => {
    const { room, push } = setup();
    push.follow(room, device(1), null);
    room.state.finishedAt = Date.now() - 3 * 3_600_000;
    push.tick();
    expect(room.watcherCount).toBe(0);
    expect(push.isOn(REF, device(1).endpoint)).toBe(true);
    // Reopened for another go: watched again.
    room.state.finishedAt = null;
    push.tick();
    expect(room.watcherCount).toBe(1);
  });

  it('says nothing about what was already due when it started watching', () => {
    const room = makeRoom(REF, 3 * 3_600_000); // hours over its estimate already
    const { push, sent } = setup(new PushStore(null), [room]);
    push.follow(room, device(1), null);
    push.tick();
    expect(sent).toEqual([]);
  });

  it('doesn’t repeat an overrun when the start is back-dated', () => {
    const { room, push, sent } = setup();
    push.follow(room, device(1), null);
    const est = room.schedule.lines[0]!.estimateSec * 1000;
    const due = room.state.runs.d0!.startedAt! + est + 16 * 60_000;
    push.tick(due);
    room.state.runs.d0!.startedAt! -= 5_000;
    push.tick(due + 1_000);
    expect(sent.filter((x) => x.n.title.startsWith('Run over estimate'))).toHaveLength(1);
  });

  it('caps followers per schedule', () => {
    const { room, push } = setup();
    for (let i = 0; i < MAX_FOLLOWERS; i++) push.follow(room, device(i), null);
    expect(() => push.follow(room, device(MAX_FOLLOWERS), null)).toThrow(/At most/);
    // Following again from a device already on the list is fine.
    expect(() => push.follow(room, device(0), null)).not.toThrow();
  });
});

describe('isPrivateAddress', () => {
  it('refuses loopback, private, link-local and mapped addresses', () => {
    for (const a of [
      '127.0.0.1',
      '10.1.2.3',
      '172.20.0.5',
      '192.168.1.1',
      '169.254.169.254',
      '::1',
      'fd00::1',
      'fe80::1',
      '::ffff:127.0.0.1',
      '0.0.0.0',
    ]) {
      expect(isPrivateAddress(a), a).toBe(true);
    }
    for (const a of ['142.250.180.10', '2a00:1450:4009:81f::200a', '::ffff:8.8.8.8']) {
      expect(isPrivateAddress(a), a).toBe(false);
    }
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
    expect(() => loadVapidKeys(dir, { publicKey: 'pub' })).toThrow(/both/);
  });

  it('won’t start on a broken key file rather than orphan every subscription', () => {
    const dir = tmp();
    fs.writeFileSync(path.join(dir, 'vapid.json'), '{}');
    expect(() => loadVapidKeys(dir)).toThrow(/missing a key/);
  });
});
