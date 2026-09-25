// Per-browser preferences in localStorage. Everything shared between
// operators lives on the server instead.

import type { RoomRef } from '../../shared/types.ts';
import { DEFAULT_KIOSK, type KioskConfig } from './kiosk.ts';

export const THEMES = [
  { id: 'green', name: 'Green' },
  { id: 'lightblue', name: 'Light blue' },
  { id: 'darkblue', name: 'Dark blue' },
  { id: 'amber', name: 'Amber' },
  { id: 'purple', name: 'Purple' },
] as const;
export type ThemeId = (typeof THEMES)[number]['id'];

export interface RecentSchedule {
  ref: RoomRef;
  name: string;
  openedAt: number;
}

function read<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw == null ? fallback : (JSON.parse(raw) as T);
  } catch {
    return fallback;
  }
}

function write(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // storage full or blocked — preferences just won't persist
  }
}

/** Carry over the theme and recent list from the previous build's keys. */
function legacyTheme(): ThemeId {
  try {
    const old = localStorage.getItem('sched-theme');
    if (old && THEMES.some((t) => t.id === old)) return old as ThemeId;
  } catch {
    // ignore
  }
  return 'green';
}

function legacyRecent(): RecentSchedule[] {
  const old = read<
    { source?: string; marathonId?: string; slug?: string; name?: string; savedAt?: number }[]
  >('sched-recent', []);
  return old
    .filter((e) => (e.source === 'oengus' || e.source === 'horaro') && e.marathonId && e.slug)
    .map((e) => ({
      ref: { source: e.source as 'oengus' | 'horaro', event: e.marathonId!, slug: e.slug! },
      name: e.name ?? `${e.marathonId}/${e.slug}`,
      openedAt: e.savedAt ?? 0,
    }));
}

class Prefs {
  theme = $state<ThemeId>(read('sh.theme', legacyTheme()));
  zoomHours = $state<number>(read('sh.zoom', 6));
  recent = $state<RecentSchedule[]>(read('sh.recent', legacyRecent()));
  kiosk = $state<KioskConfig>(read('sh.kiosk', DEFAULT_KIOSK));
  logFilter = $state<string>(read('sh.logFilter', 'all'));

  constructor() {
    $effect.root(() => {
      $effect(() => write('sh.theme', this.theme));
      $effect(() => write('sh.zoom', this.zoomHours));
      $effect(() => write('sh.recent', this.recent));
      $effect(() => write('sh.kiosk', this.kiosk));
      $effect(() => write('sh.logFilter', this.logFilter));
    });
  }

  remember(ref: RoomRef, name: string): void {
    const same = (r: RoomRef) =>
      r.source === ref.source && r.event === ref.event && r.slug === ref.slug;
    this.recent = [
      { ref, name, openedAt: Date.now() },
      ...this.recent.filter((e) => !same(e.ref)),
    ].slice(0, 6);
  }

  forget(ref: RoomRef): void {
    this.recent = this.recent.filter(
      (e) => !(e.ref.source === ref.source && e.ref.event === ref.event && e.ref.slug === ref.slug),
    );
  }
}

export const prefs = new Prefs();
