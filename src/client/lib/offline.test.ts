import { describe, expect, it } from 'vitest';
import type { RoomRef, RoomState, Schedule } from '../../shared/types.ts';
import { dropSnapshot, KEEP, loadSnapshot, saveSnapshot } from './offline.ts';

/** In-memory Storage that can be told to run out of space. */
class FakeStore {
  data = new Map<string, string>();
  quota = Infinity;
  getItem(k: string) {
    return this.data.get(k) ?? null;
  }
  setItem(k: string, v: string) {
    const used = [...this.data].reduce((n, [key, val]) => n + (key === k ? 0 : val.length), 0);
    if (used + v.length > this.quota) throw new DOMException('full', 'QuotaExceededError');
    this.data.set(k, v);
  }
  removeItem(k: string) {
    this.data.delete(k);
  }
}

const ref = (slug: string): RoomRef => ({ source: 'oengus', event: 'ev', slug });
const schedule = (r: RoomRef, pad = 0): Schedule => ({
  ref: r,
  eventName: 'Event',
  scheduleName: r.slug,
  twitch: '',
  lines: [],
  fetchedAt: 0,
  ...(pad ? { padding: 'x'.repeat(pad) } : {}),
});
const state = { rev: 3, currentKey: null, runs: {} } as unknown as RoomState;
const snap = (r: RoomRef, pad = 0) => ({
  schedule: schedule(r, pad),
  state,
  savedAt: 1000,
  offset: 25,
});

describe('room snapshots', () => {
  it('round-trips a room', () => {
    const store = new FakeStore();
    expect(saveSnapshot(ref('a'), snap(ref('a')), store)).toBe(true);
    const back = loadSnapshot(ref('a'), store);
    expect(back?.state.rev).toBe(3);
    expect(back?.offset).toBe(25);
    expect(loadSnapshot(ref('b'), store)).toBeNull();
  });

  it('rejects snapshots for another room or an old format', () => {
    const store = new FakeStore();
    store.setItem('sh.snap.oengus/ev/a', JSON.stringify({ v: 1, ...snap(ref('other')) }));
    expect(loadSnapshot(ref('a'), store)).toBeNull();
    expect(store.getItem('sh.snap.oengus/ev/a')).toBeNull();
    store.setItem('sh.snap.oengus/ev/a', JSON.stringify({ v: 0, ...snap(ref('a')) }));
    expect(loadSnapshot(ref('a'), store)).toBeNull();
    store.setItem('sh.snap.oengus/ev/a', '{not json');
    expect(loadSnapshot(ref('a'), store)).toBeNull();
  });

  it(`keeps only the ${KEEP} most recent rooms`, () => {
    const store = new FakeStore();
    for (const slug of ['a', 'b', 'c', 'd', 'e']) saveSnapshot(ref(slug), snap(ref(slug)), store);
    expect(loadSnapshot(ref('a'), store)).toBeNull();
    expect(loadSnapshot(ref('e'), store)).not.toBeNull();
    // Re-saving moves a room to the front.
    saveSnapshot(ref('b'), snap(ref('b')), store);
    saveSnapshot(ref('f'), snap(ref('f')), store);
    expect(loadSnapshot(ref('b'), store)).not.toBeNull();
    expect(loadSnapshot(ref('c'), store)).toBeNull();
  });

  it('evicts other rooms when storage is full, and gives up gracefully', () => {
    const store = new FakeStore();
    saveSnapshot(ref('a'), snap(ref('a'), 4000), store);
    saveSnapshot(ref('b'), snap(ref('b'), 4000), store);
    store.quota = 9000;
    expect(saveSnapshot(ref('c'), snap(ref('c'), 4000), store)).toBe(true);
    expect(loadSnapshot(ref('a'), store)).toBeNull();
    expect(loadSnapshot(ref('b'), store)).not.toBeNull();

    expect(saveSnapshot(ref('d'), snap(ref('d'), 20_000), store)).toBe(false);
    expect(loadSnapshot(ref('d'), store)).toBeNull();
  });

  it('can drop a room', () => {
    const store = new FakeStore();
    saveSnapshot(ref('a'), snap(ref('a')), store);
    dropSnapshot(ref('a'), store);
    expect(loadSnapshot(ref('a'), store)).toBeNull();
    expect(JSON.parse(store.getItem('sh.snaps')!)).toEqual([]);
  });
});
