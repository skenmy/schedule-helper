<script lang="ts">
  import { Megaphone, Pencil, X } from '@lucide/svelte';
  import { fmtClock } from '../../lib/format.ts';
  import { getLive, getOps } from '../../lib/live.svelte.ts';
  import { getRoom } from '../../lib/room.svelte.ts';
  import { ui } from '../../lib/ui.svelte.ts';

  const room = getRoom();
  const live = getLive();
  const ops = getOps();
  const a = $derived(live.state.announcement);
</script>

{#if a}
  <div class="banner" style:--c={a.color} role="status" aria-live="polite">
    <Megaphone size={18} />
    <p>{a.text}</p>
    <span class="meta">{a.by ? `${a.by} · ` : ''}{fmtClock(a.at)}</span>
    {#if room.canWrite}
      <button
        class="btn ghost icon sm"
        aria-label="Edit announcement"
        onclick={() => ui.openTab('broadcast')}
      >
        <Pencil size={15} />
      </button>
      <button
        class="btn ghost icon sm"
        aria-label="Clear announcement"
        onclick={() => ops.clearAnnouncement()}
      >
        <X size={16} />
      </button>
    {/if}
  </div>
{/if}

<style>
  .banner {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 10px var(--gutter);
    background: color-mix(in oklab, var(--c) 16%, var(--bg));
    border-bottom: 1px solid color-mix(in oklab, var(--c) 45%, transparent);
    color: var(--text);
  }
  .banner > :global(svg) {
    color: var(--c);
    flex: none;
  }
  p {
    flex: 1;
    font-weight: 600;
    font-size: 15px;
  }
  .meta {
    color: var(--muted);
    font-size: 12.5px;
    white-space: nowrap;
  }
</style>
