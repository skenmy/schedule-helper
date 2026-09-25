import { describe, expect, it } from 'vitest';
import type { RoomState, ScheduleLine } from '../../shared/types.ts';
import { reduce, type ReduceContext, type ReducibleAction } from './reducer.ts';
import { initialState } from './state.ts';

const T0 = Date.UTC(2026, 4, 24, 10, 0, 0);
const MIN = 60_000;

const mk = (key: string, i: number, extra: Partial<ScheduleLine> = {}): ScheduleLine => ({
  key,
  game: `Game ${key}`,
  category: '',
  console: '',
  type: 'SINGLE',
  runners: [`r${key}`],
  estimateSec: 1800,
  setupSec: 600,
  scheduledStart: T0 + i * 40 * MIN,
  setupBlock: false,
  setupBlockText: '',
  ...extra,
});

const LINES = [mk('a', 0), mk('s', 1, { setupBlock: true, runners: [] }), mk('b', 2), mk('c', 3)];

function run(state: RoomState, action: ReducibleAction, now = T0, actor: string | null = 'op') {
  const ctx: ReduceContext = { lines: LINES, now, actor };
  const res = reduce(state, action, ctx);
  if (!res.ok) throw new Error(`${res.code}: ${res.message}`);
  return res;
}

function fail(state: RoomState, action: ReducibleAction, now = T0) {
  const res = reduce(state, action, { lines: LINES, now, actor: 'op' });
  if (res.ok) throw new Error('expected rejection');
  return res;
}

describe('timer', () => {
  it('start selects the first run and records the start', () => {
    const { state, undo } = run(initialState(), { action: 'timer:start' });
    expect(state.currentKey).toBe('a');
    expect(state.runs.a).toEqual({ startedAt: T0 });
    expect(state.log[0]).toMatchObject({ text: '▶ Started Game a', actor: 'op', kind: 'system' });
    expect(undo).toBe('▶ Started Game a');
  });

  it('does not mutate its input', () => {
    const s0 = initialState();
    const frozen = structuredClone(s0);
    run(s0, { action: 'timer:start' });
    expect(s0).toEqual(frozen);
  });

  it('stop then start resumes without losing elapsed time', () => {
    let s = run(initialState(), { action: 'timer:start' }).state;
    s = run(s, { action: 'timer:stop' }, T0 + 10 * MIN).state;
    expect(s.runs.a).toEqual({ startedAt: T0, endedAt: T0 + 10 * MIN });
    s = run(s, { action: 'timer:start' }, T0 + 15 * MIN).state;
    expect(s.runs.a).toEqual({ startedAt: T0 + 5 * MIN });
  });

  it('treats repeated start/stop as no-ops', () => {
    const s = run(initialState(), { action: 'timer:start' }).state;
    expect(run(s, { action: 'timer:start' }, T0 + MIN).changed).toBe(false);
    expect(run(initialState(), { action: 'timer:stop' }).changed).toBe(false);
  });

  it('set starts a run in setup at the given elapsed', () => {
    const { state } = run(initialState(), { action: 'timer:set', seconds: 120 }, T0 + 5 * MIN);
    expect(state.runs.a).toEqual({ startedAt: T0 + 3 * MIN });
  });

  it('set adjusts a finished run without restarting it', () => {
    let s = run(initialState(), { action: 'timer:start' }).state;
    s = run(s, { action: 'timer:stop' }, T0 + 30 * MIN).state;
    s = run(s, { action: 'timer:set', seconds: 25 * 60 }, T0 + 31 * MIN).state;
    expect(s.runs.a).toEqual({ startedAt: T0 + 5 * MIN, endedAt: T0 + 30 * MIN });
  });

  it('reset clears the record', () => {
    let s = run(initialState(), { action: 'timer:start' }).state;
    s = run(s, { action: 'timer:reset' }).state;
    expect(s.runs.a).toEqual({});
  });
});

describe('navigation', () => {
  it('advance ends the running run and skips setup blocks', () => {
    let s = run(initialState(), { action: 'timer:start' }).state;
    s = run(s, { action: 'run:advance' }, T0 + 31 * MIN).state;
    expect(s.currentKey).toBe('b');
    expect(s.runs.a?.endedAt).toBe(T0 + 31 * MIN);
  });

  it('advancing past the last run finishes the marathon', () => {
    let s = run(initialState(), { action: 'run:select', key: 'c' }).state;
    s = run(s, { action: 'timer:start' }).state;
    s = run(s, { action: 'run:advance' }, T0 + MIN).state;
    expect(s.currentKey).toBeNull();
    expect(s.finishedAt).toBe(T0 + MIN);
    expect(fail(s, { action: 'timer:start' }).code).toBe('conflict');
    s = run(s, { action: 'run:back' }).state;
    expect(s.currentKey).toBe('c');
    expect(s.finishedAt).toBeNull();
  });

  it('back walks to the previous playable run', () => {
    let s = run(initialState(), { action: 'run:select', key: 'b' }).state;
    s = run(s, { action: 'run:back' }).state;
    expect(s.currentKey).toBe('a');
    expect(fail(s, { action: 'run:back' }).code).toBe('conflict');
  });

  it('select closes a running timer on the run it leaves', () => {
    let s = run(initialState(), { action: 'timer:start' }).state;
    s = run(s, { action: 'run:select', key: 'c' }, T0 + 2 * MIN).state;
    expect(s.runs.a?.endedAt).toBe(T0 + 2 * MIN);
    expect(s.currentKey).toBe('c');
  });

  it('rejects unknown runs and setup blocks', () => {
    expect(fail(initialState(), { action: 'run:select', key: 'nope' }).code).toBe('invalid');
    expect(fail(initialState(), { action: 'run:select', key: 's' }).code).toBe('invalid');
  });
});

describe('skip', () => {
  it('skipping the current run moves on', () => {
    let s = run(initialState(), { action: 'run:select', key: 'a' }).state;
    s = run(s, { action: 'run:skip' }).state;
    expect(s.runs.a?.skipped).toBe(true);
    expect(s.currentKey).toBe('b');
  });

  it('skipping a future run leaves the current one alone', () => {
    let s = run(initialState(), { action: 'run:select', key: 'a' }).state;
    s = run(s, { action: 'run:skip', key: 'c' }).state;
    expect(s.currentKey).toBe('a');
    expect(s.runs.c?.skipped).toBe(true);
    s = run(s, { action: 'run:select', key: 'b' }).state;
    s = run(s, { action: 'run:advance' }).state;
    expect(s.finishedAt).not.toBeNull();
  });

  it('unskip restores a run', () => {
    let s = run(initialState(), { action: 'run:skip', key: 'c' }).state;
    s = run(s, { action: 'run:unskip', key: 'c' }).state;
    expect(s.runs.c?.skipped).toBeUndefined();
  });
});

describe('edits and check-ins', () => {
  it('edits absolute times across days', () => {
    const start = T0 + 26 * 60 * MIN;
    const { state } = run(
      initialState(),
      { action: 'run:edit', key: 'b', startedAt: start, endedAt: start + 40 * MIN },
      T0 + 30 * 60 * MIN,
    );
    expect(state.runs.b).toEqual({ startedAt: start, endedAt: start + 40 * MIN });
  });

  it('validates edits', () => {
    const s = initialState();
    expect(fail(s, { action: 'run:edit', key: 'b', startedAt: null, endedAt: T0 }).code).toBe(
      'invalid',
    );
    expect(fail(s, { action: 'run:edit', key: 'b', startedAt: T0, endedAt: T0 - 1 }).code).toBe(
      'invalid',
    );
    expect(fail(s, { action: 'run:edit', key: 'b', startedAt: T0, endedAt: null }).code).toBe(
      'invalid',
    );
  });

  it('check-in is idempotent and logged', () => {
    let s = run(initialState(), { action: 'runner:checkin', key: 'b', status: 'ready' }).state;
    expect(s.runs.b?.checkIn).toBe('ready');
    expect(s.log[0]?.text).toBe('✓ rb checked in for Game b');
    expect(run(s, { action: 'runner:checkin', key: 'b', status: 'ready' }).changed).toBe(false);
    s = run(s, { action: 'runner:checkin', key: 'b', status: null }).state;
    expect(s.runs.b?.checkIn).toBeUndefined();
  });
});

describe('broadcasts and settings', () => {
  it('normalises twitch channels and rejects junk', () => {
    const { state } = run(initialState(), {
      action: 'twitch:set',
      channel: 'https://twitch.tv/UKSG',
    });
    expect(state.twitchChannel).toBe('uksg');
    expect(fail(state, { action: 'twitch:set', channel: 'not a channel' }).code).toBe('invalid');
  });

  it('sets and clears the message board with attribution', () => {
    let s = run(initialState(), {
      action: 'message:set',
      text: 'Please hold',
      color: '#fbbf24',
    }).state;
    expect(s.message).toEqual({ text: 'Please hold', color: '#fbbf24', by: 'op', at: T0 });
    s = run(s, { action: 'message:clear' }).state;
    expect(s.message).toBeNull();
  });

  it('log entries are not undoable', () => {
    const res = run(initialState(), { action: 'log:add', text: 'Mic check', kind: 'tech' });
    expect(res.undo).toBeNull();
    expect(res.state.log[0]).toMatchObject({ text: 'Mic check', kind: 'tech', id: 1 });
  });
});

describe('capture:apply', () => {
  it('selects the detected run and back-dates its start', () => {
    const s = initialState();
    s.currentKey = 'a';
    s.capture = {
      id: 'x',
      at: T0 + 10 * MIN,
      auto: false,
      by: 'op',
      channel: 'uksg',
      error: null,
      elapsedSec: 300,
      estimateSec: 1800,
      game: 'Game b',
      runKey: 'b',
      confidence: 'high',
      ourElapsedSec: null,
      driftSec: null,
      currentKey: 'a',
    };
    const { state } = run(s, { action: 'capture:apply' }, T0 + 10 * MIN + 4000);
    expect(state.currentKey).toBe('b');
    expect(state.runs.b).toEqual({ startedAt: T0 + 5 * MIN });
    expect(state.capture?.driftSec).toBe(0);
  });

  it('refuses without a reading', () => {
    expect(fail(initialState(), { action: 'capture:apply' }).code).toBe('conflict');
  });
});
