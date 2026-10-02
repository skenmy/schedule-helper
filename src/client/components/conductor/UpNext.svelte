<script lang="ts">
  import { lineTitle } from '../../../shared/derive.ts';
  import { etaText } from '../../lib/checkin.ts';
  import { checkInState, fmtClock, fmtHM, fmtOffsetShort } from '../../lib/format.ts';
  import { getLive } from '../../lib/live.svelte.ts';
  import { ui } from '../../lib/ui.svelte.ts';

  let { count = 4, title = true }: { count?: number; title?: boolean } = $props();

  const live = getLive();
  const rows = $derived(
    live.upcoming.slice(0, count).map((i) => {
      const line = live.lines[i]!;
      const projected = live.projection[i]?.start ?? line.scheduledStart;
      const drift =
        projected != null && line.scheduledStart != null
          ? (projected - line.scheduledStart) / 1000
          : 0;
      const rec = live.state.runs[line.key];
      const ci = checkInState(rec);
      const hint =
        ci === 'ready'
          ? 'Runners ready'
          : ci === 'late'
            ? `Running late · ${etaText(rec!.late!, live.now)}`
            : ci === 'missing'
              ? 'Runner missing'
              : 'Not checked in';
      return { line, projected, drift, ci, hint };
    }),
  );
</script>

<section class="card upnext" aria-label="Up next">
  {#if title}
    <header>
      <span class="label">Up next</span>
      <button class="btn ghost sm" onclick={() => ui.openTab('schedule')}>Full schedule</button>
    </header>
  {/if}
  {#each rows as r, i (r.line.key)}
    <button class="row" class:first={i === 0} onclick={() => (ui.runSheet = r.line.key)}>
      <span class="when">
        <b class="num">{fmtClock(r.projected)}</b>
        {#if Math.abs(r.drift) >= 60}
          <small class:late={r.drift > 0} class:early={r.drift < 0}>{fmtOffsetShort(r.drift)}</small
          >
        {:else}
          <small>on time</small>
        {/if}
      </span>
      <span class="what">
        <strong class="truncate">{lineTitle(r.line)}</strong>
        <span class="truncate"
          >{r.line.runners.join(', ') || '—'}{r.line.category ? ` · ${r.line.category}` : ''}</span
        >
      </span>
      <span class="side">
        <span class="num est">{fmtHM(r.line.estimateSec)}</span>
        <span class="ci {r.ci}" title={r.hint} aria-label={r.hint} role="img"></span>
      </span>
    </button>
  {:else}
    <p class="empty">Nothing else on the schedule.</p>
  {/each}
</section>

<style>
  .upnext {
    padding: 8px;
  }
  header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 6px 6px 6px 10px;
  }
  .row {
    display: grid;
    grid-template-columns: 64px minmax(0, 1fr) auto;
    align-items: center;
    gap: 12px;
    width: 100%;
    padding: 10px;
    border: 0;
    border-radius: var(--radius-sm);
    background: transparent;
    text-align: left;
    cursor: pointer;
  }
  .row:hover {
    background: var(--surface-2);
  }
  .row.first {
    background: var(--accent-soft);
  }
  .when {
    display: grid;
  }
  .when b {
    font-size: 16px;
  }
  .row.first .when b {
    color: var(--accent);
  }
  .when small {
    font-size: 11px;
    color: var(--muted);
  }
  .late {
    color: var(--bad) !important;
  }
  .early {
    color: var(--info) !important;
  }
  .what {
    display: grid;
    min-width: 0;
  }
  .what strong {
    font-size: 14.5px;
  }
  .what span {
    font-size: 12.5px;
    color: var(--muted);
  }
  .side {
    display: flex;
    align-items: center;
    gap: 10px;
  }
  .est {
    font-size: 13px;
    color: var(--text-2);
  }
  .ci {
    width: 10px;
    height: 10px;
    border-radius: 50%;
    border: 2px solid var(--faint);
  }
  .ci.ready {
    background: var(--ok);
    border-color: var(--ok);
  }
  .ci.missing {
    background: var(--bad);
    border-color: var(--bad);
  }
  .ci.late {
    background: var(--warn);
    border-color: var(--warn);
  }
  .empty {
    padding: 14px;
    color: var(--muted);
    font-size: 13.5px;
  }
</style>
