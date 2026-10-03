// What's worth waking an operator's phone for. Pure functions over room state,
// so every rule is unit-tested; delivery lives in service.ts.
//
// Two kinds: changes (a new warning in the log, a run change spotted on
// stream, auto-tracking moving on) found by comparing the state before and
// after a commit, and timed ones (a run well over its estimate, the next run's
// runners not checked in as it nears) found by looking at the clock.

import {
  currentIndex,
  lineTitle,
  project,
  runTiming,
  upcomingIndexes,
} from '../../shared/derive.ts';
import { fmtDuration } from '../../shared/time.ts';
import type { RoomState, ScheduleLine } from '../../shared/types.ts';
import { describe } from '../tracking/detect.ts';
import { AUTO_ACTOR } from '../tracking/service.ts';

export interface Alert {
  title: string;
  body: string;
  /** Notifications with the same tag replace each other on the device. */
  tag: string;
  /** Who caused it: their own devices aren't told about what they just did. */
  actor: string | null;
}

/** A run this far over its estimate is worth a nudge. */
export const OVERRUN_ALERT_SEC = 15 * 60;
/** The next run's runners should be checked in by this long before it starts. */
export const CHECKIN_ALERT_SEC = 15 * 60;

/** Alerts for what changed between two states of a room. */
export function changeAlerts(
  prev: RoomState,
  next: RoomState,
  lines: readonly ScheduleLine[],
): Alert[] {
  const out: Alert[] = [];
  const seen = Math.max(prev.logSeq ?? 0, prev.log[0]?.id ?? 0);
  // Oldest first, so they arrive in the order they happened.
  for (const entry of next.log.filter((e) => e.id > seen).reverse()) {
    if (entry.kind === 'warning') {
      out.push({
        title: entry.text.startsWith('⏱') ? 'Runner running late' : 'Heads up',
        body: entry.text.replace(/^[⚠⏱]\s*/u, ''),
        tag: `log-${entry.id}`,
        actor: entry.actor,
      });
    } else if (entry.actor === AUTO_ACTOR) {
      out.push({
        title: entry.text.startsWith('■')
          ? 'Auto-tracking stopped the timer'
          : 'Auto-tracking moved on',
        body: `${entry.text.replace(/^[⇢■]\s*/u, '')}. Undo it in the app if that’s wrong.`,
        tag: `log-${entry.id}`,
        actor: null,
      });
    }
  }
  const d = next.detection;
  // Raised whether or not auto-apply is on: a detection waits for an operator
  // until it's corroborated, and auto-tracking acting on it is a second alert (above).
  const was = prev.detection;
  if (d && !(was && was.runKey === d.runKey && was.kind === d.kind)) {
    out.push({
      title: d.kind === 'finish' ? 'Run finished on stream' : 'Run change on stream',
      body: `${describe(d, lines)}. Open the app to accept or dismiss.`,
      // Per run, so a second run change sounds again instead of silently replacing the first.
      tag: `detection-${d.runKey}`,
      actor: null,
    });
  }
  return out;
}

/**
 * Alerts that are due by the clock, each at most once (`sent` holds the keys
 * already sent, and gains the new ones).
 */
export function timedAlerts(
  state: RoomState,
  lines: readonly ScheduleLine[],
  now: number,
  sent: Set<string>,
): Alert[] {
  if (state.finishedAt != null) return [];
  const out: Alert[] = [];
  const once = (key: string, alert: Alert) => {
    if (sent.has(key)) return;
    sent.add(key);
    out.push(alert);
  };

  const line = lines[currentIndex(lines, state)];
  if (line && !line.setupBlock && line.estimateSec > 0) {
    const t = runTiming(state.runs[line.key], now);
    const over = t.elapsedMs / 1000 - line.estimateSec;
    if (t.phase === 'running' && over >= OVERRUN_ALERT_SEC) {
      // Keyed by run, so back-dating its start (a capture, a detection) doesn't say it twice.
      once(`overrun:${line.key}`, {
        title: 'Run over estimate',
        body: `${lineTitle(line)} is ${fmtDuration(over)} over its ${fmtDuration(line.estimateSec)} estimate.`,
        tag: `overrun-${line.key}`,
        actor: null,
      });
    }
  }

  const [nextIndex] = upcomingIndexes(lines, state, 1);
  const upcoming = nextIndex == null ? undefined : lines[nextIndex];
  if (upcoming?.runners.length) {
    const rec = state.runs[upcoming.key];
    const start = project(lines, state, now)[nextIndex!]?.start;
    const inSec = start == null ? null : (start - now) / 1000;
    if (rec?.checkIn !== 'ready' && !rec?.late && inSec != null && inSec <= CHECKIN_ALERT_SEC) {
      const when = inSec > 60 ? `starts in about ${fmtDuration(inSec)}` : 'is up next';
      once(`checkin:${upcoming.key}`, {
        title: rec?.checkIn === 'missing' ? 'Runner still missing' : 'Runner not checked in',
        body: `${lineTitle(upcoming)} (${upcoming.runners.join(', ')}) ${when}.`,
        tag: `checkin-${upcoming.key}`,
        actor: null,
      });
    }
  }
  return out;
}
