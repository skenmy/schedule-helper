// The event report: planned against actual, per run and overall. Pure, so the
// report page, the CSV/JSON exports and the tests all read the same numbers.
// Built from derive.ts — no schedule maths of its own beyond adding up.

import {
  changeovers,
  currentIndex,
  eventPace,
  lineTitle,
  median,
  project,
  projectedEnd,
  scheduledEndOf,
  scheduledStartOf,
} from './derive.ts';
import { fmtHMS } from './time.ts';
import type { RoomRef, RoomState, Schedule } from './types.ts';

/** `unplayed`: never started, and the marathon has moved past it (or finished). */
export type ReportStatus = 'done' | 'live' | 'skipped' | 'unplayed' | 'upcoming' | 'interlude';

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
  /**
   * End of this run to the start of the run played next, and what the schedule
   * allowed for it (null when the next run played wasn't the next scheduled).
   */
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
  runs: { total: number; done: number; skipped: number; unplayed: number };
  /** Finished runs: time taken against their estimates. */
  runTimeSec: number;
  runEstimateSec: number;
  /** Median changeover minus plan, over changeovers with a plan that weren't breaks. */
  changeoverDeltaSec: number | null;
  /** How many changeovers that median is over. */
  changeoversMeasured: number;
  rows: ReportRow[];
  /** Up to five each, biggest first. */
  overruns: ReportRow[];
  underruns: ReportRow[];
}

const sec = (ms: number) => Math.round(ms / 1000);

export function buildReport(schedule: Schedule, state: RoomState, now: number): Report {
  const { lines } = schedule;
  const cur = currentIndex(lines, state);
  const complete = state.finishedAt != null;
  const after = new Map(changeovers(lines, state).map((c) => [c.from, c]));
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
            : started == null && (complete || (cur >= 0 && i < cur))
              ? 'unplayed'
              : 'upcoming';
    const actualSec = status === 'done' ? sec(ended! - started!) : null;
    const change = status === 'done' || status === 'live' ? after.get(line.key) : undefined;
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
      changeoverSec: change ? sec(change.actualSec * 1000) : null,
      plannedChangeoverSec: change?.plannedSec ?? null,
    };
  });

  const done = rows.filter((r) => r.status === 'done');
  const starts = rows.map((r) => r.startedAt).filter((t): t is number => t != null);
  const lastEnd = rows.map((r) => r.endedAt).filter((t): t is number => t != null);
  const byOver = done.filter((r) => r.overSec != null).sort((a, b) => b.overSec! - a.overSec!);
  const pace = complete ? null : eventPace(lines, state);
  const deltas = [...after.values()]
    .filter((c) => c.plannedSec != null && !c.isBreak)
    .map((c) => c.actualSec - c.plannedSec!);

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
      unplayed: rows.filter((r) => r.status === 'unplayed').length,
    },
    runTimeSec: done.reduce((n, r) => n + r.actualSec!, 0),
    runEstimateSec: done.reduce((n, r) => n + r.estimateSec, 0),
    changeoverDeltaSec: deltas.length ? Math.round(median(deltas)) : null,
    changeoversMeasured: deltas.length,
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
