<script lang="ts">
  import { CloudOff, RefreshCw } from '@lucide/svelte';
  import { clock } from '../lib/clock.svelte.ts';
  import { fmtClock, relTime } from '../lib/format.ts';
  import { getRoom } from '../lib/room.svelte.ts';

  /**
   * Says plainly when the screen shows state the server hasn't confirmed:
   * opened with no signal (from this device's cache), or since the connection
   * dropped. Every control is disabled meanwhile (`room.canWrite`).
   */
  const room = getRoom();

  // A normal launch goes cache → live in a few hundred ms; don't flash for that.
  let show = $state(false);
  $effect(() => {
    if (!room.offline) {
      show = false;
      return;
    }
    const t = setTimeout(() => (show = true), 1500);
    return () => clearTimeout(t);
  });

  const since = $derived(
    room.syncedAt
      ? `${fmtClock(room.syncedAt + clock.offset)} (${relTime(room.syncedAt, clock.local)})`
      : null,
  );
</script>

{#if show}
  <div class="offline" role="status" aria-live="polite">
    {#if room.status === 'open'}
      <RefreshCw size={16} />
      <span>
        <b>{room.fatal ? 'Can’t load the live state' : 'Syncing…'}</b>
        {#if room.fatal}{room.fatal.message}{/if}
        {#if since}· showing {since}{/if}
      </span>
    {:else}
      <CloudOff size={16} />
      <span>
        <b>Offline</b>
        {#if since}· last synced {since}{/if}
        · controls paused until reconnected
      </span>
    {/if}
  </div>
{/if}

<style>
  .offline {
    position: fixed;
    top: calc(var(--topbar-h) + 10px);
    left: 50%;
    transform: translateX(-50%);
    z-index: 55;
    display: flex;
    align-items: center;
    gap: 10px;
    width: max-content;
    max-width: calc(100vw - 24px);
    padding: 8px 16px 8px 12px;
    border: 1px solid color-mix(in oklab, var(--warn) 45%, transparent);
    border-radius: 999px;
    background: color-mix(in oklab, var(--surface-2) 88%, var(--warn) 12%);
    backdrop-filter: blur(12px);
    box-shadow: var(--shadow-lg);
    color: var(--text);
    font-size: 13.5px;
    animation: drop 0.25s var(--ease);
  }
  .offline > :global(svg) {
    flex: none;
    color: var(--warn);
  }
  b {
    color: var(--warn);
  }
  @keyframes drop {
    from {
      opacity: 0;
      transform: translate(-50%, -8px);
    }
  }
</style>
