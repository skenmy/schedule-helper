// Read-only overlay / integration feed: a compact snapshot of what's live,
// what's next and how the marathon is tracking.

import {
  computeDelta,
  currentIndex,
  eventPace,
  lineTitle,
  marathonPhase,
  marathonStats,
  project,
  projectedEnd,
  runTiming,
  scheduleStatus,
  upcomingIndexes,
} from '../shared/derive.ts';
import type { RunnerLate, ScheduleLine } from '../shared/types.ts';
import type { Room } from './rooms/room.ts';

const lateOf = (late: RunnerLate | undefined) =>
  late ? { at: late.at, etaAt: late.etaAt, self: late.self } : null;

function runInfo(line: ScheduleLine) {
  return {
    key: line.key,
    title: lineTitle(line),
    game: line.game,
    category: line.category,
    console: line.console,
    type: line.type,
    runners: line.runners,
    estimateSec: line.estimateSec,
    scheduledStart: line.scheduledStart,
  };
}

export function buildFeed(room: Room, now = Date.now()) {
  const { lines } = room.schedule;
  const s = room.state;
  const cur = currentIndex(lines, s);
  const line = lines[cur];
  const timing = line ? runTiming(s.runs[line.key], now) : null;
  const delta = computeDelta(lines, s, now);
  const projection = project(lines, s, now);
  const stats = marathonStats(lines, s, now);
  const pace = eventPace(lines, s);

  return {
    rev: s.rev,
    serverTime: now,
    event: {
      name: room.schedule.eventName,
      schedule: room.schedule.scheduleName,
      ...room.ref,
    },
    phase: marathonPhase(lines, s, now),
    current:
      line && timing
        ? {
            ...runInfo(line),
            phase: timing.phase,
            startedAt: timing.startedAt,
            endedAt: timing.endedAt,
            elapsedSec: Math.floor(timing.elapsedMs / 1000),
          }
        : null,
    next: upcomingIndexes(lines, s, 5).map((i) => ({
      ...runInfo(lines[i]!),
      projectedStart: projection[i]?.start ?? null,
      checkIn: s.runs[lines[i]!.key]?.checkIn ?? null,
      // Not the runner's note: the feed goes on stream, and that text was written for organisers.
      late: lateOf(s.runs[lines[i]!.key]?.late),
    })),
    delta: delta == null ? null : { seconds: delta, status: scheduleStatus(delta) },
    scheduledEnd: stats.scheduledEnd,
    projectedEnd: projectedEnd(projection),
    /** The end if the rest goes at this event's pace so far (null until a few runs finish). */
    likelyEnd: pace ? projectedEnd(project(lines, s, now, pace)) : null,
    pace: pace && {
      runRatio: Math.round(pace.runRatio * 1000) / 1000,
      setupDeltaSec: pace.setupDeltaSec,
    },
    progress: {
      runsDone: stats.runsDone,
      runsTotal: stats.runsTotal,
      runsSkipped: stats.runsSkipped,
    },
    twitchChannel: s.twitchChannel,
    message: s.message ? { text: s.message.text, color: s.message.color } : null,
    announcement: s.announcement
      ? { text: s.announcement.text, color: s.announcement.color }
      : null,
  };
}

export type Feed = ReturnType<typeof buildFeed>;
