<script lang="ts">
  import { untrack } from 'svelte';
  import { fmtHMS, parseDurationInput } from '../../../shared/time.ts';
  import { getLive, getOps } from '../../lib/live.svelte.ts';
  import { ui } from '../../lib/ui.svelte.ts';
  import Dialog from '../ui/Dialog.svelte';

  const live = getLive();
  const ops = getOps();

  let open = $state(false);
  let value = $state('');
  let input = $state<HTMLInputElement>();

  $effect(() => {
    open = ui.setElapsed;
    if (!ui.setElapsed) return;
    value = fmtHMS(untrack(() => live.elapsedSec));
    queueMicrotask(() => input?.select());
  });

  const seconds = $derived(parseDurationInput(value));
  const phase = $derived(live.timing?.phase ?? 'setup');

  function nudge(delta: number) {
    value = fmtHMS(Math.max(0, (seconds ?? 0) + delta));
  }

  function save(e?: SubmitEvent) {
    e?.preventDefault();
    if (seconds == null) return;
    ops.setElapsed(seconds);
    ui.setElapsed = false;
  }
</script>

<Dialog
  bind:open
  title="Set the timer"
  subtitle={live.current?.game}
  size="sm"
  onclose={() => (ui.setElapsed = false)}
>
  <form onsubmit={save}>
    <input
      bind:this={input}
      class="input num big"
      bind:value
      aria-label="Elapsed time"
      placeholder="0:00:00"
      inputmode="numeric"
    />
    <div class="nudges">
      {#each [-60, -10, -1, 1, 10, 60] as d (d)}
        <button type="button" class="btn sm" onclick={() => nudge(d)}>
          {d > 0 ? '+' : '−'}{Math.abs(d) >= 60 ? `${Math.abs(d) / 60}m` : `${Math.abs(d)}s`}
        </button>
      {/each}
    </div>
    <p class="hint">
      {#if phase === 'running'}The timer keeps running from this value.
      {:else if phase === 'finished'}Adjusts the final time; the run stays finished.
      {:else}The run starts now, already this far in — for when the timer was started late.{/if}
    </p>
    {#if value && seconds == null}<p class="error">Use H:MM:SS, MM:SS or seconds.</p>{/if}
  </form>
  {#snippet footer()}
    <button class="btn ghost" onclick={() => (ui.setElapsed = false)}>Cancel</button>
    <button class="btn primary" disabled={seconds == null} onclick={() => save()}>Set timer</button>
  {/snippet}
</Dialog>

<style>
  form {
    display: grid;
    gap: 12px;
  }
  .big {
    font-size: 34px;
    font-weight: 700;
    text-align: center;
    min-height: 64px;
  }
  .nudges {
    display: grid;
    grid-template-columns: repeat(6, 1fr);
    gap: 6px;
  }
  .error {
    color: var(--bad);
    font-size: 13px;
  }
</style>
