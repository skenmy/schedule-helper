import { describe, expect, it } from 'vitest';
import { ackValue, buildReport, isNews, parseBridgeParams } from './nodecg-report.ts';

const TOKEN = 'AbCdEfGhIjKlMnOpQrSt_-';

describe('buildReport', () => {
  it('reads speedcontrol’s run and timer, measuring elapsed time as a duration', () => {
    const run = {
      externalID: 1234,
      game: 'Celeste',
      category: '',
      teams: [{ players: [{ name: 'a' }, {}] }],
    };
    expect(
      buildReport(run, { state: 'running', milliseconds: 60_000, timestamp: 1_000 }, 1_400),
    ).toEqual({
      via: 'bridge',
      run: { externalID: '1234', game: 'Celeste', category: null, players: ['a'] },
      timer: { state: 'running', elapsedMs: 60_400 },
    });
  });

  it('never adds more than a tick’s worth for the clocks disagreeing, nor a pause', () => {
    const timer = { state: 'running' as const, milliseconds: 5_000, timestamp: 1_000 };
    expect(buildReport(null, timer, 60_000).timer?.elapsedMs).toBe(6_000);
    expect(buildReport(null, timer, 500).timer?.elapsedMs).toBe(5_000);
    expect(buildReport(null, { ...timer, state: 'paused' }, 60_000).timer?.elapsedMs).toBe(5_000);
    expect(buildReport(undefined, undefined)).toEqual({ via: 'bridge', run: null, timer: null });
  });
});

describe('ackValue', () => {
  it('reads both NodeCG 1 and NodeCG 2 acknowledgements', () => {
    expect(ackValue([{ value: 1 }])).toBe(1); // NodeCG 1: (data)
    expect(ackValue([null, { value: 2 }])).toBe(2); // NodeCG 2: (error, data)
    expect(ackValue([new Error('no'), { value: 3 }])).toBeUndefined();
  });
});

describe('parseBridgeParams', () => {
  it('takes the room and NodeCG from the query, the token and login key from the fragment', () => {
    expect(
      parseBridgeParams(
        '?room=oengus/uksg/main&nodecg=http://10.0.0.5:9090/',
        `#t=${TOKEN}&key=k1`,
      ),
    ).toEqual({
      room: { source: 'oengus', event: 'uksg', slug: 'main' },
      nodecg: 'http://10.0.0.5:9090',
      token: TOKEN,
      key: 'k1',
    });
  });

  it('refuses anything that isn’t a room and an http(s) NodeCG', () => {
    const ok = `#t=${TOKEN}`;
    for (const search of [
      '?room=../../api/x',
      '?room=oengus/uksg/main/extra',
      '?room=oengus/uk sg/main',
      '?room=oengus/uksg/main&nodecg=javascript:alert(1)',
      '?room=oengus/uksg/main&nodecg=data:text/javascript,1',
      '?room=oengus/uksg/main&nodecg=not a url',
    ]) {
      expect(typeof parseBridgeParams(search, ok), search).toBe('string');
    }
    expect(typeof parseBridgeParams('?room=oengus/uksg/main', '#t=short')).toBe('string');
  });
});

describe('isNews', () => {
  const ns = 'nodecg-speedcontrol';
  const timer = (...operations: unknown[]) => ({ name: 'timer', namespace: ns, operations });

  it('reports a change of run, or of the timer’s state, at once', () => {
    expect(isNews({ name: 'runDataActiveRun', namespace: ns, operations: [] })).toBe(true);
    expect(
      isNews(timer({ path: '/', method: 'update', args: { prop: 'state', newValue: 'running' } })),
    ).toBe(true);
    expect(isNews(timer({ path: '/', method: 'overwrite', args: { newValue: {} } }))).toBe(true);
  });

  it('leaves the timer ticking over, other bundles and junk to the poll', () => {
    const tick = { path: '/', method: 'update', args: { prop: 'milliseconds', newValue: 1_100 } };
    expect(isNews(timer(tick, { ...tick, args: { prop: 'time', newValue: '00:00:01' } }))).toBe(
      false,
    );
    expect(isNews({ name: 'runDataActiveRun', namespace: 'another-bundle', operations: [] })).toBe(
      false,
    );
    expect(isNews({ name: 'timer', namespace: ns })).toBe(false);
    expect(isNews(null)).toBe(false);
    expect(isNews('replicant')).toBe(false);
  });
});
