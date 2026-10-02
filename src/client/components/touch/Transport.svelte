<script lang="ts">
  import {
    Ellipsis,
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
  import { haptic } from '../../lib/device.ts';
  import { fmtHMS, relTime } from '../../lib/format.ts';
  import { getLive, getOps } from '../../lib/live.svelte.ts';
  import { getRoom } from '../../lib/room.svelte.ts';
  import { ui } from '../../lib/ui.svelte.ts';

  /**
   * Run controls for touch layouts, always within reach.
   * - `pane`: a block pinned to the bottom of the tablet's live pane.
   * - `floor`: the same, with oversized buttons for the floor mode.
   * - `dock`: one row along the bottom of the screen (tablet portrait).
   */
  let {
    variant = 'pane',
    readout = true,
  }: { variant?: 'pane' | 'floor' | 'dock'; readout?: boolean } = $props();

  const room = getRoom();
  const live = getLive();
  const ops = getOps();

  const running = $derived(live.timing?.phase === 'running');
  const finished = $derived(live.timing?.phase === 'finished');
  const complete = $derived(live.phase === 'complete');
  const est = $derived(live.current?.estimateSec ?? 0);
  const over = $derived(est > 0 && live.elapsedSec > est);
  const disabled = $derived(!room.canWrite);
  /** Signed in (or not) but without operator access: no controls to show. */
  const viewer = $derived(room.auth != null && !room.isOperator);
  const undo = $derived(live.state.undo);
  const moreId = $props.id();
  /** iOS before 17 has no popover: the dock then shows Set in place of the ⋯ menu. */
  const popovers = typeof HTMLElement !== 'undefined' && 'popover' in HTMLElement.prototype;

  function press(run: () => void, strength = 12) {
    haptic(strength);
    run();
  }
  function closeMore() {
    document.getElementById(moreId)?.hidePopover();
  }
</script>

<section class="transport {variant}" aria-label="Timer controls">
  {#if readout}
    <div class="readout">
      <button
        class="elapsed num"
        class:running
        class:over
        disabled={disabled || complete}
        aria-label="Elapsed {fmtHMS(live.elapsedSec)}. Set the timer"
        onclick={() => (ui.setElapsed = true)}
        data-huds="text">{fmtHMS(live.elapsedSec)}</button
      >
      <span class="sub num">
        {#if live.current}
          {running ? 'of' : finished ? 'final ·' : 'estimate'}
          {fmtHMS(est)}{#if over}
            · <b class="bad">+{fmtHMS(live.elapsedSec - est)}</b>{/if}
        {:else}
          {complete ? 'Complete' : 'No run live'}
        {/if}
      </span>
    </div>
  {/if}

  {#if viewer}
    <div class="readonly">
      <span>Read-only view</span>
      {#if room.auth?.loginUrl && !room.auth.authenticated}
        <button class="btn sm" onclick={() => room.signIn()}
          ><LogIn size={15} /> Sign in to control</button
        >
      {:else}
        <span class="muted">No operator access</span>
      {/if}
    </div>
  {:else}
    <div class="primary">
      <button
        class="btn lg {running ? 'danger' : 'primary'} toggle"
        disabled={disabled || complete}
        onclick={() => press(() => ops.toggleTimer(), 16)}
      >
        {#if running}<Square size={20} /> Stop{:else if finished}<Play size={20} /> Resume{:else}<Play
            size={20}
          /> Start{/if}
      </button>
      <button
        class="btn lg next"
        disabled={disabled || complete}
        onclick={() => press(() => ops.advance(), 16)}
        aria-label={live.next ? `Next: ${lineTitle(live.next)}` : 'Finish marathon'}
      >
        <StepForward size={20} />
        <span class="truncate"
          >{#if live.next}<span class="pre">Next:</span>
            {lineTitle(live.next)}{:else}Finish{/if}</span
        >
      </button>
    </div>

    <div class="secondary">
      <button class="btn" {disabled} onclick={() => press(() => ops.back())}
        ><StepBack size={17} /><span>Back</span></button
      >
      <button
        class="btn"
        disabled={disabled || !live.current}
        onclick={() => press(() => ops.skip())}><SkipForward size={17} /><span>Skip</span></button
      >
      {#if variant === 'dock'}
        <button
          class="btn"
          disabled={disabled || !undo}
          aria-label={undo ? `Undo: ${undo.summary}` : 'Undo'}
          onclick={() => press(() => ops.undo())}><Undo2 size={17} /><span>Undo</span></button
        >
        {#if !popovers}
          <button class="btn" disabled={disabled || complete} onclick={() => (ui.setElapsed = true)}
            ><Timer size={17} /><span>Set</span></button
          >
        {:else}
          <button class="btn" aria-label="More timer actions" popovertarget={moreId}
            ><Ellipsis size={18} /></button
          >
        {/if}
        <div class="more" popover id={moreId}>
          <button
            class="btn"
            disabled={disabled || complete}
            onclick={() => (closeMore(), (ui.setElapsed = true))}
            ><Timer size={17} /> Set the timer…</button
          >
          <button
            class="btn"
            disabled={disabled || live.timing?.phase === 'setup' || !live.current}
            onclick={() => (closeMore(), ops.reset())}
            ><RotateCcw size={17} /> Reset the timer</button
          >
        </div>
      {:else}
        <button class="btn" disabled={disabled || complete} onclick={() => (ui.setElapsed = true)}
          ><Timer size={17} /><span>Set</span></button
        >
        <button
          class="btn"
          disabled={disabled || live.timing?.phase === 'setup' || !live.current}
          onclick={() => press(() => ops.reset())}><RotateCcw size={17} /><span>Reset</span></button
        >
      {/if}
    </div>

    {#if undo && variant !== 'dock'}
      <button class="undo" {disabled} onclick={() => press(() => ops.undo())}>
        <Undo2 size={16} />
        <span class="truncate">Undo: {undo.summary}</span>
        <span class="who">{undo.actor ? `${undo.actor} · ` : ''}{relTime(undo.at, live.now)}</span>
      </button>
    {/if}
  {/if}
</section>

<style>
  .transport {
    display: grid;
    gap: 10px;
    padding: 14px var(--gutter) calc(14px + env(safe-area-inset-bottom));
    border-top: 1px solid var(--border);
    background: color-mix(in oklab, var(--bg-2) 94%, transparent);
    backdrop-filter: blur(14px);
    user-select: none;
    -webkit-user-select: none;
  }
  .readout {
    display: flex;
    align-items: baseline;
    gap: 12px;
    min-width: 0;
  }
  .elapsed {
    padding: 0;
    border: 0;
    background: none;
    font-size: 44px;
    font-weight: 700;
    line-height: 1;
    letter-spacing: -0.03em;
    color: var(--text);
    cursor: pointer;
    border-radius: 8px;
  }
  .elapsed:disabled {
    cursor: default;
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
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .bad {
    color: var(--bad);
    font-weight: 600;
  }
  .readonly {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 10px;
    padding: 12px 14px;
    border-radius: var(--radius-sm);
    background: var(--warn-soft);
    color: var(--warn);
    font-size: 14px;
    font-weight: 600;
  }
  .primary {
    display: grid;
    grid-template-columns: minmax(0, 0.8fr) minmax(0, 1.2fr);
    gap: 8px;
  }
  .primary .btn {
    min-height: 60px;
    font-size: 17px;
  }
  .next {
    justify-content: flex-start;
  }
  .next .truncate {
    flex: 1;
    text-align: left;
  }
  .pre {
    color: var(--muted);
    font-weight: 500;
  }
  .secondary {
    display: grid;
    grid-template-columns: repeat(4, minmax(0, 1fr));
    gap: 6px;
  }
  .secondary .btn {
    gap: 6px;
    padding: 0 8px;
  }
  .undo {
    display: flex;
    align-items: center;
    gap: 8px;
    width: 100%;
    min-height: 40px;
    padding: 6px 10px;
    border: 1px dashed var(--border-strong);
    border-radius: var(--radius-sm);
    background: transparent;
    color: var(--text-2);
    font-size: 13.5px;
    text-align: left;
    cursor: pointer;
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

  /* ── Floor: everything bigger ───────────────────────────────────────── */
  .floor {
    gap: 12px;
    padding-block: 18px calc(18px + env(safe-area-inset-bottom));
  }
  .floor .elapsed {
    font-size: clamp(72px, 7.5vw, 104px);
    letter-spacing: -0.04em;
  }
  .floor .sub {
    font-size: 16px;
  }
  .floor .primary .btn {
    min-height: 88px;
    font-size: 22px;
    border-radius: var(--radius-lg);
  }
  .floor .secondary .btn {
    min-height: 54px;
    font-size: 15px;
  }

  /* ── Dock: a single row along the bottom ────────────────────────────── */
  .dock {
    position: fixed;
    left: 0;
    right: 0;
    bottom: 0;
    z-index: 60;
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 10px calc(12px + env(safe-area-inset-right)) calc(10px + env(safe-area-inset-bottom))
      calc(12px + env(safe-area-inset-left));
  }
  .dock .readout {
    flex: none;
    display: grid;
    gap: 2px;
    min-width: 128px;
  }
  .dock .elapsed {
    font-size: 30px;
  }
  .dock .sub {
    font-size: 11.5px;
  }
  .dock .primary {
    flex: 1;
    min-width: 0;
  }
  .dock .primary .btn {
    min-height: 56px;
  }
  /* The arrow says "next"; the run's name needs the room. */
  .dock .pre {
    display: none;
  }
  .dock .secondary {
    flex: none;
    display: flex;
    gap: 6px;
  }
  .dock .secondary .btn {
    flex-direction: column;
    gap: 2px;
    width: 58px;
    min-height: 56px;
    padding: 0;
    font-size: 11px;
  }
  .dock .readonly {
    flex: 1;
  }
  .more {
    position: fixed;
    inset: auto calc(12px + env(safe-area-inset-right)) calc(88px + env(safe-area-inset-bottom))
      auto;
    margin: 0;
    padding: 8px;
    display: none;
    gap: 6px;
    min-width: 220px;
    border: 1px solid var(--border-strong);
    border-radius: var(--radius);
    background: var(--surface-2);
    color: var(--text);
    box-shadow: var(--shadow-lg);
  }
  .more:popover-open {
    display: grid;
  }
  .more .btn {
    justify-content: flex-start;
    min-height: 48px;
  }
</style>
