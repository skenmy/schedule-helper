<script lang="ts">
  import { RefreshCw, X } from '@lucide/svelte';
  import { getRoom } from '../lib/room.svelte.ts';

  const room = getRoom();
  let dismissed = $state<string | null>(null);
</script>

{#if room.newBuild && dismissed !== room.newBuild}
  <div class="pill" role="status">
    <span class="dot pulse"></span>
    A new version is available
    <button class="btn sm primary" onclick={() => location.reload()}
      ><RefreshCw size={14} /> Reload</button
    >
    <button
      class="btn ghost icon sm"
      aria-label="Dismiss"
      onclick={() => (dismissed = room.newBuild)}><X size={15} /></button
    >
  </div>
{/if}

<style>
  .pill {
    position: fixed;
    left: 16px;
    bottom: calc(16px + env(safe-area-inset-bottom));
    z-index: 900;
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 6px 6px 6px 14px;
    border-radius: 999px;
    border: 1px solid var(--border-strong);
    background: var(--surface-2);
    box-shadow: var(--shadow-lg);
    font-size: 13.5px;
    font-weight: 600;
    color: var(--accent);
  }
  :global(body.has-bottom-nav) .pill {
    bottom: calc(150px + env(safe-area-inset-bottom));
  }
</style>
