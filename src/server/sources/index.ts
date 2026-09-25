// Schedule sources behind one cached interface.

import type { RoomRef, Schedule, ScheduleSource, ScheduleSummary } from '../../shared/types.ts';
import { demoSchedule, demoSchedules } from './demo.ts';
import { horaroEvent, horaroSchedule, horaroSchedules } from './horaro.ts';
import { oengusEvent, oengusSchedule, oengusSchedules } from './oengus.ts';

export { UpstreamError } from './http.ts';

const TTL_MS = 60_000;
const cache = new Map<string, { at: number; value: Promise<unknown> }>();

/** Caches successful lookups for a minute and collapses concurrent requests. */
function cached<T>(key: string, fresh: boolean, load: () => Promise<T>): Promise<T> {
  const hit = cache.get(key);
  if (!fresh && hit && Date.now() - hit.at < TTL_MS) return hit.value as Promise<T>;
  const value = load();
  cache.set(key, { at: Date.now(), value });
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
        return Promise.resolve(demoSchedule());
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
        return { name: 'Demo Marathon', schedules: demoSchedules };
    }
  });
}
