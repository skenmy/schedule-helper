<script lang="ts">
  import { Play, Radar, StepForward, X } from '@lucide/svelte';
  import { haptic } from '../../lib/device.ts';
  import { fmtClock, relTime } from '../../lib/format.ts';
  import { getLive, getOps } from '../../lib/live.svelte.ts';
  import { getRoom } from '../../lib/room.svelte.ts';

  /**
   * A run change auto-tracking noticed on the stream, for an operator to
   * accept or dismiss. Accepting is an ordinary undoable action.
   */
  const room = getRoom();
  const live = getLive();
  const ops = getOps();

  const d = $derived(live.state.detection);
  const title = $derived(d ? live.titleOf(d.runKey) : '');
  const SOURCE = { twitch: 'Twitch', vision: 'Stream', nodecg: 'NodeCG', push: 'Timer' } as const;
  /** Newest word from each source. */
  const signals = $derived.by(() => {
    if (!d) return [];
    const bySource = new Map(d.signals.map((s) => [s.source, s]));
    return [...bySource.values()];
  });
  const sources = $derived(new Set(signals.map((s) => s.source)).size);
  const waitingForSecond = $derived(live.state.tracking.autoApply && sources < 2);
</script>

{#if d}
  <div class="detected" role="status" aria-live="polite" aria-label="Run change detected">
    <Radar size={20} />
    <div class="text">
      <strong>
        {d.kind === 'start' ? `${title} has started on stream` : `${title} is on stream`}
        {#if d.startedAt}<span class="num">· since {fmtClock(d.startedAt, true)}</span>{/if}
      </strong>
      <span class="why">
        {#each signals as s, i (s.source)}{i ? ' · ' : ''}{s.detail.replace(/^Twitch /, '')}
          <em>({SOURCE[s.source]}, {relTime(s.at, live.now)})</em>{/each}
        {#if waitingForSecond}· applies by itself if a second source agrees{/if}
      </span>
    </div>
    <div class="actions">
      <button
        class="btn primary"
        disabled={!room.canWrite}
        onclick={() => {
          haptic(14);
          ops.acceptDetection(d.id);
        }}
      >
        {#if d.kind === 'start'}<Play size={16} /> Start it{:else}<StepForward size={16} />
          {d.startedAt ? 'Advance & start' : 'Advance'}{/if}
      </button>
      <button
        class="btn ghost"
        disabled={!room.canWrite}
        aria-label="Not now"
        onclick={() => ops.dismissDetection(d.id)}><X size={16} /><span>Not now</span></button
      >
    </div>
  </div>
{/if}

<style>
  .detected {
    container: detected / inline-size;
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 10px 14px;
    padding: 10px var(--gutter);
    background: color-mix(in oklab, var(--info) 14%, var(--bg));
    border-bottom: 1px solid color-mix(in oklab, var(--info) 45%, transparent);
  }
  .detected > :global(svg) {
    flex: none;
    color: var(--info);
  }
  .text {
    flex: 1 1 260px;
    display: grid;
    gap: 2px;
    min-width: 0;
  }
  strong {
    font-size: 15px;
  }
  strong .num {
    color: var(--text-2);
    font-weight: 500;
    font-size: 13.5px;
  }
  .why {
    color: var(--text-2);
    font-size: 13px;
  }
  em {
    font-style: normal;
    color: var(--muted);
  }
  .actions {
    display: flex;
    gap: 6px;
    flex: none;
  }
  @container detected (max-width: 520px) {
    .actions {
      width: 100%;
    }
    .actions .btn.primary {
      flex: 1;
    }
  }
</style>
