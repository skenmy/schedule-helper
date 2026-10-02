import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { timeTicks } from './chart.ts';

const HOUR = 3_600_000;
let tz: string | undefined;
beforeAll(() => {
  tz = process.env.TZ;
  process.env.TZ = 'Europe/London';
});
afterAll(() => {
  process.env.TZ = tz;
});

const local = (t: number) => {
  const d = new Date(t);
  return `${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
};

describe('timeTicks', () => {
  it('puts ticks on round local times, about as many as asked for', () => {
    const a = new Date(2026, 4, 23, 17, 30).getTime();
    const ticks = timeTicks(a, a + 3 * HOUR, 6);
    expect(ticks.map(local)).toEqual([
      '23 17:30',
      '23 18:00',
      '23 18:30',
      '23 19:00',
      '23 19:30',
      '23 20:00',
      '23 20:30',
    ]);
  });

  it('stays on the hour across the clocks going back', () => {
    // British Summer Time ends at 02:00 on Sunday 25 October 2026.
    const a = new Date(2026, 9, 24, 18, 0).getTime();
    const ticks = timeTicks(a, a + 24 * HOUR, 5);
    expect(ticks.map(local)).toEqual(['24 18:00', '25 00:00', '25 06:00', '25 12:00']);
  });

  it('steps in whole days for a long event, and never crowds a narrow axis', () => {
    const a = new Date(2026, 4, 18, 9, 0).getTime();
    const week = timeTicks(a, a + 7 * 24 * HOUR, 3);
    expect(week.length).toBeLessThanOrEqual(5);
    expect(week.every((t) => new Date(t).getHours() === 0)).toBe(true);
    expect(timeTicks(a, a, 4)).toEqual([]);
  });
});
