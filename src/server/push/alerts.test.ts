import { describe, expect, it } from 'vitest';
import type { RoomState, ScheduleLine } from '../../shared/types.ts';
import { appendLog } from '../rooms/reducer.ts';
import { initialState } from '../rooms/state.ts';
import { AUTO_ACTOR } from '../tracking/service.ts';
import { changeAlerts, timedAlerts } from './alerts.ts';

const MIN = 60_000;
const T0 = Date.UTC(2026, 4, 24, 10, 0, 0);
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
const LINES = [mk('a', 0), mk('b', 1), mk('c', 2)];

function live(partial: Partial<RoomState> = {}): RoomState {
  return { ...initialState(), currentKey: 'a', runs: { a: { startedAt: T0 } }, ...partial };
}
const withLog = (s: RoomState, kind: 'warning' | 'system', text: string, actor: string | null) => {
  const next = structuredClone(s);
  appendLog(next, { kind, text, actor, at: T0 });
  return next;
};

describe('changeAlerts', () => {
  it('passes on new warnings from the log, oldest first, saying who caused them', () => {
    const prev = withLog(live(), 'warning', '⚠ old news', null);
    let next = withLog(prev, 'warning', '⏱ rb running late for Game b, about 10 min away', 'rb');
    next = withLog(next, 'warning', '⚠ rc missing for Game c', 'op');
    next = withLog(next, 'system', '↦ Advanced to Game b', 'op');
    expect(changeAlerts(prev, next, LINES)).toEqual([
      {
        title: 'Runner running late',
        body: 'rb running late for Game b, about 10 min away',
        tag: 'log-2',
        actor: 'rb',
      },
      { title: 'Heads up', body: 'rc missing for Game c', tag: 'log-3', actor: 'op' },
    ]);
  });

  it('says when auto-tracking moved on by itself', () => {
    const prev = live();
    const next = withLog(prev, 'system', '⇢ Followed the stream (twitch) to Game b', AUTO_ACTOR);
    expect(changeAlerts(prev, next, LINES)).toMatchObject([
      { title: 'Auto-tracking moved on', body: expect.stringContaining('Followed the stream') },
    ]);
  });

  it('raises a run change on stream once, not again as more signals agree', () => {
    const detection = {
      id: 'twitch-1',
      runKey: 'b',
      kind: 'advance' as const,
      currentKey: 'a',
      startedAt: null,
      firstAt: T0,
      signals: [],
    };
    const prev = live();
    const next = live({ detection });
    expect(changeAlerts(prev, next, LINES)).toMatchObject([
      { title: 'Run change on stream', body: expect.stringContaining('Game b is on stream') },
    ]);
    const more = live({ detection: { ...detection, id: 'vision-2', startedAt: T0 } });
    expect(changeAlerts(next, more, LINES)).toEqual([]);
  });
});

describe('timedAlerts', () => {
  it('nudges once when the live run is 15 minutes over its estimate', () => {
    const sent = new Set<string>();
    const s = live({ runs: { a: { startedAt: T0 }, b: { checkIn: 'ready' } } });
    expect(timedAlerts(s, LINES, T0 + 44 * MIN, sent)).toEqual([]);
    expect(timedAlerts(s, LINES, T0 + 45 * MIN, sent)).toEqual([
      {
        title: 'Run over estimate',
        body: 'Game a is 15m over its 30m estimate.',
        tag: 'overrun-a',
        actor: null,
      },
    ]);
    expect(timedAlerts(s, LINES, T0 + 50 * MIN, sent)).toEqual([]);
  });

  it('flags the next run when its runners haven’t checked in as it nears', () => {
    const sent = new Set<string>();
    // b is projected at 10:40; 15 minutes before is 10:25.
    expect(timedAlerts(live(), LINES, T0 + 24 * MIN, sent)).toEqual([]);
    expect(timedAlerts(live(), LINES, T0 + 26 * MIN, sent)).toMatchObject([
      { title: 'Runner not checked in', body: 'Game b (rb) starts in about 14m.' },
    ]);
    expect(timedAlerts(live(), LINES, T0 + 27 * MIN, sent)).toEqual([]);

    // Ready, or said they're on their way: nothing to say.
    const ready = live({ runs: { a: { startedAt: T0 }, b: { checkIn: 'ready' } } });
    expect(timedAlerts(ready, LINES, T0 + 26 * MIN, new Set())).toEqual([]);
    const late = { at: T0, etaAt: null, note: '', self: true };
    const onTheWay = live({ runs: { a: { startedAt: T0 }, b: { late } } });
    expect(timedAlerts(onTheWay, LINES, T0 + 26 * MIN, new Set())).toEqual([]);
  });

  it('is quiet once the marathon is over', () => {
    expect(timedAlerts(live({ finishedAt: T0 }), LINES, T0 + 60 * MIN, new Set())).toEqual([]);
  });
});
