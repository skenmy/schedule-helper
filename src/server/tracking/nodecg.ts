// The stream PC's NodeCG speedcontrol as a tracking source. It knows which run
// is up and runs the real timer, so it's trusted (one report is enough to act
// on, with auto-apply on), and it's the one source that can say when a run
// finished. Reports come from the bundle in
// integrations/nodecg-schedule-helper, or the bridge page (src/client/bridge.ts),
// over POST /api/rooms/{ref}/nodecg.

import { fmtHMS } from '../../shared/time.ts';
import type { NodecgReport } from '../../shared/protocol.ts';
import type { NodecgStatus, RoomState, ScheduleLine } from '../../shared/types.ts';
import type { Room } from '../rooms/room.ts';
import type { Signal } from './detect.ts';
import { matchRunData } from './match.ts';
import { signal } from './service.ts';

/** A status this old is refreshed even if nothing changed, so "last heard" stays honest. */
const REFRESH_MS = 60_000;

/**
 * What a report says: the status to show, and a signal for detection (if it names a run).
 *
 * Elapsed time is measured on the stream PC and sent as a duration, so its clock
 * doesn't matter: a running timer gives the start (now − elapsed). A finished
 * timer only gives its final time, so its finish is the start remembered from
 * the last report while it ran (`state.nodecg`), plus that final time. Without
 * one (connected after the finish), there's no finish time to offer.
 */
export function readReport(
  lines: readonly ScheduleLine[],
  state: RoomState,
  report: Omit<NodecgReport, 't'>,
  now: number,
): { status: NodecgStatus; signal: Signal | null } {
  const run = report.run;
  const match = run ? matchRunData(lines, state, run) : null;
  const timer = report.timer;
  const prev = state.nodecg;
  const sameRun =
    prev != null && prev.runKey === (match?.key ?? null) && prev.game === (run?.game ?? null);
  let startedAt: number | null = null;
  let endedAt: number | null = null;
  if (timer?.state === 'running' && timer.elapsedMs > 0) {
    startedAt = Math.round(now - timer.elapsedMs);
  } else if (sameRun && (timer?.state === 'paused' || timer?.state === 'finished')) {
    startedAt = prev.startedAt ?? null;
    if (timer.state === 'finished') {
      // Kept from the first report after it finished, so heartbeats don't move it.
      endedAt =
        prev.timer === 'finished' && prev.endedAt != null
          ? prev.endedAt
          : startedAt != null
            ? startedAt + timer.elapsedMs
            : null;
    }
  }
  const status: NodecgStatus = {
    at: now,
    via: report.via,
    game: run?.game ?? null,
    runKey: match?.key ?? null,
    timer: timer?.state ?? null,
    elapsedSec: timer ? Math.floor(timer.elapsedMs / 1000) : null,
    startedAt,
    endedAt,
  };
  if (!match) return { status, signal: null };
  const via = report.via === 'bridge' ? ' (bridge)' : '';
  const running = timer?.state === 'running' && startedAt != null;
  return {
    status,
    signal: {
      runKey: match.key,
      source: 'nodecg',
      at: now,
      detail: running
        ? `${match.detail}${via}, timer ${fmtHMS(timer.elapsedMs / 1000)}`
        : endedAt != null
          ? `${match.detail}${via}, finished in ${fmtHMS(timer!.elapsedMs / 1000)}`
          : `${match.detail}${via}`,
      // Only a running timer says when a run started: a finished one on a later run
      // mustn't start it here.
      startedAt: running ? startedAt : null,
      endedAt,
    },
  };
}

const changed = (a: NodecgStatus | null, b: NodecgStatus) =>
  !a ||
  b.at - a.at >= REFRESH_MS ||
  a.via !== b.via ||
  a.game !== b.game ||
  a.runKey !== b.runKey ||
  a.timer !== b.timer ||
  // A start learnt late (the first report while running had no elapsed time yet).
  (a.startedAt == null && b.startedAt != null);

/** Takes a report: shows it to operators, and feeds it to detection. */
export function nodecgReport(room: Room, report: Omit<NodecgReport, 't'>, now = Date.now()): void {
  const { status, signal: sig } = readReport(room.schedule.lines, room.state, report, now);
  // Not every heartbeat: only what operators would see change (and a refresh now and then).
  if (changed(room.state.nodecg, status)) room.mutate((s) => void (s.nodecg = status));
  if (sig) signal(room, sig);
}
