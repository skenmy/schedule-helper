// Pure room-state transitions. `reduce` never mutates its input and performs
// no I/O, so every rule here is unit-testable in isolation.

import {
  currentIndex,
  firstPlayableIndex,
  indexOfKey,
  lineTitle,
  nextPlayableIndex,
  prevPlayableIndex,
  runTiming,
} from '../../shared/derive.ts';
import type { MutatingAction } from '../../shared/protocol.ts';
import { normalizeTwitchChannel } from '../../shared/sources.ts';
import { fmtClock, fmtHM, fmtHMS } from '../../shared/time.ts';
import type { LogKind, RoomState, RunKey, ScheduleLine } from '../../shared/types.ts';
import { LOG_LIMIT } from './state.ts';

/** Actions handled by the reducer; the rest need I/O and live on Room. */
export type ReducibleAction = Exclude<
  MutatingAction,
  { action: 'capture:run' | 'schedule:refresh' | 'room:reset' | 'undo' }
>;

export interface ReduceContext {
  lines: readonly ScheduleLine[];
  now: number;
  /** Display name of the operator, or null when auth is disabled. */
  actor: string | null;
}

export type ReduceResult =
  | { ok: true; state: RoomState; changed: boolean; undo: string | null }
  | { ok: false; code: 'invalid' | 'conflict'; message: string };

const UNDOABLE: ReadonlySet<ReducibleAction['action']> = new Set([
  'timer:start',
  'timer:stop',
  'timer:reset',
  'timer:set',
  'run:select',
  'run:advance',
  'run:back',
  'run:skip',
  'run:unskip',
  'run:edit',
  'runner:checkin',
  'twitch:set',
  'message:set',
  'message:clear',
  'announcement:set',
  'announcement:clear',
  'capture:apply',
]);

const LIVE_RUN_REMOVED =
  'The live run is no longer on the schedule. Select the run that’s live now.';

class Rejection extends Error {
  readonly code: 'invalid' | 'conflict';
  constructor(code: 'invalid' | 'conflict', message: string) {
    super(message);
    this.code = code;
  }
}
const invalid = (message: string) => new Rejection('invalid', message);
const conflict = (message: string) => new Rejection('conflict', message);

/** Signals "nothing to do" without it being an error. */
class NoChange extends Error {}

export function appendLog(
  state: RoomState,
  entry: { kind: LogKind; text: string; runKey?: RunKey | null; actor: string | null; at: number },
): void {
  // Ids never repeat, even after the log is cleared (clients track "seen" by id).
  const id = Math.max(state.logSeq ?? 0, state.log[0]?.id ?? 0) + 1;
  state.logSeq = id;
  state.log.unshift({ id, runKey: null, ...entry });
  if (state.log.length > LOG_LIMIT) state.log.length = LOG_LIMIT;
}

export function reduce(
  state: RoomState,
  action: ReducibleAction,
  ctx: ReduceContext,
): ReduceResult {
  const draft = structuredClone(state);
  try {
    const summary = apply(draft, action, ctx);
    return {
      ok: true,
      state: draft,
      changed: true,
      undo: summary && UNDOABLE.has(action.action) ? summary : null,
    };
  } catch (err) {
    if (err instanceof NoChange) return { ok: true, state, changed: false, undo: null };
    if (err instanceof Rejection) return { ok: false, code: err.code, message: err.message };
    throw err;
  }
}

/** Mutates `s`; returns the audit summary (also the undo label). */
function apply(s: RoomState, action: ReducibleAction, ctx: ReduceContext): string | null {
  const { lines, now, actor } = ctx;
  const log = (text: string, kind: LogKind = 'system', runKey: RunKey | null = s.currentKey) => {
    appendLog(s, { kind, text, runKey, actor, at: now });
    return text;
  };
  const lineFor = (key: RunKey): { line: ScheduleLine; index: number } => {
    const index = indexOfKey(lines, key);
    const line = lines[index];
    if (!line) throw invalid('That run is no longer on the schedule.');
    return { line, index };
  };
  const rec = (key: RunKey) => (s.runs[key] ??= {});

  /** The current line, selecting the first run if the marathon hasn't started. */
  const ensureCurrent = (): { line: ScheduleLine; index: number } => {
    if (s.finishedAt != null)
      throw conflict('The marathon is complete. Select a run to reopen it.');
    if (s.currentKey == null) {
      const first = firstPlayableIndex(lines, s.runs);
      if (first < 0) throw conflict('There are no runs on this schedule.');
      s.currentKey = lines[first]!.key;
      return { line: lines[first]!, index: first };
    }
    const index = currentIndex(lines, s);
    // Never guess: restarting some other run would corrupt its timings.
    if (index < 0) throw conflict(LIVE_RUN_REMOVED);
    return { line: lines[index]!, index };
  };

  /** Only the current run may have a running timer: close it before moving on. */
  const leaveCurrent = () => {
    const key = s.currentKey;
    if (!key) return;
    const r = s.runs[key];
    if (r?.startedAt != null && r.endedAt == null) r.endedAt = now;
  };

  const moveTo = (index: number) => {
    leaveCurrent();
    s.currentKey = lines[index]!.key;
    s.finishedAt = null;
  };

  const finishMarathon = () => {
    leaveCurrent();
    s.currentKey = null;
    s.finishedAt = now;
  };

  switch (action.action) {
    case 'timer:start': {
      const { line } = ensureCurrent();
      const r = rec(line.key);
      const t = runTiming(r, now);
      if (t.phase === 'running') throw new NoChange();
      if (t.phase === 'finished') {
        r.startedAt = now - t.elapsedMs;
        delete r.endedAt;
        return log(`▶ Resumed ${lineTitle(line)} at ${fmtHMS(t.elapsedMs / 1000)}`);
      }
      r.startedAt = now;
      return log(`▶ Started ${lineTitle(line)}`);
    }

    case 'timer:stop': {
      const index = currentIndex(lines, s);
      const line = lines[index];
      const r = line && s.runs[line.key];
      if (!line || !r || runTiming(r, now).phase !== 'running') throw new NoChange();
      r.endedAt = now;
      const elapsed = (now - r.startedAt!) / 1000;
      return log(
        `■ Finished ${lineTitle(line)} in ${fmtHMS(elapsed)} (est. ${fmtHM(line.estimateSec)})`,
      );
    }

    case 'timer:reset': {
      const line = lines[currentIndex(lines, s)];
      const r = line && s.runs[line.key];
      if (!line || !r || r.startedAt == null) throw new NoChange();
      delete r.startedAt;
      delete r.endedAt;
      return log(`↺ Reset timer for ${lineTitle(line)}`);
    }

    case 'timer:set': {
      const { line } = ensureCurrent();
      const r = rec(line.key);
      const ms = action.seconds * 1000;
      const t = runTiming(r, now);
      if (t.phase === 'finished') r.startedAt = t.endedAt! - ms;
      else r.startedAt = now - ms;
      return log(`⌖ Set ${lineTitle(line)} timer to ${fmtHMS(action.seconds)}`);
    }

    case 'run:select': {
      const { line, index } = lineFor(action.key);
      if (line.setupBlock) throw invalid('Setup blocks can’t be the current run.');
      if (s.currentKey === line.key && s.finishedAt == null) throw new NoChange();
      moveTo(index);
      return log(`⤳ Jumped to ${lineTitle(line)}`);
    }

    case 'run:advance': {
      if (s.currentKey == null && s.finishedAt == null) {
        // Nothing live yet: "next" is the first run, not the one after it.
        const first = firstPlayableIndex(lines, s.runs);
        if (first < 0) throw conflict('There are no runs on this schedule.');
        moveTo(first);
        return log(`↦ Advanced to ${lineTitle(lines[first]!)}`);
      }
      const { line, index } = ensureCurrent();
      const next = nextPlayableIndex(lines, s.runs, index);
      if (next < 0) {
        finishMarathon();
        return log(`🏁 Finished the marathon after ${lineTitle(line)}`, 'system', line.key);
      }
      moveTo(next);
      return log(`↦ Advanced to ${lineTitle(lines[next]!)}`);
    }

    case 'run:back': {
      const from = s.finishedAt != null ? lines.length : currentIndex(lines, s);
      const prev = prevPlayableIndex(lines, s.runs, from < 0 ? 0 : from);
      if (prev < 0) throw conflict('Already at the first run.');
      moveTo(prev);
      return log(`↤ Back to ${lineTitle(lines[prev]!)}`);
    }

    case 'run:skip': {
      const key = action.key ?? s.currentKey;
      if (!key) throw conflict('No run is selected.');
      const { line, index } = lineFor(key);
      if (line.setupBlock) throw invalid('Setup blocks can’t be skipped.');
      if (s.runs[key]?.skipped) throw new NoChange();
      const isCurrent = s.currentKey === key;
      if (isCurrent) leaveCurrent();
      rec(key).skipped = true;
      const summary = log(`⏭ Skipped ${lineTitle(line)}`, 'system', key);
      if (isCurrent) {
        const next = nextPlayableIndex(lines, s.runs, index);
        if (next < 0) finishMarathon();
        else s.currentKey = lines[next]!.key;
      }
      return summary;
    }

    case 'run:unskip': {
      const { line } = lineFor(action.key);
      const r = s.runs[line.key];
      if (!r?.skipped) throw new NoChange();
      delete r.skipped;
      return log(`↩ Restored ${lineTitle(line)}`, 'system', line.key);
    }

    case 'run:edit': {
      const { line } = lineFor(action.key);
      if (line.setupBlock) throw invalid('Setup blocks have no timings.');
      const { startedAt, endedAt } = action;
      if (endedAt != null && startedAt == null)
        throw invalid('Set a start time before an end time.');
      if (startedAt != null && endedAt != null && endedAt < startedAt) {
        throw invalid('The end time is before the start time.');
      }
      if (startedAt != null && startedAt > now + 60_000)
        throw invalid('The start time is in the future.');
      if (startedAt != null && endedAt == null && s.currentKey !== line.key) {
        throw invalid('Only the live run can be left without an end time.');
      }
      const r = rec(line.key);
      if (startedAt == null) delete r.startedAt;
      else r.startedAt = startedAt;
      if (endedAt == null) delete r.endedAt;
      else r.endedAt = endedAt;
      const span =
        startedAt == null
          ? 'cleared'
          : `${fmtClock(startedAt)} → ${endedAt == null ? 'running' : fmtClock(endedAt)}`;
      return log(`✎ Edited times for ${lineTitle(line)} (${span})`, 'system', line.key);
    }

    case 'runner:checkin': {
      const { line } = lineFor(action.key);
      if (line.setupBlock) throw invalid('Setup blocks have no runners.');
      const r = rec(line.key);
      if ((r.checkIn ?? null) === action.status) throw new NoChange();
      if (action.status) r.checkIn = action.status;
      else delete r.checkIn;
      const who = line.runners.join(', ') || lineTitle(line);
      const text =
        action.status === 'ready'
          ? `✓ ${who} checked in for ${lineTitle(line)}`
          : action.status === 'missing'
            ? `⚠ ${who} missing for ${lineTitle(line)}`
            : `Cleared check-in for ${lineTitle(line)}`;
      return log(text, action.status === 'missing' ? 'warning' : 'runner', line.key);
    }

    case 'log:add':
      log(action.text, action.kind);
      return null;

    case 'log:remove': {
      const before = s.log.length;
      s.log = s.log.filter((e) => e.id !== action.id);
      if (s.log.length === before) throw new NoChange();
      return null;
    }

    case 'log:clear':
      if (s.log.length === 0) throw new NoChange();
      s.log = [];
      log('Cleared the event log');
      return null;

    case 'twitch:set': {
      const channel = normalizeTwitchChannel(action.channel);
      if (action.channel && !channel) throw invalid('That doesn’t look like a Twitch channel.');
      if (channel === s.twitchChannel) throw new NoChange();
      s.twitchChannel = channel;
      return log(channel ? `Twitch channel set to ${channel}` : 'Cleared the Twitch channel');
    }

    case 'message:set':
      s.message = { text: action.text, color: action.color, by: actor, at: now };
      return log(`Message board: “${action.text}”`);

    case 'message:clear':
      if (!s.message) throw new NoChange();
      s.message = null;
      return log('Cleared the message board');

    case 'announcement:set':
      s.announcement = { text: action.text, color: action.color, by: actor, at: now };
      return log(`📣 Announcement: “${action.text}”`);

    case 'announcement:clear':
      if (!s.announcement) throw new NoChange();
      s.announcement = null;
      return log('Cleared the announcement');

    case 'drift:configure': {
      const { enabled, intervalMin, thresholdSec } = action;
      const d = s.drift;
      if (
        d.enabled === enabled &&
        d.intervalMin === intervalMin &&
        d.thresholdSec === thresholdSec
      ) {
        throw new NoChange();
      }
      s.drift = { enabled, intervalMin, thresholdSec };
      log(
        enabled
          ? `Auto drift check on: every ${intervalMin} min, warn beyond ±${thresholdSec}s`
          : 'Auto drift check off',
      );
      return null;
    }

    case 'capture:apply': {
      const c = s.capture;
      if (!c || c.error || c.elapsedSec == null)
        throw conflict('There’s no stream reading to apply.');
      // A reading taken before someone changed the live run would rewind the marathon.
      if (c.currentKey !== s.currentKey) {
        throw conflict('The live run has changed since that capture. Capture again.');
      }
      const key = c.runKey ?? c.currentKey ?? s.currentKey;
      if (!key) throw conflict('No run to apply the reading to.');
      const { line, index } = lineFor(key);
      if (line.setupBlock) throw invalid('Setup blocks have no timer.');
      if (s.currentKey !== key || s.finishedAt != null) moveTo(index);
      const r = rec(key);
      r.startedAt = c.at - c.elapsedSec * 1000;
      delete r.endedAt;
      delete r.skipped;
      s.capture = { ...c, currentKey: key, ourElapsedSec: c.elapsedSec, driftSec: 0 };
      return log(`⤓ Applied stream timer ${fmtHMS(c.elapsedSec)} to ${lineTitle(line)}`);
    }
  }
}
