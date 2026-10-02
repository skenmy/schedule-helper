// The stream PC's NodeCG speedcontrol as a tracking source. It knows which run
// is up and runs the real timer, so it's trusted (one report is enough to act
// on, with auto-apply on). Reports come from the bundle in
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

/** What a report says: the status to show, and a signal for detection (if it names a run). */
export function readReport(
  lines: readonly ScheduleLine[],
  state: RoomState,
  report: Omit<NodecgReport, 't'>,
  now: number,
): { status: NodecgStatus; signal: Signal | null } {
  const run = report.run;
  const match = run ? matchRunData(lines, state, run) : null;
  const timer = report.timer;
  // Elapsed is measured on the stream PC and sent as a duration, so its clock doesn't matter.
  const startedAt =
    timer?.state === 'running' && timer.elapsedMs > 0 ? Math.round(now - timer.elapsedMs) : null;
  const status: NodecgStatus = {
    at: now,
    via: report.via,
    game: run?.game ?? null,
    runKey: match?.key ?? null,
    timer: timer?.state ?? null,
    elapsedSec: timer ? Math.floor(timer.elapsedMs / 1000) : null,
  };
  if (!match) return { status, signal: null };
  const via = report.via === 'bridge' ? ' (bridge)' : '';
  return {
    status,
    signal: {
      runKey: match.key,
      source: 'nodecg',
      at: now,
      detail:
        startedAt != null
          ? `${match.detail}${via}, timer ${fmtHMS(timer!.elapsedMs / 1000)}`
          : `${match.detail}${via}`,
      startedAt,
    },
  };
}

const changed = (a: NodecgStatus | null, b: NodecgStatus) =>
  !a ||
  b.at - a.at >= REFRESH_MS ||
  a.via !== b.via ||
  a.game !== b.game ||
  a.runKey !== b.runKey ||
  a.timer !== b.timer;

/** Takes a report: shows it to operators, and feeds it to detection. */
export function nodecgReport(room: Room, report: Omit<NodecgReport, 't'>, now = Date.now()): void {
  const { status, signal: sig } = readReport(room.schedule.lines, room.state, report, now);
  // Not every heartbeat: only what operators would see change (and a refresh now and then).
  if (changed(room.state.nodecg, status)) room.mutate((s) => void (s.nodecg = status));
  if (sig) signal(room, sig);
}
