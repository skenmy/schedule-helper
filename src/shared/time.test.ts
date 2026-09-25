import { describe, expect, it } from 'vitest';
import {
  fmtDelta,
  fmtDuration,
  fmtHM,
  fmtHMS,
  fmtOffsetShort,
  parseDurationInput,
  parseIsoDuration,
} from './time.ts';

describe('parseIsoDuration', () => {
  it.each([
    ['PT1H30M', 5400],
    ['PT45M', 2700],
    ['PT0S', 0],
    ['P1DT2H', 93_600],
    ['PT1.5S', 2],
    ['PT10M30S', 630],
  ])('%s → %d', (iso, sec) => expect(parseIsoDuration(iso)).toBe(sec));

  it('returns 0 for junk', () => {
    expect(parseIsoDuration('1:30:00')).toBe(0);
    expect(parseIsoDuration(null)).toBe(0);
    expect(parseIsoDuration('')).toBe(0);
  });
});

describe('formatters', () => {
  it('fmtHMS pads and clamps', () => {
    expect(fmtHMS(3723)).toBe('01:02:03');
    expect(fmtHMS(-5)).toBe('00:00:00');
    expect(fmtHMS(100 * 3600)).toBe('100:00:00');
  });
  it('fmtHM rounds to minutes', () => {
    expect(fmtHM(5400)).toBe('1:30');
    expect(fmtHM(89)).toBe('0:01');
  });
  it('fmtDelta signs with a true minus', () => {
    expect(fmtDelta(760)).toBe('+12:40');
    expect(fmtDelta(-3723)).toBe('−1:02:03');
    expect(fmtDelta(0)).toBe('+00:00');
  });
  it('fmtDuration', () => {
    expect(fmtDuration(28 * 3600 + 8 * 60)).toBe('28h 08m');
    expect(fmtDuration(45 * 60)).toBe('45m');
  });
  it('fmtOffsetShort', () => {
    expect(fmtOffsetShort(13 * 60)).toBe('+13m');
    expect(fmtOffsetShort(-(2 * 3600 + 5 * 60))).toBe('−2h 05m');
    expect(fmtOffsetShort(20)).toBe('on time');
  });
});

describe('parseDurationInput', () => {
  it.each([
    ['1:02:03', 3723],
    ['62:03', 3723],
    ['45', 45],
    [' 0:00:10 ', 10],
  ])('%s → %d', (input, sec) => expect(parseDurationInput(input)).toBe(sec));
  it.each(['', '1:60', '1:2:3:4', 'abc', '-5', '1:99:00'])('rejects %j', (input) =>
    expect(parseDurationInput(input)).toBeNull(),
  );
});
