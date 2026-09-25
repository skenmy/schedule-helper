import { describe, expect, it, vi } from 'vitest';
import { demoSchedule } from '../sources/demo.ts';
import { Room } from '../rooms/room.ts';
import { initialState } from '../rooms/state.ts';
import { runCapture } from './service.ts';
import type { VisionReading } from './vision.ts';

let finishReading: (r: VisionReading) => void = () => {};

vi.mock('./frame.ts', () => ({
  grabFrame: async () => ({ data: Buffer.from('jpeg'), mediaType: 'image/jpeg', at: Date.now() }),
}));
vi.mock('./vision.ts', () => ({
  readFrame: () => new Promise<VisionReading>((resolve) => (finishReading = resolve)),
}));

function room(): Room {
  const schedule = demoSchedule();
  return new Room({
    ref: schedule.ref,
    schedule,
    state: initialState('uksg'),
    store: null,
    services: { fetchSchedule: async () => schedule, capture: runCapture },
  });
}

describe('runCapture', () => {
  it('stores the reading', async () => {
    const r = room();
    const done = runCapture(r, { auto: false, actor: 'op' });
    await vi.waitFor(() => expect(r.state.captureBusy).toBe(true));
    finishReading({ elapsedSec: 90, estimateSec: null, game: 'Celeste', confidence: 'high' });
    await done;
    expect(r.state.captureBusy).toBe(false);
    expect(r.state.capture).toMatchObject({ elapsedSec: 90, runKey: 'd0' });
  });

  it('discards a reading that finishes after the room was reset', async () => {
    const r = room();
    const done = runCapture(r, { auto: false, actor: 'op' });
    await vi.waitFor(() => expect(r.state.captureBusy).toBe(true));
    expect(r.dispatch({ action: 'room:reset' }, 'op')).toEqual({ ok: true, undo: null });
    expect(r.state.captureBusy).toBe(true);
    finishReading({ elapsedSec: 90, estimateSec: null, game: 'Celeste', confidence: 'high' });
    await done;
    expect(r.state.captureBusy).toBe(false);
    expect(r.state.capture).toBeNull();
    expect(r.frames.size).toBe(0);
  });
});
