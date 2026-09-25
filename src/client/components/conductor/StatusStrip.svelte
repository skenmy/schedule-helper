<script lang="ts">
  import {
    fmtClock,
    fmtDelta,
    fmtHMS,
    fmtOffsetShort,
    fmtWhen,
    relTime,
  } from '../../lib/format.ts';
  import { getLive } from '../../lib/live.svelte.ts';

  let { compact = false }: { compact?: boolean } = $props();

  const live = getLive();
  const stats = $derived(live.stats);

  const headline = $derived.by(() => {
    const start = stats.scheduledStart;
    switch (live.phase) {
      case 'pre':
        return {
          tone: 'idle',
          label: 'Starts in',
          value: fmtHMS(((start ?? live.now) - live.now) / 1000),
          sub: `Scheduled start ${fmtClock(start)}`,
        };
      case 'idle':
        return {
          tone: 'idle',
          label: 'Not started',
          value: '—',
          sub: start
            ? `Scheduled start was ${fmtClock(start)} (${relTime(start, live.now)})`
            : 'Press Start to begin',
        };
      case 'complete':
        return {
          tone: 'on',
          label: 'Complete',
          value: fmtClock(live.state.finishedAt),
          sub: stats.scheduledEnd
            ? `Scheduled end ${fmtClock(stats.scheduledEnd)} · ${fmtOffsetShort(((live.state.finishedAt ?? 0) - stats.scheduledEnd) / 1000)}`
            : 'Marathon finished',
        };
      default: {
        const d = live.delta ?? 0;
        const label = { on: 'On schedule', ahead: 'Running ahead', behind: 'Running behind' }[
          live.status ?? 'on'
        ];
        const line = live.current;
        const started = live.timing?.startedAt;
        return {
          tone: live.tone,
          label,
          value: fmtDelta(d),
          sub: line
            ? `Scheduled ${fmtClock(line.scheduledStart)} · ${started ? `started ${fmtClock(started)}` : 'setting up'}`
            : '',
        };
      }
    }
  });

  const finishOffset = $derived(
    live.projectedEnd && stats.scheduledEnd
      ? (live.projectedEnd - stats.scheduledEnd) / 1000
      : null,
  );
  const runPct = $derived(
    stats.runsTotal ? ((stats.runsDone + stats.runsSkipped) / stats.runsTotal) * 100 : 0,
  );
</script>

<section class="strip" class:compact aria-label="Marathon status">
  <div class="headline tone-{headline.tone}">
    <span class="label">{headline.label}</span>
    <span class="value num" data-huds="text">{headline.value}</span>
    {#if headline.sub && !compact}<span class="sub">{headline.sub}</span>{/if}
  </div>

  <div class="stats">
    <div class="stat">
      <span class="label">Runs</span>
      <span class="v num">{stats.runsDone}<small>/{stats.runsTotal}</small></span>
      <span class="bar"><span style:width="{runPct}%"></span></span>
    </div>
    {#if !compact}
      <div class="stat">
        <span class="label">Hour</span>
        <span class="v num"
          >{String(stats.hourNow).padStart(2, '0')}<small>/{stats.hoursTotal}</small></span
        >
        <span class="off">started {fmtClock(stats.scheduledStart)}</span>
      </div>
    {/if}
    <div class="stat">
      <span class="label">Projected end</span>
      <span class="v num"
        >{live.phase === 'complete' ? '—' : fmtWhen(live.projectedEnd, live.now)}</span
      >
      {#if finishOffset != null && live.phase !== 'complete'}
        <span class="off" class:late={finishOffset > 60} class:early={finishOffset < -60}>
          {fmtOffsetShort(finishOffset)} vs {fmtWhen(stats.scheduledEnd, live.now)}
        </span>
      {/if}
    </div>
    {#if !compact}
      <div class="stat">
        <span class="label">Check-ins · next {live.upcoming.length}</span>
        <span class="checkins">
          <span class="chip ok" title="Ready">✓ {live.checkIns.ready}</span>
          {#if live.checkIns.missing}<span class="chip bad" title="Missing"
              >✗ {live.checkIns.missing}</span
            >{/if}
          <span class="chip" title="Not checked">? {live.checkIns.unchecked}</span>
        </span>
      </div>
    {/if}
  </div>
</section>

<style>
  .strip {
    display: flex;
    align-items: stretch;
    gap: 20px;
    padding: 16px var(--gutter);
    border-bottom: 1px solid var(--border);
    background: linear-gradient(180deg, var(--bg-2), var(--bg));
  }
  .headline {
    display: grid;
    align-content: center;
    gap: 2px;
    min-width: 240px;
    padding: 10px 18px;
    border-radius: var(--radius);
    background: var(--tone-soft);
    border: 1px solid color-mix(in oklab, var(--tone) 30%, transparent);
  }
  .headline .label {
    color: var(--tone);
  }
  .value {
    font-size: 38px;
    line-height: 1.05;
    font-weight: 700;
    color: var(--tone);
  }
  .sub {
    font-size: 12.5px;
    color: var(--text-2);
  }
  .stats {
    flex: 1;
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
    gap: 8px 20px;
    align-content: center;
  }
  .stat {
    display: grid;
    gap: 4px;
    align-content: start;
    align-self: start;
  }
  .v {
    font-size: 22px;
    font-weight: 600;
  }
  .v small {
    font-size: 14px;
    color: var(--muted);
    margin-left: 2px;
  }
  .bar {
    height: 4px;
    border-radius: 4px;
    background: var(--surface-3);
    overflow: hidden;
    max-width: 180px;
  }
  .bar span {
    display: block;
    height: 100%;
    background: var(--accent);
  }
  .off {
    font-size: 12.5px;
    color: var(--muted);
  }
  .off.late {
    color: var(--bad);
  }
  .off.early {
    color: var(--info);
  }
  .checkins {
    display: flex;
    gap: 6px;
    flex-wrap: wrap;
  }
  .compact {
    gap: 12px;
    padding: 10px var(--gutter);
  }
  .compact .headline {
    min-width: 0;
    flex: 1;
    padding: 8px 12px;
  }
  .compact .value {
    font-size: 28px;
  }
  .compact .stats {
    flex: none;
    grid-template-columns: auto;
    gap: 6px;
  }
  .compact .v {
    font-size: 17px;
  }
  .compact .bar {
    display: none;
  }
  @media (max-width: 1000px) {
    .strip:not(.compact) {
      flex-direction: column;
    }
  }
</style>
