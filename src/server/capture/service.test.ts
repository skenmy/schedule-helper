import { describe, expect, it } from 'vitest';
import type { ScheduleLine } from '../../shared/types.ts';
import { evaluateReading, matchRunKey } from './service.ts';
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
