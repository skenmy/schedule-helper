<script lang="ts">
  import { Check, X } from '@lucide/svelte';
  import { lineTitle, upcomingIndexes } from '../../../shared/derive.ts';
  import type { CheckIn, RunKey } from '../../../shared/types.ts';
  import { haptic } from '../../lib/device.ts';
  import { fmtClock, fmtHM, fmtOffsetShort } from '../../lib/format.ts';
  import { getLive, getOps } from '../../lib/live.svelte.ts';
  import { getRoom } from '../../lib/room.svelte.ts';
  import { ui } from '../../lib/ui.svelte.ts';

  /** Upcoming runs with one-tap runner check-ins, for the tablet floor view. */
  let { count = 8 }: { count?: number } = $props();

  const room = getRoom();
  const live = getLive();
  const ops = getOps();

  const rows = $derived(
    upcomingIndexes(live.lines, live.state, count).map((i) => {
      const line = live.lines[i]!;
      const projected = live.projection[i]?.start ?? line.scheduledStart;
      const drift =
        projected != null && line.scheduledStart != null
          ? (projected - line.scheduledStart) / 1000
          : 0;
      return { line, projected, drift, checkIn: live.state.runs[line.key]?.checkIn ?? null };
    }),
  );

  /** Tapping the active state again clears it. */
  function set(key: RunKey, current: CheckIn | null, next: CheckIn) {
    haptic(10);
    ops.checkIn(key, current === next ? null : next);
  }
</script>

<section class="card ondeck" aria-label="On deck">
  <header>
    <span class="label">On deck</span>
    <span class="summary">
      <span class="chip ok">✓ {live.checkIns.ready}</span>
      {#if live.checkIns.missing}<span class="chip bad">✗ {live.checkIns.missing}</span>{/if}
      <span class="chip">? {live.checkIns.unchecked}</span>
    </span>
  </header>
  <ol>
    {#each rows as r, i (r.line.key)}
      <li class:first={i === 0} class={r.checkIn ?? 'none'}>
        <button class="what" onclick={() => (ui.runSheet = r.line.key)}>
          <span class="when">
            <b class="num">{fmtClock(r.projected)}</b>
            {#if Math.abs(r.drift) >= 60}
              <small class:late={r.drift > 0} class:early={r.drift < 0}
                >{fmtOffsetShort(r.drift)}</small
              >
            {:else}
              <small>on time</small>
            {/if}
          </span>
          <span class="names">
            <strong>{lineTitle(r.line)}</strong>
            <span class="truncate"
              >{r.line.runners.join(', ') || 'No runners listed'} · {fmtHM(
                r.line.estimateSec,
              )}</span
            >
          </span>
        </button>
        {#if r.line.runners.length}
          <span class="checkin" role="group" aria-label="Check-in for {lineTitle(r.line)}">
            <button
              class="ready"
              aria-pressed={r.checkIn === 'ready'}
              disabled={!room.canWrite}
              onclick={() => set(r.line.key, r.checkIn, 'ready')}><Check size={18} /> Ready</button
            >
            <button
              class="missing"
              aria-pressed={r.checkIn === 'missing'}
              disabled={!room.canWrite}
              onclick={() => set(r.line.key, r.checkIn, 'missing')}><X size={18} /> Missing</button
            >
          </span>
        {/if}
      </li>
    {:else}
      <li class="empty">Nothing else on the schedule.</li>
    {/each}
  </ol>
</section>

<style>
  .ondeck {
    container: ondeck / inline-size;
    padding: 8px;
  }
  header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    padding: 8px 8px 8px 12px;
  }
  .summary {
    display: flex;
    gap: 6px;
  }
  ol {
    list-style: none;
    margin: 0;
    padding: 0;
    display: grid;
    gap: 4px;
  }
  li {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 6px 8px 6px 0;
    border-radius: var(--radius);
    box-shadow: inset 3px 0 0 transparent;
  }
  li.first {
    background: var(--accent-soft);
  }
  li.ready {
    box-shadow: inset 3px 0 0 var(--ok);
  }
  li.missing {
    box-shadow: inset 3px 0 0 var(--bad);
    background: var(--bad-soft);
  }
  .what {
    flex: 1;
    min-width: 0;
    display: grid;
    grid-template-columns: 70px minmax(0, 1fr);
    align-items: center;
    gap: 12px;
    min-height: 60px;
    padding: 6px 4px 6px 14px;
    border: 0;
    border-radius: var(--radius);
    background: none;
    text-align: left;
    cursor: pointer;
  }
  .when {
    display: grid;
  }
  .when b {
    font-size: 18px;
  }
  li.first .when b {
    color: var(--accent);
  }
  .when small {
    font-size: 12px;
    color: var(--muted);
  }
  .late {
    color: var(--bad) !important;
  }
  .early {
    color: var(--info) !important;
  }
  .names {
    display: grid;
    min-width: 0;
  }
  .names strong {
    font-size: 16.5px;
    line-height: 1.25;
    overflow-wrap: anywhere;
  }
  .names span {
    color: var(--muted);
    font-size: 13.5px;
  }
  .checkin {
    flex: none;
    display: flex;
    gap: 6px;
  }
  .checkin button {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 6px;
    min-width: 108px;
    min-height: 52px;
    padding: 0 14px;
    border: 1px solid var(--border-strong);
    border-radius: var(--radius);
    background: var(--surface-2);
    color: var(--text-2);
    font-size: 15px;
    font-weight: 700;
    cursor: pointer;
    user-select: none;
    -webkit-user-select: none;
  }
  .checkin button:disabled {
    opacity: 0.45;
    cursor: not-allowed;
  }
  .ready[aria-pressed='true'] {
    border-color: transparent;
    background: var(--ok);
    color: #04140c;
  }
  .missing[aria-pressed='true'] {
    border-color: transparent;
    background: var(--bad);
    color: #1f0505;
  }
  .empty {
    padding: 16px;
    color: var(--muted);
  }
  /* Narrow (portrait, or a slim pane): icon-only check-in buttons. */
  @container ondeck (max-width: 520px) {
    .checkin button {
      min-width: 52px;
      padding: 0;
      font-size: 0;
      gap: 0;
    }
  }
</style>
