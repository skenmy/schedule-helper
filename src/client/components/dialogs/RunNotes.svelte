<script lang="ts">
  import { Lock, Pencil, Trash } from '@lucide/svelte';
  import type { NoteKind, RunKey, RunNote } from '../../../shared/types.ts';
  import { relTime } from '../../lib/format.ts';
  import { getLive, getOps } from '../../lib/live.svelte.ts';
  import { getRoom } from '../../lib/room.svelte.ts';
  import Segmented from '../ui/Segmented.svelte';

  /**
   * Operators' private tech notes and issues on one run, for the event report.
   * Only operators get them from the server; they never reach viewers or the
   * public report. Keyed by run in RunSheet, so a draft doesn't follow to the
   * next run opened.
   */
  let { runKey }: { runKey: RunKey } = $props();

  const room = getRoom();
  const live = getLive();
  const ops = getOps();

  const KINDS = [
    { value: 'tech', label: 'Tech note' },
    { value: 'issue', label: 'Issue', tone: 'bad' },
  ] as const;

  const notes = $derived(live.notesByRun[runKey] ?? []);
  let text = $state('');
  let kind = $state<NoteKind>('tech');
  /** The note being edited; the composer doubles as its editor. */
  let editing = $state<number | null>(null);

  // Deleted (here or by someone else) while being edited: back to a new note.
  $effect(() => {
    if (editing != null && !notes.some((n) => n.id === editing)) cancel();
  });

  function startEdit(note: RunNote) {
    editing = note.id;
    text = note.text;
    kind = note.kind;
  }

  function cancel() {
    editing = null;
    text = '';
    kind = 'tech';
  }

  function submit(e: SubmitEvent) {
    e.preventDefault();
    const t = text.trim();
    if (!t) return;
    const sent = editing != null ? ops.editNote(editing, kind, t) : ops.addNote(runKey, kind, t);
    if (sent) cancel();
  }

  function onkeydown(e: KeyboardEvent) {
    // ⌘/Ctrl+Enter saves, as in most note boxes; plain Enter is a new line.
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      (e.currentTarget as HTMLTextAreaElement).form?.requestSubmit();
    } else if (e.key === 'Escape' && editing != null) {
      // Leaves the edit, not the sheet.
      e.preventDefault();
      e.stopPropagation();
      cancel();
    }
  }
</script>

<section class="notes" aria-labelledby="run-notes-title">
  <h4 class="label" id="run-notes-title">
    Tech notes & issues <span class="private"><Lock size={11} /> Operators only</span>
  </h4>

  {#if notes.length}
    <ul>
      {#each notes as n (n.id)}
        <li class:editing={editing === n.id}>
          <span class="chip {n.kind === 'issue' ? 'bad' : 'info'}"
            >{n.kind === 'issue' ? 'Issue' : 'Tech'}</span
          >
          <div class="body">
            <p>{n.text}</p>
            <small class="muted"
              >{n.actor ?? 'An operator'} · {relTime(n.at, live.now)}{n.editedAt
                ? ` · edited ${relTime(n.editedAt, live.now)}`
                : ''}</small
            >
          </div>
          {#if room.canWrite}
            <div class="tools">
              <button
                class="btn ghost icon sm"
                aria-label="Edit note"
                title="Edit"
                onclick={() => startEdit(n)}><Pencil size={14} /></button
              >
              <button
                class="btn ghost icon sm"
                aria-label="Delete note"
                title="Delete"
                onclick={() => ops.removeNote(n)}><Trash size={14} /></button
              >
            </div>
          {/if}
        </li>
      {/each}
    </ul>
  {/if}

  {#if room.isOperator}
    <form onsubmit={submit}>
      <textarea
        class="textarea"
        rows="2"
        maxlength="2000"
        aria-label={editing != null ? 'Edit note' : 'New note'}
        placeholder={room.canWrite
          ? 'A tech note or issue to review after the event…'
          : 'Reconnecting…'}
        bind:value={text}
        disabled={!room.canWrite}
        {onkeydown}></textarea>
      <div class="row">
        <Segmented
          label="Note type"
          size="sm"
          options={KINDS}
          bind:value={kind}
          disabled={!room.canWrite}
        />
        <span class="spacer"></span>
        {#if editing != null}
          <button class="btn ghost sm" type="button" onclick={cancel}>Cancel</button>
        {/if}
        <button class="btn primary sm" type="submit" disabled={!room.canWrite || !text.trim()}
          >{editing != null ? 'Save' : 'Add note'}</button
        >
      </div>
    </form>
  {/if}
</section>

<style>
  .notes {
    display: grid;
    gap: 10px;
    margin-bottom: 22px;
  }
  h4 {
    display: flex;
    align-items: center;
    gap: 8px;
    flex-wrap: wrap;
  }
  .private {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    color: var(--faint);
    text-transform: none;
    letter-spacing: 0;
    font-size: 11.5px;
  }
  ul {
    list-style: none;
    margin: 0;
    padding: 0;
    display: grid;
    gap: 8px;
  }
  li {
    display: grid;
    grid-template-columns: auto minmax(0, 1fr) auto;
    align-items: start;
    gap: 10px;
    padding: 10px 12px;
    border: 1px solid var(--border);
    border-radius: var(--radius);
    background: var(--surface-2);
  }
  li.editing {
    border-color: var(--accent);
  }
  .body {
    display: grid;
    gap: 2px;
    min-width: 0;
  }
  .body p {
    margin: 0;
    font-size: 14px;
    white-space: pre-wrap;
    overflow-wrap: anywhere;
  }
  .body small {
    font-size: 12px;
  }
  .tools {
    display: flex;
    gap: 2px;
    margin: -4px -6px 0 0;
  }
  form {
    display: grid;
    gap: 8px;
  }
  .textarea {
    min-height: 64px;
  }
  .row {
    display: flex;
    align-items: center;
    gap: 8px;
    flex-wrap: wrap;
  }
  .spacer {
    flex: 1;
  }
</style>
