// Room state defaults and limits.

import type { DriftSettings, RoomState } from '../../shared/types.ts';

export const LOG_LIMIT = 1_000;
export const UNDO_LIMIT = 30;

export const DEFAULT_DRIFT: DriftSettings = { enabled: false, intervalMin: 5, thresholdSec: 10 };

export function initialState(twitchChannel = ''): RoomState {
  return {
    rev: 0,
    currentKey: null,
    finishedAt: null,
    runs: {},
    log: [],
    logSeq: 0,
    message: null,
    announcement: null,
    twitchChannel,
    drift: { ...DEFAULT_DRIFT },
    capture: null,
    captureBusy: false,
    undo: null,
    updatedAt: Date.now(),
  };
}

/** The slice of state an undo restores. Log, capture and settings are not undoable. */
export const UNDO_FIELDS = [
  'currentKey',
  'finishedAt',
  'runs',
  'message',
  'announcement',
  'twitchChannel',
] as const satisfies readonly (keyof RoomState)[];

export type UndoSnapshot = Pick<RoomState, (typeof UNDO_FIELDS)[number]>;

export interface UndoEntry {
  id: number;
  summary: string;
  actor: string | null;
  at: number;
  snapshot: UndoSnapshot;
}

export function takeSnapshot(state: RoomState): UndoSnapshot {
  return structuredClone({
    currentKey: state.currentKey,
    finishedAt: state.finishedAt,
    runs: state.runs,
    message: state.message,
    announcement: state.announcement,
    twitchChannel: state.twitchChannel,
  });
}
