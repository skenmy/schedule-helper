<script lang="ts">
  import { Copy, QrCode as QrIcon, Share } from '@lucide/svelte';
  import type { RunKey } from '../../../shared/types.ts';
  import { checkinTokens, checkinUrl } from '../../lib/checkin.ts';
  import { getRoom } from '../../lib/room.svelte.ts';
  import { toasts } from '../../lib/toasts.svelte.ts';
  import QrCode from '../ui/QrCode.svelte';

  /** An operator's way to hand a runner their check-in link: a QR to scan, or a link to send. */
  let { key, title, runners }: { key: RunKey; title: string; runners: string[] } = $props();

  const room = getRoom();
  let open = $state(false);
  let url = $state<string | null>(null);
  let error = $state<string | null>(null);
  const canShare = typeof navigator.share === 'function';

  async function show() {
    open = true;
    error = null;
    try {
      const token = (await checkinTokens(room.ref))[key];
      if (token) url = checkinUrl(room.ref, key, token);
      else error = 'This run isn’t on the schedule the server has. Re-import and try again.';
    } catch (err) {
      error = (err as Error).message;
    }
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(url!);
      toasts.push({ kind: 'success', title: 'Check-in link copied' });
    } catch {
      toasts.push({ kind: 'error', title: 'Couldn’t copy', body: 'Select the link and copy it.' });
    }
  }

  async function share() {
    try {
      await navigator.share({ title: `Check in: ${title}`, url: url! });
    } catch {
      // Dismissed: nothing to do.
    }
  }
</script>

{#if !open}
  <button class="btn sm" onclick={show}><QrIcon size={15} /> Runner check-in link</button>
{:else if error}
  <p class="error" role="alert">{error}</p>
{:else}
  <div class="link" aria-busy={url == null}>
    {#if url}
      <QrCode value={url} size={148} label="QR code for the check-in link" />
      <div class="text">
        <p>
          Send this to {runners.join(', ') || 'the runners'}, or let them scan it. It only works for
          this run: “I’m here” or “running late”.
        </p>
        <code>{url}</code>
        <span class="actions">
          <button class="btn sm" onclick={copy}><Copy size={15} /> Copy</button>
          {#if canShare}<button class="btn sm ghost" onclick={share}
              ><Share size={15} /> Share</button
            >{/if}
        </span>
      </div>
    {:else}
      <span class="muted">Getting the link…</span>
    {/if}
  </div>
{/if}

<style>
  .link {
    display: flex;
    gap: 14px;
    align-items: flex-start;
    flex-wrap: wrap;
  }
  .text {
    display: grid;
    gap: 8px;
    flex: 1 1 180px;
    min-width: 0;
  }
  .text p {
    font-size: 13px;
    color: var(--text-2);
  }
  code {
    display: block;
    padding: 6px 8px;
    border-radius: var(--radius-sm);
    background: var(--surface-2);
    font-family: var(--font-mono);
    font-size: 11.5px;
    overflow-wrap: anywhere;
    user-select: all;
    -webkit-user-select: all;
  }
  .actions {
    display: flex;
    gap: 6px;
  }
  .error {
    color: var(--bad);
    font-size: 13px;
  }
</style>
