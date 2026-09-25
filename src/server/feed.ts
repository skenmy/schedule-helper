// Read-only overlay / integration feed: a compact snapshot of what's live,
// what's next and how the marathon is tracking.

import {
  computeDelta,
  currentIndex,
  lineTitle,
  marathonPhase,
  marathonStats,
  project,
  projectedEnd,
  runTiming,
  scheduleStatus,
  upcomingIndexes,
} from '../shared/derive.ts';
import type { ScheduleLine } from '../shared/types.ts';
import type { Room } from './rooms/room.ts';

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
    })),
    delta: delta == null ? null : { seconds: delta, status: scheduleStatus(delta) },
    scheduledEnd: stats.scheduledEnd,
    projectedEnd: projectedEnd(projection),
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
