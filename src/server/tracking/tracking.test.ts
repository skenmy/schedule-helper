import { describe, expect, it } from 'vitest';
import type { RoomState, ScheduleLine } from '../../shared/types.ts';
import { reduce } from '../rooms/reducer.ts';
import { initialState } from '../rooms/state.ts';
import { corroborated, observe, reconcile, SETTLED_MS, STALE_MS, type Signal } from './detect.ts';
import { matchStream } from './match.ts';

const T0 = Date.UTC(2026, 4, 24, 10, 0, 0);
const MIN = 60_000;

const mk = (key: string, game: string, runners: string[], extra: Partial<ScheduleLine> = {}) =>
  ({
    key,
    game,
    category: 'Any%',
    console: 'PC',
    type: 'SINGLE',
    runners,
    estimateSec: 1800,
    setupSec: 600,
    scheduledStart: null,
    setupBlock: false,
    setupBlockText: '',
    ...extra,
  }) satisfies ScheduleLine;

const LINES: ScheduleLine[] = [
  mk('z', 'The Legend of Zelda: Ocarina of Time', ['epona']),
  mk('s1', 'Spyro the Dragon', ['gnasty']),
  mk('i', '', [], { setupBlock: true, setupBlockText: 'Interview' }),
  mk('s2', 'Spyro the Dragon', ['ripto']),
  mk('h', 'Hades', ['zagreus']),
  mk('t', 'Tetris Effect', ['zone']),
  mk('far', 'Celeste', ['madeline']),
];

/** Zelda live and running since T0. */
function live(): RoomState {
  const s = initialState();
  s.currentKey = 'z';
  s.runs.z = { startedAt: T0 };
  return s;
}

const twitch = (runKey: string, at = T0 + 30 * MIN): Signal => ({
  runKey,
  source: 'twitch',
  at,
  detail: 'category',
  startedAt: null,
});
const vision = (runKey: string, at: number, startedAt: number): Signal => ({
  runKey,
  source: 'vision',
  at,
  detail: 'timer',
  startedAt,
});

/** The stream PC's timer on a run: running since `startedAt`, or finished at `endedAt`. */
const nodecg = (
  runKey: string,
  at: number,
  t: { startedAt?: number; endedAt?: number },
): Signal => ({
  runKey,
  source: 'nodecg',
  at,
  detail: 'speedcontrol',
  startedAt: t.startedAt ?? null,
  endedAt: t.endedAt ?? null,
});

describe('matchStream', () => {
  const s = live();

  it('matches the category to an upcoming run', () => {
    expect(matchStream(LINES, s, { game: 'Spyro the Dragon', title: null })?.key).toBe('s1');
    expect(matchStream(LINES, s, { game: 'Hades', title: 'UKSG Winter' })?.key).toBe('h');
  });

  it('prefers the live run when the category is still its game', () => {
    const m = matchStream(LINES, s, {
      game: 'The Legend of Zelda: Ocarina of Time',
      title: 'UKSG | OoT by epona',
    });
    expect(m?.key).toBe('z');
  });

  it('separates back-to-back runs of one game by the runner in the title', () => {
    const s2 = live();
    s2.currentKey = 's1';
    const m = matchStream(LINES, s2, {
      game: 'Spyro the Dragon',
      title: 'UKSG Winter – Spyro 120% by ripto | !schedule',
    });
    expect(m?.key).toBe('s2');
    expect(m?.detail).toContain('runner ripto');
  });

  it('reads the title when the category is generic', () => {
    expect(
      matchStream(LINES, s, { game: 'Retro', title: 'Next up: Hades Fresh File by zagreus' })?.key,
    ).toBe('h');
  });

  it('only looks a few runs ahead and never back', () => {
    expect(matchStream(LINES, s, { game: 'Celeste', title: 'madeline' })).toBeNull();
    const later = live();
    later.currentKey = 'h';
    expect(matchStream(LINES, later, { game: 'Spyro the Dragon', title: null })).toBeNull();
  });

  it('matches runner names as whole words only', () => {
    expect(matchStream(LINES, s, { game: 'Retro', title: 'Ozone layer chat' })).toBeNull();
  });

  it('stops when the live run is no longer on the schedule', () => {
    const gone = live();
    gone.currentKey = 'removed';
    expect(matchStream(LINES, gone, { game: 'Spyro the Dragon', title: null })).toBeNull();
  });
});

describe('observe', () => {
  it('raises an advance for a later run and merges agreeing signals', () => {
    const s = live();
    expect(observe(s, LINES, twitch('s1'))).toBe(true);
    expect(s.detection).toMatchObject({ runKey: 's1', kind: 'advance', currentKey: 'z' });
    expect(corroborated(s.detection!, T0 + 31 * MIN)).toBe(false);

    const start = T0 + 31 * MIN;
    observe(s, LINES, vision('s1', T0 + 32 * MIN, start));
    expect(s.detection?.signals).toHaveLength(2);
    expect(s.detection?.startedAt).toBe(start);
    expect(corroborated(s.detection!, T0 + 32 * MIN)).toBe(true);
  });

  it('raises a start when the live run is running on stream but not here', () => {
    const s = initialState();
    s.currentKey = 's1';
    const start = T0 + 5 * MIN;
    observe(s, LINES, vision('s1', T0 + 6 * MIN, start));
    expect(s.detection).toMatchObject({ kind: 'start', runKey: 's1', startedAt: start });
    // One frame read once isn't enough to act alone; two readings a minute apart are.
    expect(corroborated(s.detection!, T0 + 6 * MIN)).toBe(false);
    observe(s, LINES, vision('s1', T0 + 7 * MIN, start + 3_000));
    expect(corroborated(s.detection!, T0 + 7 * MIN)).toBe(true);
  });

  it('does not count readings that imply different starts', () => {
    const s = initialState();
    s.currentKey = 's1';
    observe(s, LINES, vision('s1', T0 + 6 * MIN, T0 + 5 * MIN));
    observe(s, LINES, vision('s1', T0 + 7 * MIN, T0 + 2 * MIN));
    expect(corroborated(s.detection!, T0 + 7 * MIN)).toBe(false);
  });

  it('lets a source take back what it said, without overruling another source', () => {
    const s = live();
    observe(s, LINES, twitch('s1'));
    observe(s, LINES, vision('s1', T0 + 31 * MIN, T0 + 30 * MIN));
    // The stream still shows Zelda's final moments: vision withdraws, Twitch stands.
    observe(s, LINES, vision('z', T0 + 32 * MIN, T0));
    expect(s.detection?.signals.map((x) => x.source)).toEqual(['twitch']);
    observe(s, LINES, twitch('z', T0 + 33 * MIN));
    expect(s.detection).toBeNull();
  });

  it('ignores setup blocks, unknown runs and runs out of reach', () => {
    const s = live();
    expect(observe(s, LINES, twitch('i'))).toBe(false);
    expect(observe(s, LINES, twitch('nope'))).toBe(false);
    expect(observe(s, LINES, twitch('far'))).toBe(false);
    expect(s.detection).toBeNull();
  });
});

describe('finish', () => {
  const ctx = (now: number) => ({ lines: LINES, now, actor: 'op' });
  const end = T0 + 38 * MIN;

  it('raises a finish when the live run’s timer finishes on stream while ours runs', () => {
    const s = live();
    expect(observe(s, LINES, nodecg('z', T0 + 39 * MIN, { endedAt: end }))).toBe(true);
    expect(s.detection).toMatchObject({
      kind: 'finish',
      runKey: 'z',
      currentKey: 'z',
      endedAt: end,
    });
    // The next heartbeat says the same; the finish time stays put.
    observe(s, LINES, nodecg('z', T0 + 39 * MIN + 15_000, { endedAt: end }));
    expect(s.detection?.endedAt).toBe(end);
    expect(corroborated(s.detection!, T0 + 39 * MIN + 15_000)).toBe(true);
  });

  it('only when ours is running, and only for a finish after ours started', () => {
    const notStarted = initialState();
    notStarted.currentKey = 'z';
    expect(observe(notStarted, LINES, nodecg('z', T0, { endedAt: T0 }))).toBe(false);
    const stopped = live();
    stopped.runs.z!.endedAt = T0 + 37 * MIN;
    expect(observe(stopped, LINES, nodecg('z', T0 + 39 * MIN, { endedAt: end }))).toBe(false);
    expect(observe(live(), LINES, nodecg('z', T0 + MIN, { endedAt: T0 - MIN }))).toBe(false);
    // A finished timer on a later run is an advance, with no start or finish attached.
    const ahead = live();
    observe(ahead, LINES, nodecg('s1', T0 + 39 * MIN, { endedAt: end }));
    expect(ahead.detection).toMatchObject({ kind: 'advance', runKey: 's1', startedAt: null });
    expect(ahead.detection).not.toHaveProperty('endedAt');
  });

  it('is withdrawn when the stream’s timer runs again, and dropped once ours stops', () => {
    const s = live();
    observe(s, LINES, nodecg('z', T0 + 39 * MIN, { endedAt: end }));
    observe(s, LINES, nodecg('z', T0 + 39 * MIN + 5_000, { startedAt: T0 }));
    expect(s.detection).toBeNull();

    observe(s, LINES, nodecg('z', T0 + 40 * MIN, { endedAt: end }));
    expect(reconcile(s, LINES, T0 + 40 * MIN)).toBe(false);
    s.runs.z!.endedAt = T0 + 40 * MIN;
    expect(reconcile(s, LINES, T0 + 40 * MIN)).toBe(true);
    expect(s.detection).toBeNull();
  });

  it('accepting stops our timer when the stream’s did, and an undo sticks', () => {
    const s = live();
    observe(s, LINES, nodecg('z', T0 + 39 * MIN, { endedAt: end }));
    const res = reduce(s, { action: 'detection:accept', id: s.detection!.id }, ctx(T0 + 40 * MIN));
    if (!res.ok) throw new Error(res.message);
    expect(res.state.currentKey).toBe('z');
    expect(res.state.runs.z).toEqual({ startedAt: T0, endedAt: end });
    expect(res.state.log[0]?.text).toBe(
      '■ Finished The Legend of Zelda: Ocarina of Time in 00:38:00, when the stream (nodecg) did',
    );
    expect(res.undo).toContain('Finished');
    // Undo restores the running timer, not `settled`: the same finish isn't raised again.
    const undone = { ...res.state, runs: s.runs };
    expect(observe(undone, LINES, nodecg('z', T0 + 41 * MIN, { endedAt: end }))).toBe(false);
  });

  it('gives way to the stream moving on, which keeps the finish as the live run’s end', () => {
    const s = live();
    observe(s, LINES, nodecg('z', T0 + 39 * MIN, { endedAt: end }));
    // Twitch moves on to Spyro: that's what to suggest now, and it remembers the finish…
    expect(observe(s, LINES, twitch('s1', T0 + 41 * MIN))).toBe(true);
    expect(s.detection).toMatchObject({ kind: 'advance', runKey: 's1', endedAt: end });
    // …and speedcontrol still saying "finished" doesn't flip it back (or ring again).
    expect(observe(s, LINES, nodecg('z', T0 + 41 * MIN + 15_000, { endedAt: end }))).toBe(false);
    expect(s.detection?.kind).toBe('advance');
    // A finish doesn't say what's next, so it doesn't count towards acting alone.
    expect(s.detection?.signals.map((x) => x.source)).toEqual(['twitch']);

    const res = reduce(s, { action: 'detection:accept', id: s.detection!.id }, ctx(T0 + 42 * MIN));
    if (!res.ok) throw new Error(res.message);
    expect(res.state.currentKey).toBe('s1');
    expect(res.state.runs.z?.endedAt).toBe(end);
  });

  it('times a pending advance by a finish that comes after it, until the timer runs again', () => {
    const s = live();
    observe(s, LINES, twitch('s1', T0 + 37 * MIN));
    expect(observe(s, LINES, nodecg('z', T0 + 39 * MIN, { endedAt: end }))).toBe(true);
    expect(s.detection).toMatchObject({ kind: 'advance', runKey: 's1', endedAt: end });
    expect(s.detection?.signals).toHaveLength(1);
    // Speedcontrol un-finishes: the finish time goes, the advance stays.
    observe(s, LINES, nodecg('z', T0 + 39 * MIN + 5_000, { startedAt: T0 }));
    expect(s.detection).toMatchObject({ kind: 'advance', runKey: 's1', endedAt: null });

    // Switching NodeCG off takes its finish time with it.
    observe(s, LINES, nodecg('z', T0 + 40 * MIN, { endedAt: end }));
    const off = reduce(
      s,
      {
        action: 'tracking:configure',
        twitch: true,
        vision: false,
        autoApply: false,
        nodecg: false,
      },
      ctx(T0 + 40 * MIN),
    );
    if (!off.ok) throw new Error(off.message);
    expect(off.state.detection).toMatchObject({ kind: 'advance', endedAt: null });
  });

  it('never stops our timer in the future or before it started, and refuses once stopped', () => {
    const s = live();
    observe(s, LINES, nodecg('z', T0 + 39 * MIN, { endedAt: T0 + 50 * MIN }));
    const res = reduce(s, { action: 'detection:accept', id: s.detection!.id }, ctx(T0 + 40 * MIN));
    if (!res.ok) throw new Error(res.message);
    expect(res.state.runs.z?.endedAt).toBe(T0 + 40 * MIN);

    const stopped = structuredClone(s);
    stopped.runs.z!.endedAt = T0 + 39 * MIN;
    const refused = reduce(stopped, { action: 'detection:accept', id: s.detection!.id }, ctx(T0));
    expect(refused).toMatchObject({ ok: false, code: 'conflict' });
  });
});

describe('reconcile', () => {
  it('drops a detection once the live run changes or it goes stale', () => {
    const s = live();
    observe(s, LINES, twitch('s1'));
    expect(reconcile(s, LINES, T0 + 31 * MIN)).toBe(false);
    s.currentKey = 's1';
    expect(reconcile(s, LINES, T0 + 31 * MIN)).toBe(true);
    expect(s.detection).toBeNull();

    const t = live();
    observe(t, LINES, twitch('s1'));
    expect(reconcile(t, LINES, T0 + 30 * MIN + STALE_MS + 1)).toBe(true);
  });
});

describe('reducer: detections', () => {
  const ctx = (now: number) => ({ lines: LINES, now, actor: 'op' });

  it('accepting an advance moves on, ends the old run when the stream did, and back-dates the start', () => {
    const s = live();
    observe(s, LINES, twitch('s1', T0 + 30 * MIN));
    observe(s, LINES, vision('s1', T0 + 36 * MIN, T0 + 35 * MIN));
    const res = reduce(s, { action: 'detection:accept', id: s.detection!.id }, ctx(T0 + 37 * MIN));
    if (!res.ok) throw new Error(res.message);
    expect(res.state.currentKey).toBe('s1');
    expect(res.state.runs.z?.endedAt).toBe(T0 + 30 * MIN);
    expect(res.state.runs.s1?.startedAt).toBe(T0 + 35 * MIN);
    expect(res.state.detection).toBeNull();
    expect(res.undo).toContain('Followed the stream (twitch + vision)');
  });

  it('refuses a detection that is out of date', () => {
    const s = live();
    observe(s, LINES, twitch('s1'));
    const stale = reduce(s, { action: 'detection:accept', id: 'other' }, ctx(T0 + 31 * MIN));
    expect(stale.ok).toBe(false);
    const moved = structuredClone(s);
    moved.currentKey = 'h';
    const res = reduce(moved, { action: 'detection:accept', id: s.detection!.id }, ctx(T0));
    expect(res.ok).toBe(false);
  });

  it('dismissing clears it without an undo entry', () => {
    const s = live();
    observe(s, LINES, twitch('s1'));
    const res = reduce(s, { action: 'detection:dismiss', id: s.detection!.id }, ctx(T0));
    if (!res.ok) throw new Error(res.message);
    expect(res.state.detection).toBeNull();
    expect(res.undo).toBeNull();
    expect(res.state.log[0]?.text).toContain('Dismissed: Spyro the Dragon is on stream');
  });

  it('configures tracking, and turning every source off clears any detection', () => {
    const s = live();
    const on = reduce(
      s,
      { action: 'tracking:configure', twitch: true, vision: false, autoApply: false },
      ctx(T0),
    );
    if (!on.ok) throw new Error(on.message);
    expect(on.state.tracking.twitch).toBe(true);
    observe(on.state, LINES, twitch('s1'));
    const off = reduce(
      on.state,
      {
        action: 'tracking:configure',
        twitch: false,
        vision: false,
        autoApply: false,
        nodecg: false,
      },
      ctx(T0),
    );
    if (!off.ok) throw new Error(off.message);
    expect(off.state.detection).toBeNull();
    expect(off.undo).toBeNull();
  });

  it('withdraws what a source said when it is switched off, keeping the rest', () => {
    const s = live();
    s.tracking = { twitch: true, vision: true, autoApply: false, nodecg: true };
    observe(s, LINES, twitch('s1'));
    observe(s, LINES, vision('s1', T0 + 31 * MIN, T0 + 30 * MIN));
    expect(s.detection?.signals).toHaveLength(2);
    const res = reduce(
      s,
      { action: 'tracking:configure', twitch: false, vision: true, autoApply: false, nodecg: true },
      ctx(T0 + 32 * MIN),
    );
    if (!res.ok) throw new Error(res.message);
    expect(res.state.detection?.signals.map((x) => x.source)).toEqual(['vision']);
    // NodeCG isn't named until a stream PC has reported in.
    expect(res.state.log[0]?.text).toBe('Auto-tracking on (stream reading): asks first');
  });
});

describe('review fixes', () => {
  const ctx = (now: number) => ({ lines: LINES, now, actor: 'op' });

  it('does not raise a dismissed suggestion again while the live run is the same', () => {
    const s = live();
    observe(s, LINES, twitch('s1'));
    const res = reduce(s, { action: 'detection:dismiss', id: s.detection!.id }, ctx(T0 + 31 * MIN));
    if (!res.ok) throw new Error(res.message);
    const after = res.state;
    // The stream keeps showing it, from any source: nothing comes back.
    expect(observe(after, LINES, vision('s1', T0 + 32 * MIN, T0 + 31 * MIN))).toBe(false);
    expect(observe(after, LINES, twitch('s1', T0 + 33 * MIN))).toBe(false);
    expect(after.detection).toBeNull();
    // Half an hour on, it may be raised again.
    expect(observe(after, LINES, twitch('s1', T0 + 31 * MIN + SETTLED_MS))).toBe(true);
  });

  it('does not re-raise an accepted suggestion after it is undone', () => {
    const s = live();
    observe(s, LINES, twitch('s1'));
    const res = reduce(s, { action: 'detection:accept', id: s.detection!.id }, ctx(T0 + 31 * MIN));
    if (!res.ok) throw new Error(res.message);
    // Undo restores the live run (UNDO_FIELDS) but not `settled`.
    const undone = { ...res.state, currentKey: 'z', runs: s.runs };
    expect(observe(undone, LINES, twitch('s1', T0 + 32 * MIN))).toBe(false);
    // On the run it pointed at the record stays (an undo comes back to it), but it only
    // keeps down the same suggestion: a different one gets through.
    const moved = { ...res.state };
    expect(reconcile(moved, LINES, T0 + 32 * MIN)).toBe(false);
    expect(moved.settled).toMatchObject({ runKey: 's1', currentKey: 'z' });
    expect(observe(moved, LINES, vision('s1', T0 + 33 * MIN, T0 + 32 * MIN))).toBe(true);
    expect(moved.detection?.kind).toBe('start');
    // Somewhere else entirely, it lapses.
    const elsewhere = { ...res.state, currentKey: 's2' };
    expect(reconcile(elsewhere, LINES, T0 + 32 * MIN)).toBe(true);
    expect(elsewhere.settled).toBeNull();
  });

  it('treats a timer implying a start before the live run as a misread', () => {
    const s = live();
    // "Spyro is on stream at 2:10:00" while Zelda only started 30 minutes ago.
    observe(s, LINES, vision('s1', T0 + 30 * MIN, T0 - 100 * MIN));
    expect(s.detection).toMatchObject({ runKey: 's1', startedAt: null });
    // And a start for the live run before the previous run ended is no start at all.
    const t = initialState();
    t.currentKey = 's1';
    t.runs.z = { startedAt: T0, endedAt: T0 + 30 * MIN };
    expect(observe(t, LINES, vision('s1', T0 + 41 * MIN, T0 + 20 * MIN))).toBe(false);
  });

  it('keeps the earliest sighting and a fresh id once a start time appears', () => {
    const s = live();
    observe(s, LINES, twitch('s1', T0 + 35 * MIN));
    const first = s.detection!.id;
    // A frame taken earlier lands later.
    observe(s, LINES, vision('s1', T0 + 33 * MIN, T0 + 32 * MIN));
    expect(s.detection?.firstAt).toBe(T0 + 33 * MIN);
    expect(s.detection?.id).not.toBe(first);
  });

  it('ends the old run no later than the new one started, and refuses unreachable targets', () => {
    const s = live();
    // Vision first: the frame is a minute after Spyro's timer started.
    observe(s, LINES, vision('s1', T0 + 36 * MIN, T0 + 35 * MIN));
    const res = reduce(s, { action: 'detection:accept', id: s.detection!.id }, ctx(T0 + 37 * MIN));
    if (!res.ok) throw new Error(res.message);
    expect(res.state.runs.z?.endedAt).toBe(T0 + 35 * MIN);
    expect(res.state.runs.s1?.startedAt).toBe(T0 + 35 * MIN);

    const skipped = live();
    observe(skipped, LINES, twitch('s1'));
    skipped.runs.s1 = { skipped: true };
    const refused = reduce(
      skipped,
      { action: 'detection:accept', id: skipped.detection!.id },
      ctx(T0),
    );
    expect(refused.ok).toBe(false);
    expect(reconcile(skipped, LINES, T0)).toBe(true);
  });

  it('lets an exact category outrank a title naming the next run', () => {
    const m = matchStream(LINES, live(), {
      game: 'The Legend of Zelda: Ocarina of Time',
      title: 'UKSG | Up next: Spyro the Dragon with gnasty',
    });
    expect(m?.key).toBe('z');
  });
});
