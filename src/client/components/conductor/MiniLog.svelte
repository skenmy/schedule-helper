<script lang="ts">
  import { fmtClock } from '../../lib/format.ts';
  import { getLive } from '../../lib/live.svelte.ts';
  import { ui } from '../../lib/ui.svelte.ts';

  const live = getLive();
  const entries = $derived(live.state.log.slice(0, 5));
</script>

<section class="card minilog" aria-label="Recent activity">
  <header>
    <span class="label">Activity</span>
    <button class="btn ghost sm" onclick={() => ui.openTab('log')}>Event log</button>
  </header>
  {#each entries as e (e.id)}
    <div class="entry {e.kind}">
      <span class="t num">{fmtClock(e.at)}</span>
      <span class="text"
        >{e.text}{#if e.actor}<em>&nbsp;· {e.actor}</em>{/if}</span
      >
    </div>
  {:else}
    <p class="empty">Nothing yet. Actions and notes show up here for everyone.</p>
  {/each}
</section>

<style>
  .minilog {
    padding: 8px 14px 12px;
  }
  header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin: 0 -6px 4px 0;
  }
  .entry {
    display: grid;
    grid-template-columns: 44px 1fr;
    gap: 8px;
    padding: 5px 0;
    font-size: 13px;
    border-top: 1px solid var(--border);
  }
  .entry:first-of-type {
    border-top: 0;
  }
  .t {
    color: var(--muted);
    font-size: 12px;
  }
  .text {
    color: var(--text-2);
    overflow-wrap: anywhere;
  }
  em {
    font-style: normal;
    color: var(--muted);
  }
  .entry.warning .text {
    color: var(--warn);
  }
  .entry.tech .text {
    color: var(--info);
  }
  .empty {
    color: var(--muted);
    font-size: 13px;
  }
</style>
