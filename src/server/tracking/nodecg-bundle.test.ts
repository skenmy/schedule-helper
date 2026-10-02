// The NodeCG bundle (integrations/nodecg-schedule-helper) against a real
// server: a stand-in NodeCG with speedcontrol's two replicants.

import fs from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { RoomRef, Schedule } from '../../shared/types.ts';
import { startServer, type RunningServer } from '../server.ts';
import { demoSchedule } from '../sources/demo.ts';

const require = createRequire(import.meta.url);
const bundle = require('../../../integrations/nodecg-schedule-helper/extension/index.js') as {
  buildReport: (run: unknown, timer: unknown, now?: number) => unknown;
  start: (
    nodecg: unknown,
    opts?: { heartbeatMs?: number },
  ) => { send: (force: boolean) => void; stop: () => void } | null;
};

const REF: RoomRef = { source: 'oengus', event: 'bundled', slug: 'main' };
const schedule = (): Schedule => ({ ...demoSchedule(), ref: REF });

class Replicant {
  value: unknown;
  private listeners: (() => void)[] = [];
  constructor(value: unknown) {
    this.value = value;
  }
  on(_event: 'change', fn: () => void) {
    this.listeners.push(fn);
  }
  set(value: unknown) {
    this.value = value;
    for (const fn of this.listeners) fn();
  }
}

let server: RunningServer;
let dataDir: string;
beforeEach(async () => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sh-bundle-'));
  server = await startServer({
    port: 0,
    dataDir,
    services: { fetchSchedule: async () => schedule() },
    streams: null,
  });
});
afterEach(async () => {
  await server.close();
  fs.rmSync(dataDir, { recursive: true, force: true });
});

describe('the NodeCG bundle', () => {
  it('builds reports from speedcontrol’s replicants', () => {
    const run = {
      externalID: 1234,
      game: 'Celeste',
      category: 'Any%',
      teams: [{ players: [{ name: 'cerulean' }, { name: 'second' }] }],
    };
    const timer = { state: 'running', milliseconds: 60_000, timestamp: 1_000 };
    expect(bundle.buildReport(run, timer, 3_000)).toEqual({
      via: 'bundle',
      run: {
        externalID: '1234',
        game: 'Celeste',
        category: 'Any%',
        players: ['cerulean', 'second'],
      },
      timer: { state: 'running', elapsedMs: 62_000 },
    });
    expect(bundle.buildReport(undefined, undefined)).toEqual({
      via: 'bundle',
      run: null,
      timer: null,
    });
  });

  it('reports to the schedule, which then suggests following it', async () => {
    const base = `http://localhost:${server.port}`;
    const { token } = (await (
      await fetch(`${base}/api/rooms/oengus/bundled/main/source-token`)
    ).json()) as {
      token: string;
    };
    const room = await server.registry.open(REF);
    room.dispatch({ action: 'timer:start' }, 'op');
    const next = room.schedule.lines.find((l, i) => i > 0 && !l.setupBlock)!;

    const replicants = {
      runDataActiveRun: new Replicant({ game: room.schedule.lines[0]!.game, teams: [] }),
      timer: new Replicant({ state: 'running', milliseconds: 5_000, timestamp: Date.now() }),
    };
    const warnings: string[] = [];
    const nodecg = {
      bundleConfig: { url: base, room: 'oengus/bundled/main', token },
      log: { info: () => {}, warn: (m: string) => warnings.push(m) },
      Replicant: (name: keyof typeof replicants) => replicants[name],
    };
    const handle = bundle.start(nodecg, { heartbeatMs: 60_000 })!;
    try {
      // Speedcontrol resets the timer, then moves on to the next run for setup.
      replicants.timer.set({ state: 'stopped', milliseconds: 0, timestamp: Date.now() });
      replicants.runDataActiveRun.set({ game: next.game, teams: [] });
      await expect.poll(() => room.state.nodecg?.runKey, { timeout: 3000 }).toBe(next.key);
      expect(room.state.nodecg).toMatchObject({ via: 'bundle', timer: 'stopped' });
      expect(room.state.detection).toMatchObject({ runKey: next.key, kind: 'advance' });
      expect(warnings).toEqual([]);
    } finally {
      handle.stop();
    }
  });

  it('says what’s wrong instead of failing silently', async () => {
    const warnings: string[] = [];
    const log = { info: () => {}, warn: (m: string) => warnings.push(m) };
    expect(
      bundle.start({ bundleConfig: {}, log, Replicant: () => new Replicant(null) }),
    ).toBeNull();
    expect(warnings[0]).toContain('set url, room and token');

    const handle = bundle.start(
      {
        bundleConfig: {
          url: `http://localhost:${server.port}`,
          room: 'oengus/bundled/main',
          token: 'x'.repeat(22),
        },
        log,
        Replicant: () => new Replicant({ game: 'Celeste', teams: [] }),
      },
      { heartbeatMs: 60_000 },
    )!;
    handle.send(true);
    await expect.poll(() => warnings.length, { timeout: 3000 }).toBe(2);
    expect(warnings[1]).toContain('403');
    handle.stop();
  });
});
