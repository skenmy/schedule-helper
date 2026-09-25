<script lang="ts">
  import {
    LogIn,
    Play,
    RotateCcw,
    SkipForward,
    Square,
    StepBack,
    StepForward,
    Timer,
    Undo2,
  } from '@lucide/svelte';
  import { lineTitle } from '../../../shared/derive.ts';
  import { fmtHMS, relTime } from '../../lib/format.ts';
  import { getLive, getOps } from '../../lib/live.svelte.ts';
  import { getRoom } from '../../lib/room.svelte.ts';
  import { ui } from '../../lib/ui.svelte.ts';

  /** `compact` drops Start/Next, which the mobile action bar already provides. */
  let { compact = false }: { compact?: boolean } = $props();

  const room = getRoom();
  const live = getLive();
  const ops = getOps();

  const running = $derived(live.timing?.phase === 'running');
  const finished = $derived(live.timing?.phase === 'finished');
  const est = $derived(live.current?.estimateSec ?? 0);
  const over = $derived(est > 0 && live.elapsedSec > est);
  const complete = $derived(live.phase === 'complete');
  const disabled = $derived(!room.canWrite || room.status !== 'open');
</script>

<section class="card timer" aria-label="Timer controls">
  <div class="readout">
    <span class="label">{running ? 'Elapsed' : finished ? 'Final time' : 'Timer'}</span>
    <button
      class="elapsed num"
      class:running
      class:over
      disabled={disabled || complete}
      title="Set the elapsed time"
      onclick={() => (ui.setElapsed = true)}
      data-huds="text">{fmtHMS(live.elapsedSec)}</button
    >
    <span class="sub num">
      {#if live.current}
        of {fmtHMS(est)} estimate{#if over}
          · <b class="bad">+{fmtHMS(live.elapsedSec - est)}</b>{/if}
      {:else}
        {complete ? 'Marathon complete' : 'No run live'}
      {/if}
    </span>
  </div>

  {#if !room.canWrite && room.auth}
    <div class="readonly">
      <span>Read-only view.</span>
      {#if room.auth.loginUrl && !room.auth.authenticated}
        <button class="btn sm" onclick={() => room.signIn()}
          ><LogIn size={14} /> Sign in to control</button
        >
      {:else if room.auth.authenticated}
        <span class="muted">Your account doesn’t have operator access.</span>
      {/if}
    </div>
  {/if}

  {#if !compact}
    <div class="primary-row">
      <button
        class="btn lg {running ? 'danger' : 'primary'}"
        disabled={disabled || complete}
        onclick={() => ops.toggleTimer()}
      >
        {#if running}<Square size={18} /> Stop{:else if finished}<Play size={18} /> Resume{:else}<Play
            size={18}
          /> Start{/if}
        <span class="kbd">Space</span>
      </button>
      <button
        class="btn lg next"
        disabled={disabled || complete}
        onclick={() => ops.advance()}
        title="Advance to the next run"
      >
        <StepForward size={18} />
        <span class="truncate"
          >{live.next ? `Next: ${lineTitle(live.next)}` : 'Finish marathon'}</span
        >
        <span class="kbd">N</span>
      </button>
    </div>
  {/if}

  <div class="secondary">
    <button
      class="btn sm"
      {disabled}
      onclick={() => ops.back()}
      title="Back to the previous run (B)"><StepBack size={15} /> Back</button
    >
    <button class="btn sm" disabled={disabled || !live.current} onclick={() => ops.skip()}
      ><SkipForward size={15} /> Skip</button
    >
    <button class="btn sm" disabled={disabled || complete} onclick={() => (ui.setElapsed = true)}
      ><Timer size={15} /> Set time</button
    >
    <button
      class="btn sm"
      disabled={disabled || live.timing?.phase === 'setup' || !live.current}
      onclick={() => ops.reset()}><RotateCcw size={15} /> Reset</button
    >
  </div>

  {#if live.state.undo}
    <button class="undo" {disabled} onclick={() => ops.undo()} title="Undo (Z)">
      <Undo2 size={15} />
      <span class="truncate">Undo: {live.state.undo.summary}</span>
      <span class="who"
        >{live.state.undo.actor ? `${live.state.undo.actor} · ` : ''}{relTime(
          live.state.undo.at,
          live.now,
        )}</span
      >
    </button>
  {/if}
</section>

<style>
  .timer {
    padding: 18px;
    display: grid;
    gap: 14px;
  }
  .readout {
    display: grid;
    justify-items: start;
    gap: 2px;
  }
  .elapsed {
    padding: 0;
    border: 0;
    background: none;
    font-size: clamp(44px, 5vw, 64px);
    font-weight: 700;
    line-height: 1.05;
    letter-spacing: -0.03em;
    color: var(--text);
    cursor: pointer;
    border-radius: 8px;
  }
  .elapsed:disabled {
    cursor: default;
  }
  .elapsed:not(:disabled):hover {
    color: var(--accent);
  }
  .elapsed.running {
    color: var(--accent);
  }
  .elapsed.over {
    color: var(--warn);
  }
  .sub {
    font-size: 13px;
    color: var(--muted);
  }
  .bad {
    color: var(--bad);
    font-weight: 600;
  }
  .readonly {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 8px;
    padding: 10px 12px;
    border-radius: var(--radius-sm);
    background: var(--warn-soft);
    color: var(--warn);
    font-size: 13px;
    font-weight: 600;
  }
  .primary-row {
    display: grid;
    grid-template-columns: minmax(0, 1fr) minmax(0, 1.3fr);
    gap: 8px;
  }
  .next {
    justify-content: flex-start;
  }
  .next .truncate {
    flex: 1;
    text-align: left;
  }
  .secondary {
    display: grid;
    grid-template-columns: repeat(4, 1fr);
    gap: 6px;
  }
  .undo {
    display: flex;
    align-items: center;
    gap: 8px;
    width: 100%;
    padding: 8px 10px;
    border: 1px dashed var(--border-strong);
    border-radius: var(--radius-sm);
    background: transparent;
    color: var(--text-2);
    font-size: 13px;
    cursor: pointer;
    text-align: left;
  }
  .undo:hover:not(:disabled) {
    background: var(--surface-2);
    color: var(--text);
  }
  .undo .truncate {
    flex: 1;
    min-width: 0;
  }
  .who {
    color: var(--muted);
    font-size: 12px;
    white-space: nowrap;
  }
  @media (max-width: 1280px) {
    .primary-row {
      grid-template-columns: 1fr;
    }
    .secondary {
      grid-template-columns: repeat(2, 1fr);
    }
  }
</style>
