<script lang="ts">
  import { Send, Trash } from '@lucide/svelte';
  import type { LogKind } from '../../../shared/types.ts';
  import { fmtClock, fmtDay, sameDay } from '../../lib/format.ts';
  import { getLive, getOps } from '../../lib/live.svelte.ts';
  import { prefs } from '../../lib/prefs.svelte.ts';
  import { getRoom } from '../../lib/room.svelte.ts';
  import { ui } from '../../lib/ui.svelte.ts';
  import Segmented from '../ui/Segmented.svelte';

  const room = getRoom();
  const live = getLive();
  const ops = getOps();

  type Kind = Exclude<LogKind, 'system' | 'warning'>;
  let text = $state('');
  let kind = $state<Kind>('note');
  const KINDS = [
    { value: 'note', label: 'Note' },
    { value: 'tech', label: 'Tech' },
    { value: 'runner', label: 'Runner' },
  ] as const;

  const FILTERS = [
    { value: 'all', label: 'Everything' },
    { value: 'notes', label: 'Notes' },
    { value: 'warnings', label: 'Warnings' },
    { value: 'system', label: 'Actions' },
  ] as const;
  let filter = $state(prefs.logFilter as (typeof FILTERS)[number]['value']);
  $effect(() => {
    prefs.logFilter = filter;
  });

  const entries = $derived(
    live.state.log.filter((e) => {
      switch (filter) {
        case 'notes':
          return e.kind === 'note' || e.kind === 'tech' || e.kind === 'runner';
        case 'warnings':
          return e.kind === 'warning';
        case 'system':
          return e.kind === 'system';
        default:
          return true;
      }
    }),
  );

  function submit(e: SubmitEvent) {
    e.preventDefault();
    const t = text.trim();
    if (t && ops.addLog(t, kind)) text = '';
  }

  async function clearAll() {
    const ok = await ui.ask({
      title: 'Clear the event log?',
      body: 'Removes every entry for everyone. This can’t be undone.',
      confirmLabel: 'Clear log',
      danger: true,
    });
    if (ok) ops.clearLog();
  }
</script>

<form class="composer" onsubmit={submit}>
  <input
    class="input"
    placeholder={room.canWrite ? 'Add a note for the team…' : 'Sign in to add notes'}
    maxlength="500"
    bind:value={text}
    disabled={!room.canWrite}
  />
  <Segmented label="Entry type" options={KINDS} bind:value={kind} disabled={!room.canWrite} />
  <button class="btn primary" type="submit" disabled={!room.canWrite || !text.trim()}
    ><Send size={15} /> Add</button
  >
</form>

<div class="bar">
  <Segmented label="Show" size="sm" options={FILTERS} bind:value={filter} />
  <span class="muted count">{entries.length} of {live.state.log.length}</span>
  {#if room.canWrite && live.state.log.length}
    <button class="btn ghost sm" onclick={clearAll}><Trash size={14} /> Clear log</button>
  {/if}
</div>

<ol class="log">
  {#each entries as e, i (e.id)}
    {#if i === 0 || !sameDay(entries[i - 1]!.at, e.at)}
      <li class="day">{fmtDay(e.at)}</li>
    {/if}
    <li class="entry {e.kind}">
      <span class="t num">{fmtClock(e.at)}</span>
      <span class="kind">{e.kind === 'system' ? 'action' : e.kind}</span>
      <span class="body">
        <span class="text">{e.text}</span>
        <span class="meta">
          {#if e.runKey}{live.titleOf(e.runKey)}{/if}
          {#if e.actor}{e.runKey ? ' · ' : ''}{e.actor}{/if}
        </span>
      </span>
      {#if room.canWrite && e.kind !== 'system'}
        <button
          class="btn ghost icon sm del"
          aria-label="Delete entry"
          onclick={() => ops.removeLog(e.id)}
        >
          <Trash size={14} />
        </button>
      {/if}
    </li>
  {:else}
    <li class="empty">Nothing logged yet.</li>
  {/each}
</ol>

<style>
  .composer {
    display: flex;
    gap: 10px;
    align-items: center;
    flex-wrap: wrap;
    margin-bottom: 16px;
  }
  .composer .input {
    flex: 1 1 300px;
  }
  .bar {
    display: flex;
    align-items: center;
    gap: 12px;
    margin-bottom: 10px;
    flex-wrap: wrap;
  }
  .count {
    flex: 1;
    font-size: 12.5px;
  }
  .log {
    list-style: none;
    margin: 0;
    padding: 0;
  }
  .day {
    padding: 14px 0 6px;
    font-family: var(--font-mono);
    font-size: 11px;
    font-weight: 700;
    letter-spacing: 0.14em;
    text-transform: uppercase;
    color: var(--text-2);
  }
  .entry {
    display: grid;
    grid-template-columns: 52px 70px 1fr auto;
    gap: 12px;
    align-items: start;
    padding: 9px 0;
    border-bottom: 1px solid var(--border);
  }
  .t {
    color: var(--muted);
    font-size: 13px;
    padding-top: 1px;
  }
  .kind {
    justify-self: start;
    padding: 1px 8px;
    border-radius: 999px;
    background: var(--surface-2);
    color: var(--muted);
    font-family: var(--font-mono);
    font-size: 10.5px;
    font-weight: 700;
    letter-spacing: 0.08em;
    text-transform: uppercase;
  }
  .note .kind {
    background: var(--accent-soft);
    color: var(--accent);
  }
  .tech .kind {
    background: var(--info-soft);
    color: var(--info);
  }
  .runner .kind {
    background: color-mix(in oklab, #a78bfa 16%, transparent);
    color: #c4b5fd;
  }
  .warning .kind {
    background: var(--warn-soft);
    color: var(--warn);
  }
  .warning .text {
    color: var(--warn);
  }
  .body {
    display: grid;
    gap: 2px;
    min-width: 0;
  }
  .text {
    overflow-wrap: anywhere;
  }
  .system .text {
    color: var(--text-2);
  }
  .meta {
    font-size: 12px;
    color: var(--muted);
  }
  .del {
    opacity: 0;
  }
  .entry:hover .del,
  .del:focus-visible {
    opacity: 1;
  }
  .empty {
    color: var(--muted);
    padding: 24px 0;
  }
  @media (max-width: 640px) {
    .entry {
      grid-template-columns: 46px 1fr auto;
    }
    .kind {
      display: none;
    }
    .del {
      opacity: 1;
    }
  }
</style>
