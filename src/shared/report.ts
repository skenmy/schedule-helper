// The event report: planned against actual, per run and overall. Pure, so the
// report page, the CSV/JSON exports and the tests all read the same numbers.
// Built from derive.ts — no schedule maths of its own beyond adding up.

import {
  currentIndex,
  eventPace,
  lineTitle,
  nextPlayableIndex,
  project,
  projectedEnd,
  scheduledEndOf,
  scheduledStartOf,
} from './derive.ts';
import { fmtHMS } from './time.ts';
import type { RoomRef, RoomState, Schedule } from './types.ts';

export type ReportStatus = 'done' | 'live' | 'skipped' | 'upcoming' | 'interlude';

export interface ReportRow {
  key: string;
  /** Run number as shown in the app (interludes have none). */
  number: number | null;
  title: string;
  category: string;
  runners: string[];
  status: ReportStatus;
  scheduledStart: number | null;
  estimateSec: number;
  startedAt: number | null;
  endedAt: number | null;
  /** How long it took (finished runs only). */
  actualSec: number | null;
  /** Actual minus estimate: positive ran over. */
  overSec: number | null;
  /** Scheduled minus actual start: positive started early, like the live delta. */
  startDeltaSec: number | null;
  /** End of this run to the start of the next one played, and what was planned for it. */
  changeoverSec: number | null;
  plannedChangeoverSec: number | null;
}

export interface Report {
  event: { name: string; schedule: string; ref: RoomRef };
  generatedAt: number;
  complete: boolean;
  scheduledStart: number | null;
  scheduledEnd: number | null;
  actualStart: number | null;
  /** When it finished, or null while it's still going. */
  actualEnd: number | null;
  /** While it's going: where it's headed (plain), and at its own pace. */
  projectedEnd: number | null;
  likelyEnd: number | null;
  runs: { total: number; done: number; skipped: number };
  /** Finished runs: time taken against their estimates. */
  runTimeSec: number;
  runEstimateSec: number;
  /** Median changeover minus plan, over measured changeovers. */
  changeoverDeltaSec: number | null;
  rows: ReportRow[];
  /** Up to five each, biggest first. */
  overruns: ReportRow[];
  underruns: ReportRow[];
}

const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length ? (s.length % 2 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2) : null;
};
const sec = (ms: number) => Math.round(ms / 1000);

export function buildReport(schedule: Schedule, state: RoomState, now: number): Report {
  const { lines } = schedule;
  const cur = currentIndex(lines, state);
  const complete = state.finishedAt != null;
  let number = 0;
  const rows: ReportRow[] = lines.map((line, i) => {
    const rec = state.runs[line.key];
    const started = rec?.startedAt ?? null;
    const ended = rec?.endedAt ?? null;
    const status: ReportStatus = line.setupBlock
      ? 'interlude'
      : rec?.skipped
        ? 'skipped'
        : i === cur
          ? 'live'
          : started != null && ended != null
            ? 'done'
            : 'upcoming';
    const actualSec = status === 'done' ? sec(ended! - started!) : null;
    let changeoverSec: number | null = null;
    let plannedChangeoverSec: number | null = null;
    const next = nextPlayableIndex(lines, state.runs, i);
    const nextStart = next >= 0 ? state.runs[lines[next]!.key]?.startedAt : undefined;
    if (
      (status === 'done' || status === 'live') &&
      ended != null &&
      nextStart != null &&
      nextStart >= ended
    ) {
      changeoverSec = sec(nextStart - ended);
      plannedChangeoverSec = line.setupSec;
      for (let j = i + 1; j < next; j++) {
        if (lines[j]!.setupBlock)
          plannedChangeoverSec += lines[j]!.estimateSec + lines[j]!.setupSec;
      }
    }
    return {
      key: line.key,
      number: line.setupBlock ? null : ++number,
      title: lineTitle(line),
      category: line.category,
      runners: line.runners,
      status,
      scheduledStart: line.scheduledStart,
      estimateSec: line.estimateSec,
      startedAt: line.setupBlock ? null : started,
      endedAt: line.setupBlock ? null : ended,
      actualSec,
      overSec: actualSec != null ? actualSec - line.estimateSec : null,
      startDeltaSec:
        started != null && line.scheduledStart != null && !line.setupBlock
          ? sec(line.scheduledStart - started)
          : null,
      changeoverSec,
      plannedChangeoverSec,
    };
  });

  const done = rows.filter((r) => r.status === 'done');
  const starts = rows.map((r) => r.startedAt).filter((t): t is number => t != null);
  const lastEnd = rows.map((r) => r.endedAt).filter((t): t is number => t != null);
  const byOver = done.filter((r) => r.overSec != null).sort((a, b) => b.overSec! - a.overSec!);
  const pace = complete ? null : eventPace(lines, state);
  const deltas = rows
    .filter((r) => r.changeoverSec != null && r.plannedChangeoverSec != null)
    .map((r) => r.changeoverSec! - r.plannedChangeoverSec!);

  return {
    event: { name: schedule.eventName, schedule: schedule.scheduleName, ref: schedule.ref },
    generatedAt: now,
    complete,
    scheduledStart: scheduledStartOf(lines),
    scheduledEnd: scheduledEndOf(lines),
    actualStart: starts.length ? Math.min(...starts) : null,
    actualEnd: complete
      ? (state.finishedAt ?? (lastEnd.length ? Math.max(...lastEnd) : null))
      : null,
    projectedEnd: complete ? null : projectedEnd(project(lines, state, now)),
    likelyEnd: pace ? projectedEnd(project(lines, state, now, pace)) : null,
    runs: {
      total: rows.filter((r) => r.number != null).length,
      done: done.length,
      skipped: rows.filter((r) => r.status === 'skipped').length,
    },
    runTimeSec: done.reduce((n, r) => n + r.actualSec!, 0),
    runEstimateSec: done.reduce((n, r) => n + r.estimateSec, 0),
    changeoverDeltaSec: median(deltas),
    rows,
    overruns: byOver.filter((r) => r.overSec! > 0).slice(0, 5),
    underruns: byOver
      .filter((r) => r.overSec! < 0)
      .reverse()
      .slice(0, 5),
  };
}

// ─── CSV ─────────────────────────────────────────────────────────────────────

const iso = (t: number | null) => (t == null ? '' : new Date(t).toISOString());
const dur = (s: number | null) => (s == null ? '' : fmtHMS(Math.abs(s)));
const signed = (s: number | null) => (s == null ? '' : String(s));

/** Quotes a CSV field when it needs it. */
function field(value: string): string {
  return /[",\n\r]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value;
}

/**
 * Free text from the schedule (titles, runner names): a leading = + - @ would
 * run as a formula when the file is opened in a spreadsheet.
 */
const text = (value: string) => (/^[=+\-@\t\r]/.test(value) ? `'${value}` : value);

/** One row per schedule line. Times are ISO 8601 (UTC); durations H:MM:SS; deltas in seconds. */
export function reportCsv(report: Report): string {
  const header = [
    'number',
    'title',
    'category',
    'runners',
    'status',
    'scheduled_start',
    'started',
    'ended',
    'estimate',
    'actual',
    'over_estimate_sec',
    'start_vs_schedule_sec',
    'changeover',
    'planned_changeover',
  ];
  const lines = report.rows.map((r) =>
    [
      r.number == null ? '' : String(r.number),
      text(r.title),
      text(r.category),
      text(r.runners.join(', ')),
      r.status,
      iso(r.scheduledStart),
      iso(r.startedAt),
      iso(r.endedAt),
      dur(r.estimateSec),
      dur(r.actualSec),
      signed(r.overSec),
      signed(r.startDeltaSec),
      dur(r.changeoverSec),
      dur(r.plannedChangeoverSec),
    ]
      .map(field)
      .join(','),
  );
  return [header.join(','), ...lines].join('\r\n') + '\r\n';
}
