import { describe, expect, it } from 'vitest';
import type { ScheduleLine } from '../../shared/types.ts';
import { initialState } from '../rooms/state.ts';
import { captureInterval, evaluateReading, matchRunKey } from './service.ts';
import { parseTimer } from './vision.ts';

const line = (key: string, game: string, setupBlock = false): ScheduleLine => ({
  key,
  game,
  category: '',
  console: '',
  type: 'SINGLE',
  runners: [],
  estimateSec: 1800,
  setupSec: 600,
  scheduledStart: null,
  setupBlock,
  setupBlockText: '',
});

const LINES = [
  line('a', 'Celeste'),
  line('b', 'Super Metroid'),
  line('s', '', true),
  line('c', 'Super Metroid'),
  line('d', 'The Legend of Zelda: Ocarina of Time'),
];

describe('matchRunKey', () => {
  it('matches loosely and prefers the current run', () => {
    expect(matchRunKey(LINES, 'a', 'celeste')).toBe('a');
    expect(matchRunKey(LINES, 'c', 'Super Metroid')).toBe('c');
    expect(matchRunKey(LINES, 'a', 'SUPER METROID')).toBe('b');
  });
  it('picks the next occurrence after the current run', () => {
    expect(matchRunKey(LINES, 'b', 'Super Metroid')).toBe('b');
    expect(matchRunKey(LINES, 's', 'Super Metroid')).toBe('c');
  });
  it('falls back to substring matches and gives up on nonsense', () => {
    expect(matchRunKey(LINES, null, 'Ocarina of Time')).toBe('d');
    expect(matchRunKey(LINES, null, 'Pong')).toBeNull();
    expect(matchRunKey(LINES, null, null)).toBeNull();
  });
});

describe('evaluateReading', () => {
  const at = 1_000_000;
  const reading = {
    elapsedSec: 130,
    estimateSec: 1800,
    game: 'Celeste',
    confidence: 'high' as const,
  };

  it('computes drift against our timer at capture time', () => {
    const r = evaluateReading(
      LINES,
      { currentKey: 'a', runs: { a: { startedAt: at - 120_000 } } },
      reading,
      at,
    );
    expect(r).toEqual({ runKey: 'a', ourElapsedSec: 120, driftSec: 10, currentKey: 'a' });
  });

  it('does not compute drift when the stream shows a different run', () => {
    const r = evaluateReading(
      LINES,
      { currentKey: 'b', runs: { b: { startedAt: at - 5_000 } } },
      reading,
      at,
    );
    expect(r.runKey).toBe('a');
    expect(r.driftSec).toBeNull();
  });

  it('handles runs that have not started', () => {
    const r = evaluateReading(LINES, { currentKey: 'a', runs: {} }, reading, at);
    expect(r.ourElapsedSec).toBeNull();
    expect(r.driftSec).toBeNull();
  });
});

describe('parseTimer', () => {
  it.each([
    ['1:02:03', 3723],
    ['00:41:05', 2465],
    ['41:05.3', 2465],
    ['TIMER 0:09:38', 578],
    [null, null],
    ['--:--', null],
    ['1:75:00', null],
  ])('%j → %j', (input, out) => expect(parseTimer(input)).toBe(out));
});

describe('captureInterval', () => {
  const MIN = 60_000;
  const T0 = 10_000_000_000;
  const timed = LINES.map((l, i) => ({ ...l, scheduledStart: T0 + i * 40 * MIN }));
  const st = (patch: Partial<ReturnType<typeof initialState>> = {}) => ({
    ...initialState(),
    ...patch,
  });
  const vision = { twitch: false, vision: true, autoApply: false };

  it('captures nothing with both features off', () => {
    expect(
      captureInterval(st({ currentKey: 'a', runs: { a: { startedAt: T0 } } }), timed, T0),
    ).toBe(null);
  });

  it('keeps the drift interval while a run is live', () => {
    const s = st({
      currentKey: 'a',
      runs: { a: { startedAt: T0 } },
      drift: { enabled: true, intervalMin: 5, thresholdSec: 10 },
    });
    expect(captureInterval(s, timed, T0 + MIN)).toBe(5 * MIN);
  });

  it('reads the stream every minute when a run change is due, and rarely otherwise', () => {
    const running = st({ currentKey: 'a', runs: { a: { startedAt: T0 } }, tracking: vision });
    // Estimate is 30 minutes: quiet early on, every minute from 10 minutes before its end.
    expect(captureInterval(running, timed, T0 + 5 * MIN)).toBe(10 * MIN);
    expect(captureInterval(running, timed, T0 + 21 * MIN)).toBe(MIN);
    // Between runs, watching for the next one to start.
    const setup = st({ currentKey: 'b', tracking: vision });
    expect(captureInterval(setup, timed, T0)).toBe(MIN);
  });

  it('waits for the marathon to be near its start, and stops when it ends or loses its live run', () => {
    expect(captureInterval(st({ tracking: vision }), timed, T0 - 60 * MIN)).toBeNull();
    expect(captureInterval(st({ tracking: vision }), timed, T0 - 5 * MIN)).toBe(MIN);
    expect(captureInterval(st({ tracking: vision, finishedAt: T0 }), timed, T0)).toBeNull();
    expect(captureInterval(st({ tracking: vision, currentKey: 'gone' }), timed, T0)).toBeNull();
  });
});
