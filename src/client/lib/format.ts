// UI formatting helpers on top of the shared time formatters.

import type { Live } from './live.svelte.ts';

import { fmtClock, fmtDay, sameDay } from '../../shared/time.ts';

export {
  fmtClock,
  fmtDay,
  fmtDelta,
  fmtDuration,
  fmtHM,
  fmtHMS,
  fmtOffsetShort,
  sameDay,
} from '../../shared/time.ts';

/** `17:14` today, `Sat 17:14` on another day — for multi-day marathons. */
export function fmtWhen(ms: number | null | undefined, now: number): string {
  if (ms == null) return '—';
  return sameDay(ms, now) ? fmtClock(ms) : `${fmtDay(ms)} ${fmtClock(ms)}`;
}

export type RunStatus = 'current' | 'done' | 'skipped' | 'upcoming' | 'setup';

export function runStatus(live: Live, index: number): RunStatus {
  const line = live.lines[index];
  if (!line) return 'upcoming';
  if (line.setupBlock) return 'setup';
  if (live.state.runs[line.key]?.skipped) return 'skipped';
  if (index === live.curIndex) return 'current';
  if (live.phase === 'complete' || (live.curIndex >= 0 && index < live.curIndex)) return 'done';
  return 'upcoming';
}

export function relTime(ms: number, now: number): string {
  const s = Math.round((now - ms) / 1000);
  if (s < 45) return 'just now';
  if (s < 3600) return `${Math.round(s / 60)}m ago`;
  if (s < 86_400) return `${Math.round(s / 3600)}h ago`;
  return `${Math.round(s / 86_400)}d ago`;
}

export function initials(name: string): string {
  return (name.trim()[0] ?? '?').toUpperCase();
}

/** Stable per-name hue for runner avatars. */
export function hueOf(name: string): number {
  let h = 0;
  for (const ch of name.toLowerCase()) h = (h * 31 + ch.charCodeAt(0)) % 360;
  return h;
}
