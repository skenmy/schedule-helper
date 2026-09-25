import { describe, expect, it } from 'vitest';
import { mapHoraroItems, stripMarkdown } from './horaro.ts';
import { keyer } from './http.ts';
import { mapOengusLines } from './oengus.ts';

describe('mapOengusLines', () => {
  it('sorts by position and normalises fields', () => {
    const lines = mapOengusLines([
      {
        id: 2,
        position: 2,
        game: 'B',
        category: null,
        console: 'PC',
        type: 'race',
        runners: [
          { runnerName: 'x', profile: { displayName: 'Xavier', username: 'x' } },
          { runnerName: 'guest' },
        ],
        estimate: 'PT1H',
        setupTime: 'PT10M',
        date: '2026-05-24T10:00:00Z',
        setupBlock: false,
        setupBlockText: null,
      },
      {
        id: 1,
        position: 1,
        game: null,
        category: null,
        console: null,
        type: null,
        runners: [],
        estimate: 'PT15M',
        setupTime: null,
        date: null,
        setupBlock: true,
        setupBlockText: 'Opening',
      },
    ]);
    expect(lines.map((l) => l.key)).toEqual(['o1', 'o2']);
    expect(lines[1]).toMatchObject({
      type: 'RACE',
      runners: ['Xavier', 'guest'],
      estimateSec: 3600,
      setupSec: 600,
      scheduledStart: Date.parse('2026-05-24T10:00:00Z'),
    });
    expect(lines[0]).toMatchObject({
      setupBlock: true,
      setupBlockText: 'Opening',
      scheduledStart: null,
    });
  });
});

describe('Horaro mapping', () => {
  it('strips markdown links', () => {
    expect(stripMarkdown('[Celeste](https://x) *Any%*')).toBe('Celeste Any%');
  });

  it('finds columns by name and splits runners', () => {
    const lines = mapHoraroItems(
      ['Runner(s)', 'Game', 'Platform', 'Category'],
      [
        {
          length: 'PT30M',
          scheduled: null,
          scheduled_t: 1_790_000_000,
          data: ['[a](x), b vs c', 'Celeste', 'PC', 'Any%'],
          options: null,
        },
        {
          length: 'PT20M',
          scheduled: '2026-05-24T10:00:00Z',
          scheduled_t: null,
          data: [null, 'Celeste', null, 'Any%'],
          options: { setup: 'PT5M' },
        },
      ],
      'PT10M',
    );
    expect(lines[0]).toMatchObject({
      game: 'Celeste',
      console: 'PC',
      category: 'Any%',
      runners: ['a', 'b', 'c'],
      setupSec: 600,
      scheduledStart: 1_790_000_000_000,
    });
    expect(lines[1]).toMatchObject({ runners: [], setupSec: 300 });
    expect(lines[0]!.key).not.toBe(lines[1]!.key);
  });
});

describe('keyer', () => {
  it('is stable and disambiguates repeats', () => {
    const k1 = keyer('h');
    const k2 = keyer('h');
    expect(k1(['Celeste', 'Any%'])).toBe(k2(['Celeste', 'Any%']));
    expect(k1(['Celeste', 'Any%'])).toMatch(/-1$/);
  });
});

describe('demo seeding', () => {
  it('produces a live marathon with history and a current run', async () => {
    const { demoSchedule, seedDemoState } = await import('./demo.ts');
    const { initialState } = await import('../rooms/state.ts');
    const { computeDelta, runTiming } = await import('../../shared/derive.ts');
    const schedule = demoSchedule();
    const now = Date.now();
    const s = seedDemoState(initialState(), schedule.lines, now);
    expect(s.currentKey).not.toBeNull();
    const finished = Object.values(s.runs).filter((r) => r.endedAt != null);
    expect(finished.length).toBeGreaterThan(0);
    const phase = runTiming(s.runs[s.currentKey!], now).phase;
    expect(['running', 'setup']).toContain(phase);
    // A few minutes behind at most — believable, not hours.
    expect(Math.abs(computeDelta(schedule.lines, s, now)!)).toBeLessThan(60 * 60);
  });
});
