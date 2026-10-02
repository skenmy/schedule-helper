<script lang="ts">
  import { Copy, MonitorCog, RefreshCw } from '@lucide/svelte';
  import { roomKey } from '../../shared/sources.ts';
  import { getRoom } from '../lib/room.svelte.ts';
  import { toasts } from '../lib/toasts.svelte.ts';
  import { ui } from '../lib/ui.svelte.ts';

  /**
   * How to connect the stream PC's NodeCG speedcontrol (operators only): the
   * bundle's config file, or the bridge page's address. Both carry the room's
   * stream PC token, which only lets it report what's on stream.
   */
  const room = getRoom();
  let token = $state<string | null>(null);
  let error = $state<string | null>(null);
  let nodecgUrl = $state('http://localhost:9090');

  async function load(method: 'GET' | 'POST' = 'GET') {
    error = null;
    try {
      const res = await fetch(`/api/rooms/${roomKey(room.ref)}/source-token`, {
        method,
        credentials: 'same-origin',
      });
      const body = (await res.json()) as { token?: string; error?: string };
      if (!res.ok || !body.token) throw new Error(body.error ?? `Failed (${res.status})`);
      token = body.token;
    } catch (err) {
      error = (err as Error).message;
    }
  }

  const config = $derived(
    token && JSON.stringify({ url: location.origin, room: roomKey(room.ref), token }, null, 2),
  );
  const bridge = $derived(
    token &&
      `${location.origin}/bridge.html?${new URLSearchParams({
        room: roomKey(room.ref),
        nodecg: nodecgUrl.trim() || 'http://localhost:9090',
      })}#t=${token}`,
  );

  /** For a token that got out, or a stream PC that's retired. */
  async function replace() {
    const yes = await ui.ask({
      title: 'Replace the stream PC token?',
      body: 'The stream PC stops reporting until its bundle config (or bridge address) has the new one.',
      confirmLabel: 'Replace token',
      danger: true,
    });
    if (!yes) return;
    await load('POST');
    if (!error) toasts.push({ kind: 'success', title: 'New stream PC token made' });
  }

  async function copy(text: string, what: string) {
    try {
      await navigator.clipboard.writeText(text);
      toasts.push({ kind: 'success', title: `${what} copied` });
    } catch {
      toasts.push({ kind: 'error', title: 'Couldn’t copy', body: 'Select it and copy it.' });
    }
  }
</script>

{#if !token}
  <button class="btn sm" onclick={() => load()}
    ><MonitorCog size={15} /> Set up the stream PC</button
  >
  {#if error}<p class="error" role="alert">{error}</p>{/if}
{:else}
  <div class="setup">
    <section aria-label="NodeCG bundle">
      <h4>NodeCG bundle <small>dependable</small></h4>
      <p class="hint">
        Copy <code>integrations/nodecg-schedule-helper</code> from this app’s repository into
        NodeCG’s <code>bundles/</code>, put this in <code>cfg/nodecg-schedule-helper.json</code>
        and restart NodeCG.
      </p>
      <pre>{config}</pre>
      <button class="btn sm" onclick={() => copy(config!, 'Bundle config')}
        ><Copy size={15} /> Copy config</button
      >
    </section>
    <section aria-label="Bridge page">
      <h4>Bridge page <small>no install</small></h4>
      <p class="hint">
        Open this on the stream PC (a browser tab, or an OBS browser source) while NodeCG runs.
        Works best with NodeCG on the same PC. If NodeCG has a login, add
        <code>&key=YOUR_KEY</code> to the end.
      </p>
      <label class="field">
        <span class="label">NodeCG address, as the stream PC sees it</span>
        <input class="input" bind:value={nodecgUrl} spellcheck="false" />
      </label>
      <code class="url">{bridge}</code>
      <button class="btn sm" onclick={() => copy(bridge!, 'Bridge address')}
        ><Copy size={15} /> Copy address</button
      >
    </section>
    <p class="hint">
      Both carry this schedule’s stream PC token: it can only report what’s on stream. Keep it to
      the stream PC.
    </p>
    <button class="btn sm ghost replace" onclick={replace}
      ><RefreshCw size={15} /> Replace the token</button
    >
  </div>
{/if}

<style>
  .setup {
    display: grid;
    gap: 16px;
  }
  section {
    display: grid;
    gap: 8px;
  }
  h4 {
    margin: 0;
    font-size: 13.5px;
  }
  h4 small {
    margin-left: 6px;
    color: var(--muted);
    font-weight: 500;
  }
  pre,
  .url {
    margin: 0;
    padding: 8px 10px;
    border-radius: var(--radius-sm);
    background: var(--surface-2);
    font-family: var(--font-mono);
    font-size: 11.5px;
    overflow-wrap: anywhere;
    white-space: pre-wrap;
    user-select: all;
    -webkit-user-select: all;
  }
  section .btn,
  .replace {
    justify-self: start;
  }
  .error {
    color: var(--bad);
    font-size: 13px;
  }
</style>
