import { describe, expect, it } from 'vitest';
import { ClientActionSchema, type ServerMessage } from '../../shared/protocol.ts';
import type { RunNote, Schedule, ScheduleLine } from '../../shared/types.ts';
import { emptyNotes, reduceNotes } from './notes.ts';
import { Room, type RoomClient } from './room.ts';
import { initialState } from './state.ts';

const LINES = ['a', 'b'].map((key): ScheduleLine => ({
  key,
  game: `Game ${key}`,
  category: 'Any%',
  console: 'PC',
  type: 'SINGLE',
  runners: ['someone'],
  estimateSec: 600,
  setupSec: 60,
  scheduledStart: null,
  setupBlock: false,
  setupBlockText: '',
}));
const ctx = { lines: LINES, now: 1_000, actor: 'Paul' };

describe('reduceNotes', () => {
  it('adds, edits and removes notes, with ids that never repeat', () => {
    const add = reduceNotes(
      emptyNotes(),
      { action: 'note:add', key: 'a', kind: 'tech', text: 'Hi' },
      ctx,
    );
    if (!add.ok) throw new Error(add.message);
    expect(add.notes.list).toEqual([
      { id: 1, runKey: 'a', kind: 'tech', text: 'Hi', actor: 'Paul', at: 1_000 },
    ]);

    const edit = reduceNotes(
      add.notes,
      { action: 'note:edit', id: 1, kind: 'issue', text: 'Audio desync' },
      { ...ctx, now: 2_000, actor: 'Someone else' },
    );
    if (!edit.ok) throw new Error(edit.message);
    // Still theirs, marked as edited.
    expect(edit.notes.list[0]).toMatchObject({ kind: 'issue', actor: 'Paul', editedAt: 2_000 });

    const same = reduceNotes(
      edit.notes,
      { action: 'note:edit', id: 1, kind: 'issue', text: 'Audio desync' },
      ctx,
    );
    expect(same).toMatchObject({ ok: true, changed: false });

    const removed = reduceNotes(edit.notes, { action: 'note:remove', id: 1 }, ctx);
    if (!removed.ok) throw new Error(removed.message);
    expect(removed.notes.list).toEqual([]);
    const again = reduceNotes(
      removed.notes,
      { action: 'note:add', key: 'b', kind: 'tech', text: 'x' },
      ctx,
    );
    expect(again.ok && again.notes.list[0]!.id).toBe(2);
  });

  it('refuses runs off the schedule and edits to deleted notes', () => {
    expect(
      reduceNotes(emptyNotes(), { action: 'note:add', key: 'zz', kind: 'tech', text: 'x' }, ctx),
    ).toMatchObject({ ok: false, code: 'invalid' });
    expect(
      reduceNotes(emptyNotes(), { action: 'note:edit', id: 9, kind: 'tech', text: 'x' }, ctx),
    ).toMatchObject({ ok: false, code: 'conflict' });
    expect(reduceNotes(emptyNotes(), { action: 'note:remove', id: 9 }, ctx)).toMatchObject({
      ok: true,
      changed: false,
    });
  });

  it('keeps line breaks but strips other control and invisible characters', () => {
    const parsed = ClientActionSchema.parse({
      action: 'note:add',
      key: 'a',
      kind: 'issue',
      text: '  Line one\r\nLine\u0007 two‮  ',
    });
    expect(parsed).toMatchObject({ text: 'Line one\nLine two' });
    const blank = { action: 'note:add', key: 'a', kind: 'tech', text: ' \n ' };
    expect(ClientActionSchema.safeParse(blank).success).toBe(false);
  });
});

class FakeClient implements RoomClient {
  readonly messages: ServerMessage[] = [];
  operator: boolean;
  constructor(operator: boolean) {
    this.operator = operator;
  }
  send(msg: ServerMessage): void {
    this.messages.push(msg);
  }
  notes(): RunNote[] | undefined {
    const last = this.messages.filter((m) => m.type === 'notes').at(-1);
    return last?.type === 'notes' ? last.notes : undefined;
  }
}

function room(): Room {
  const schedule: Schedule = {
    ref: { source: 'oengus', event: 'test', slug: 'main' },
    eventName: 'Test',
    scheduleName: 'Main',
    twitch: '',
    lines: LINES,
    fetchedAt: 0,
  };
  return new Room({
    ref: schedule.ref,
    schedule,
    state: initialState(),
    store: null,
    services: { fetchSchedule: async () => schedule, capture: async () => {} },
  });
}

describe('Room notes', () => {
  it('go to operators only, never into room state, the log or the undo stack', () => {
    const r = room();
    const op = new FakeClient(true);
    const viewer = new FakeClient(false);
    r.join(op);
    r.join(viewer);
    const rev = r.state.rev;

    const res = r.dispatch({ action: 'note:add', key: 'a', kind: 'issue', text: 'Secret' }, 'Paul');
    expect(res).toEqual({ ok: true, undo: null });
    expect(op.notes()?.map((n) => n.text)).toEqual(['Secret']);
    expect(viewer.messages.some((m) => m.type === 'notes')).toBe(false);
    expect(JSON.stringify(viewer.messages)).not.toContain('Secret');
    expect(r.state.rev).toBe(rev);
    expect(JSON.stringify(r.state)).not.toContain('Secret');

    // Someone who signs in later gets them; someone who loses access has them taken back.
    viewer.operator = true;
    r.sendNotes(viewer);
    expect(viewer.notes()).toHaveLength(1);
    op.operator = false;
    r.sendNotes(op);
    expect(op.notes()).toEqual([]);
  });

  it('are cleared by a reset, without reusing ids', () => {
    const r = room();
    const op = new FakeClient(true);
    r.join(op);
    r.dispatch({ action: 'note:add', key: 'a', kind: 'tech', text: 'One' }, null);
    r.dispatch({ action: 'room:reset' }, null);
    expect(op.notes()).toEqual([]);
    r.dispatch({ action: 'note:add', key: 'b', kind: 'tech', text: 'Two' }, null);
    expect(op.notes()?.map((n) => n.id)).toEqual([2]);
  });
});
