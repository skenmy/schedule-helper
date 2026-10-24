// Private run notes: operators' tech notes and issues, for the event report.
// Kept out of RoomState (which every viewer gets), so they can only reach
// operators. Pure, like the reducer: `reduceNotes` never mutates its input.

import { indexOfKey } from '../../shared/derive.ts';
import type { MutatingAction } from '../../shared/protocol.ts';
import type { RunNote, ScheduleLine } from '../../shared/types.ts';

export const NOTE_LIMIT = 2_000;

export interface RoomNotes {
  /** Last id handed out; ids never repeat, even after a reset. */
  seq: number;
  /** In the order they were written. */
  list: RunNote[];
}

export type NoteAction = Extract<
  MutatingAction,
  { action: 'note:add' | 'note:edit' | 'note:remove' }
>;

export const emptyNotes = (seq = 0): RoomNotes => ({ seq, list: [] });

export type NotesResult =
  | { ok: true; notes: RoomNotes; changed: boolean }
  | { ok: false; code: 'invalid' | 'conflict'; message: string };

export function reduceNotes(
  notes: RoomNotes,
  action: NoteAction,
  ctx: { lines: readonly ScheduleLine[]; now: number; actor: string | null },
): NotesResult {
  const unchanged: NotesResult = { ok: true, notes, changed: false };
  switch (action.action) {
    case 'note:add': {
      if (indexOfKey(ctx.lines, action.key) < 0) {
        return { ok: false, code: 'invalid', message: 'That run is no longer on the schedule.' };
      }
      if (notes.list.length >= NOTE_LIMIT) {
        return { ok: false, code: 'conflict', message: 'This room has too many notes already.' };
      }
      const id = notes.seq + 1;
      const note: RunNote = {
        id,
        runKey: action.key,
        kind: action.kind,
        text: action.text,
        actor: ctx.actor,
        at: ctx.now,
      };
      return { ok: true, notes: { seq: id, list: [...notes.list, note] }, changed: true };
    }

    case 'note:edit': {
      const old = notes.list.find((n) => n.id === action.id);
      if (!old) return { ok: false, code: 'conflict', message: 'That note has been deleted.' };
      if (old.kind === action.kind && old.text === action.text) return unchanged;
      // Who wrote it stays; when it last changed is what's new.
      const note: RunNote = { ...old, kind: action.kind, text: action.text, editedAt: ctx.now };
      return {
        ok: true,
        notes: { ...notes, list: notes.list.map((n) => (n.id === action.id ? note : n)) },
        changed: true,
      };
    }

    case 'note:remove': {
      const list = notes.list.filter((n) => n.id !== action.id);
      if (list.length === notes.list.length) return unchanged;
      return { ok: true, notes: { ...notes, list }, changed: true };
    }
  }
}
