<script lang="ts">
  import { onMount } from 'svelte';
  import { pushIsOn, pushSupport, setPush, testPush } from '../lib/push.ts';
  import { getRoom } from '../lib/room.svelte.ts';
  import { toasts } from '../lib/toasts.svelte.ts';

  /**
   * Turns push alerts for this schedule on or off for this device. Operators
   * only: alerts carry what operators see, and the server checks too.
   */
  const room = getRoom();
  const support = pushSupport();
  /** null while asking the server. */
  let on = $state<boolean | null>(null);
  let busy = $state(false);
  let error = $state<string | null>(null);

  onMount(() => {
    if (support !== 'ok' || !room.isOperator) return;
    pushIsOn(room.ref)
      .then((v) => (on = v))
      .catch(() => (on = false));
  });

  async function toggle() {
    busy = true;
    error = null;
    try {
      on = await setPush(room.ref, !on);
      if (on) toasts.push({ kind: 'success', title: 'Alerts are on for this device' });
    } catch (err) {
      error = (err as Error).message;
    } finally {
      busy = false;
    }
  }

  async function test() {
    error = null;
    try {
      await testPush(room.ref);
      toasts.push({
        kind: 'info',
        title: 'Test alert sent',
        body: 'It should arrive in a moment.',
      });
    } catch (err) {
      error = (err as Error).message;
    }
  }
</script>

<section class="alerts" aria-label="Alerts on this device">
  <div class="row">
    <span class="what">
      <b id="alerts-label">Alerts on this device</b>
      <small
        >Runners late or missing, the next runners not checked in, a run 15 minutes over, and run
        changes on stream. Even with the app closed.</small
      >
    </span>
    {#if support === 'ok' && room.isOperator}
      <button
        class="switch"
        role="switch"
        aria-checked={on === true}
        aria-labelledby="alerts-label"
        disabled={busy || on == null}
        onclick={toggle}
      ></button>
    {/if}
  </div>
  {#if !room.isOperator}
    <p class="hint">Sign in as an operator to get alerts.</p>
  {:else if support === 'install'}
    <p class="hint">
      On iPhone and iPad, add the app to your Home Screen first (Share → Add to Home Screen), open
      it from there, then turn alerts on.
    </p>
  {:else if support === 'denied'}
    <p class="hint">
      Notifications are blocked for this site. Allow them in the browser’s site settings, then come
      back here.
    </p>
  {:else if support === 'unsupported'}
    <p class="hint">This browser can’t receive notifications.</p>
  {:else if on}
    <button class="btn sm ghost test" onclick={test}>Send a test</button>
  {/if}
  {#if error}<p class="error" role="alert">{error}</p>{/if}
</section>

<style>
  .alerts {
    display: grid;
    gap: 8px;
  }
  .row {
    display: flex;
    align-items: center;
    gap: 14px;
  }
  .what {
    display: grid;
    gap: 2px;
    flex: 1;
    min-width: 0;
  }
  .what small {
    color: var(--muted);
    font-size: 12.5px;
  }
  .switch {
    position: relative;
    flex: none;
    width: 46px;
    height: 28px;
    border-radius: 999px;
    border: 1px solid var(--border-strong);
    background: var(--surface-3);
    cursor: pointer;
    transition: background 0.15s var(--ease);
  }
  .switch::after {
    content: '';
    position: absolute;
    top: 3px;
    left: 3px;
    width: 20px;
    height: 20px;
    border-radius: 50%;
    background: var(--text-2);
    transition: transform 0.15s var(--ease);
  }
  .switch[aria-checked='true'] {
    background: var(--accent);
    border-color: var(--accent);
  }
  .switch[aria-checked='true']::after {
    transform: translateX(18px);
    background: var(--accent-ink);
  }
  .switch:disabled {
    opacity: 0.5;
    cursor: default;
  }
  .switch:focus-visible {
    outline: none;
    box-shadow: var(--ring);
  }
  .test {
    justify-self: start;
  }
  .error {
    color: var(--bad);
    font-size: 13px;
  }
</style>
