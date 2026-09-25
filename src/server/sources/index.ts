// Schedule sources behind one cached interface.

import { DEMO_REF } from '../../shared/sources.ts';
import type { RoomRef, Schedule, ScheduleSource, ScheduleSummary } from '../../shared/types.ts';
import { demoSchedule, demoSchedules } from './demo.ts';
import { horaroEvent, horaroSchedule, horaroSchedules } from './horaro.ts';
import { UpstreamError } from './http.ts';
import { oengusEvent, oengusSchedule, oengusSchedules } from './oengus.ts';

export { UpstreamError };

const TTL_MS = 60_000;
const CACHE_LIMIT = 200;
const cache = new Map<string, { at: number; value: Promise<unknown> }>();

const isDemoRef = (ref: RoomRef) => ref.event === DEMO_REF.event && ref.slug === DEMO_REF.slug;

/** Caches successful lookups for a minute and collapses concurrent requests. */
function cached<T>(key: string, fresh: boolean, load: () => Promise<T>): Promise<T> {
  const now = Date.now();
  const hit = cache.get(key);
  if (!fresh && hit && now - hit.at < TTL_MS) return hit.value as Promise<T>;
  const value = load();
  cache.delete(key);
  cache.set(key, { at: now, value });
  // Bounded: drop expired entries, then the oldest, so lookups can't grow memory forever.
  if (cache.size > CACHE_LIMIT) {
    for (const [k, v] of cache) if (now - v.at >= TTL_MS) cache.delete(k);
    while (cache.size > CACHE_LIMIT) cache.delete(cache.keys().next().value!);
  }
  value.catch(() => {
    if (cache.get(key)?.value === value) cache.delete(key);
  });
  return value;
}

export function fetchSchedule(ref: RoomRef, { fresh = false } = {}): Promise<Schedule> {
  return cached(`schedule:${ref.source}/${ref.event}/${ref.slug}`, fresh, () => {
    switch (ref.source) {
      case 'oengus':
        return oengusSchedule(ref.event, ref.slug);
      case 'horaro':
        return horaroSchedule(ref.event, ref.slug);
      case 'demo':
        // Only the one demo room exists; anything else would let anonymous
        // clients create unlimited rooms.
        return isDemoRef(ref)
          ? Promise.resolve(demoSchedule())
          : Promise.reject(new UpstreamError('Not found', 404));
    }
  });
}

export interface EventListing {
  name: string;
  schedules: ScheduleSummary[];
}

export function fetchEventListing(source: ScheduleSource, event: string): Promise<EventListing> {
  return cached(`event:${source}/${event}`, false, async () => {
    switch (source) {
      case 'oengus': {
        const [info, schedules] = await Promise.all([oengusEvent(event), oengusSchedules(event)]);
        return { name: info.name, schedules };
      }
      case 'horaro': {
        const [info, schedules] = await Promise.all([horaroEvent(event), horaroSchedules(event)]);
        return { name: info.name, schedules };
      }
      case 'demo':
        if (event !== DEMO_REF.event) throw new UpstreamError('Not found', 404);
        return { name: 'Demo Marathon', schedules: demoSchedules };
    }
  });
}
