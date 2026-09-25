// Reactive view model over a room: everything the UI shows is derived here
// from the server snapshot plus the ticking clock, using the shared maths.

import { getContext, setContext } from 'svelte';
import {
  checkInSummary,
  computeDelta,
  currentIndex,
  lineTitle,
  marathonPhase,
  marathonStats,
  project,
  projectedEnd,
  runTiming,
  scheduleStatus,
  upcomingIndexes,
} from '../../shared/derive.ts';
import type { MutatingAction } from '../../shared/protocol.ts';
import type { CheckIn, LogKind, RoomState, RunKey } from '../../shared/types.ts';
import { clock } from './clock.svelte.ts';
import type { RoomConnection } from './room.svelte.ts';
import { toasts } from './toasts.svelte.ts';

export type Tone = 'on' | 'ahead' | 'behind' | 'idle';

const EMPTY_STATE: RoomState = {
  rev: 0,
  currentKey: null,
  finishedAt: null,
  runs: {},
  log: [],
  message: null,
  announcement: null,
  twitchChannel: '',
  drift: { enabled: false, intervalMin: 5, thresholdSec: 10 },
  capture: null,
  captureBusy: false,
  undo: null,
  updatedAt: 0,
};

/** Builds the view model. A class expression closes over `room`, so the
 * `$derived` fields can use it directly. */
function createLive(room: RoomConnection) {
  return new (class {
    readonly room = room;

    lines = $derived(room.schedule?.lines ?? []);
    state = $derived(room.state ?? EMPTY_STATE);
    now = $derived(clock.now);

    curIndex = $derived(currentIndex(this.lines, this.state));
    current = $derived(this.lines[this.curIndex] ?? null);
    record = $derived(this.current ? this.state.runs[this.current.key] : undefined);
    timing = $derived(this.current ? runTiming(this.record, this.now) : null);
    elapsedSec = $derived(this.timing ? Math.floor(this.timing.elapsedMs / 1000) : 0);

    phase = $derived(marathonPhase(this.lines, this.state, this.now));
    delta = $derived(computeDelta(this.lines, this.state, this.now));
    status = $derived(this.delta == null ? null : scheduleStatus(this.delta));
    tone = $derived<Tone>(this.status ?? 'idle');

    projection = $derived(project(this.lines, this.state, this.now));
    projectedEnd = $derived(projectedEnd(this.projection));
    stats = $derived(marathonStats(this.lines, this.state, this.now));
    upcoming = $derived(upcomingIndexes(this.lines, this.state, 5));
    next = $derived(this.lines[this.upcoming[0] ?? -1] ?? null);
    checkIns = $derived(checkInSummary(this.lines, this.state.runs, this.upcoming));

    titleOf(key: RunKey | null | undefined): string {
      const line = this.lines.find((l) => l.key === key);
      return line ? lineTitle(line) : 'Unknown run';
    }
  })();
}

export type Live = ReturnType<typeof createLive>;

/** Operator actions, with the confirmation toasts each one deserves. */
export class Ops {
  readonly room: RoomConnection;
  readonly live: Live;

  constructor(room: RoomConnection, live: Live) {
    this.room = room;
    this.live = live;
  }

  private send(action: MutatingAction): boolean {
    return this.room.send(action);
  }

  private withUndo(title: string, sent: boolean): void {
    if (!sent) return;
    toasts.push({ kind: 'info', title, action: { label: 'Undo', run: () => this.undo() } });
  }

  toggleTimer(): void {
    if (this.live.phase === 'complete') {
      toasts.push({
        kind: 'info',
        title: 'The marathon is complete',
        body: 'Select a run to reopen it.',
      });
      return;
    }
    this.send({ action: this.live.timing?.phase === 'running' ? 'timer:stop' : 'timer:start' });
  }

  advance(): void {
    this.send({ action: 'run:advance' });
  }

  back(): void {
    this.send({ action: 'run:back' });
  }

  undo(): void {
    this.send({ action: 'undo' });
  }

  reset(): void {
    this.withUndo('Timer reset', this.send({ action: 'timer:reset' }));
  }

  setElapsed(seconds: number): void {
    this.send({ action: 'timer:set', seconds });
  }

  select(key: RunKey): void {
    this.withUndo(`Jumped to ${this.live.titleOf(key)}`, this.send({ action: 'run:select', key }));
  }

  skip(key?: RunKey): void {
    const title = this.live.titleOf(key ?? this.live.current?.key);
    this.withUndo(`Skipped ${title}`, this.send({ action: 'run:skip', key }));
  }

  unskip(key: RunKey): void {
    this.send({ action: 'run:unskip', key });
  }

  editTimes(key: RunKey, startedAt: number | null, endedAt: number | null): boolean {
    return this.send({ action: 'run:edit', key, startedAt, endedAt });
  }

  checkIn(key: RunKey, status: CheckIn | null): void {
    this.send({ action: 'runner:checkin', key, status });
  }

  refreshSchedule(): void {
    if (this.send({ action: 'schedule:refresh' })) {
      this.room.refreshing = true;
      toasts.push({ kind: 'info', title: 'Re-importing schedule…', timeout: 2500 });
    }
  }

  capture(): void {
    this.send({ action: 'capture:run' });
  }

  applyCapture(): void {
    this.withUndo('Applied the stream timer', this.send({ action: 'capture:apply' }));
  }

  configureDrift(enabled: boolean, intervalMin: number, thresholdSec: number): void {
    this.send({ action: 'drift:configure', enabled, intervalMin, thresholdSec });
  }

  setTwitch(channel: string): void {
    this.send({ action: 'twitch:set', channel });
  }

  addLog(text: string, kind: Exclude<LogKind, 'system' | 'warning'>): boolean {
    return this.send({ action: 'log:add', text, kind });
  }

  removeLog(id: number): void {
    this.send({ action: 'log:remove', id });
  }

  clearLog(): void {
    this.send({ action: 'log:clear' });
  }

  setMessage(text: string, color: string): boolean {
    return this.send({ action: 'message:set', text, color });
  }

  clearMessage(): void {
    this.send({ action: 'message:clear' });
  }

  setAnnouncement(text: string, color: string): boolean {
    return this.send({ action: 'announcement:set', text, color });
  }

  clearAnnouncement(): void {
    this.withUndo('Announcement cleared', this.send({ action: 'announcement:clear' }));
  }
}

const LIVE = Symbol('live');
const OPS = Symbol('ops');

export function provideLive(room: RoomConnection): { live: Live; ops: Ops } {
  const live = createLive(room);
  const ops = new Ops(room, live);
  setContext(LIVE, live);
  setContext(OPS, ops);
  return { live, ops };
}

export function getLive(): Live {
  return getContext<Live>(LIVE);
}

export function getOps(): Ops {
  return getContext<Ops>(OPS);
}
