<script lang="ts">
  import { FileChartColumn } from '@lucide/svelte';
  import { MIN_SETUP_SEC, lineTitle } from '../../../shared/derive.ts';
  import {
    fmtClock,
    fmtDelta,
    fmtDuration,
    fmtHMS,
    fmtOffsetShort,
    fmtWhen,
  } from '../../lib/format.ts';
  import { getLive } from '../../lib/live.svelte.ts';
  import { reportPath } from '../../lib/report.ts';
  import { router } from '../../lib/router.svelte.ts';
  import { ui } from '../../lib/ui.svelte.ts';

  const live = getLive();
  const s = $derived(live.stats);

  // Both positions are measured in schedule time so long and short runs weigh
  // fairly: "scheduled" is where the clock says we should be, "actual" is that
  // shifted by the live delta.
  const pctOf = (t: number) =>
    s.scheduledStart == null || s.scheduledEnd == null || s.scheduledEnd <= s.scheduledStart
      ? 0
      : Math.min(
          100,
          Math.max(0, ((t - s.scheduledStart) / (s.scheduledEnd - s.scheduledStart)) * 100),
        );
  const scheduledPct = $derived(pctOf(live.now));
  const actualPct = $derived(
    live.phase === 'complete'
      ? 100
      : live.phase === 'live'
        ? pctOf(live.now + (live.delta ?? 0) * 1000)
        : 0,
  );
  const runsPct = $derived(s.runsTotal ? ((s.runsDone + s.runsSkipped) / s.runsTotal) * 100 : 0);

  const finished = $derived(
    live.lines
      .map((line) => ({ line, rec: live.state.runs[line.key] }))
      .filter(({ line, rec }) => !line.setupBlock && rec?.startedAt != null && rec.endedAt != null)
      .map(({ line, rec }) => {
        const actual = (rec!.endedAt! - rec!.startedAt!) / 1000;
        return { line, start: rec!.startedAt!, actual, diff: actual - line.estimateSec };
      })
      .reverse(),
  );
  const totalDiff = $derived(finished.reduce((sum, r) => sum + r.diff, 0));
  const overCount = $derived(finished.filter((r) => r.diff > 30).length);
  const finishOffset = $derived(
    live.projectedEnd && s.scheduledEnd ? (live.projectedEnd - s.scheduledEnd) / 1000 : null,
  );
  const pace = $derived(live.pace);
  const plan = $derived(live.catchUp);
  /** Enough to get back on time, plus a couple more; the rest summed up. */
  let showAll = $state(false);
  const shown = $derived(
    plan && !showAll
      ? plan.options.slice(0, Math.max(plan.enoughAt + 3, 6))
      : (plan?.options ?? []),
  );
  const hidden = $derived(plan ? plan.options.slice(shown.length) : []);
  const likelyOffset = $derived(
    live.likelyEnd && s.scheduledEnd ? (live.likelyEnd - s.scheduledEnd) / 1000 : null,
  );
</script>

{#if plan}
  <section class="card catchup" aria-label="Catching up">
    <header>
      <span class="label">Catching up</span>
      <p>
        <b>{fmtDuration(plan.behindSec)} behind</b>: the end is projected at
        <b>{fmtWhen(plan.projectedEnd, live.now)}</b>{pace ? ' at this event’s pace' : ''}, against
        {fmtWhen(plan.scheduledEnd, live.now)} on the schedule.
        {#if plan.options.length}Here’s what could give time back, least visible first.{:else}There’s
          no setup buffer left to trim.{/if}
      </p>
    </header>
    {#if plan.options.length}
      <ol>
        {#each shown as o, i (o.kind + o.key)}
          <li class:dim={plan.enoughAt >= 0 && i > plan.enoughAt}>
            <span class="what">
              Trim the setup after {live.titleOf(o.key)} to {MIN_SETUP_SEC / 60}m
              <small class="num">{fmtClock(o.at)}</small>
            </span>
            <span class="save num">−{fmtDuration(o.savesSec)}</span>
            <span class="end num">ends {fmtWhen(o.endAfter, live.now)}</span>
          </li>
          {#if i === plan.enoughAt}
            <li class="enough" aria-label="Back on schedule">↑ back on schedule with these</li>
          {/if}
        {/each}
        {#if hidden.length}
          <li class="more">
            <button class="btn ghost sm" onclick={() => (showAll = true)}>
              {hidden.length} more · −{fmtDuration(hidden.reduce((n, o) => n + o.savesSec, 0))}
            </button>
          </li>
        {/if}
      </ol>
      {#if plan.enoughAt < 0}
        <p class="hint">
          All of these together give back {fmtDuration(plan.options.at(-1)!.cumulativeSec)}; the
          rest would have to come from runs.
        </p>
      {/if}
    {/if}
    {#if pace && pace.setupDeltaSec >= 60}
      <p class="hint">
        Changeovers have been running {fmtOffsetShort(pace.setupDeltaSec)} over plan, so trimmed buffers
        may not hold.
      </p>
    {/if}
  </section>
{/if}

<div class="cards">
  <div class="card stat">
    <span class="label">Runs done</span>
    <b class="num">{s.runsDone}<small>/{s.runsTotal}</small></b>
    <span>{Math.round(runsPct)}% of runs{s.runsSkipped ? ` · ${s.runsSkipped} skipped` : ''}</span>
  </div>
  <div class="card stat">
    <span class="label">Projected end</span>
    <b class="num">{fmtWhen(live.projectedEnd, live.now)}</b>
    <span
      >{finishOffset != null
        ? `${fmtOffsetShort(finishOffset)} vs ${fmtWhen(s.scheduledEnd, live.now)}`
        : '—'}</span
    >
  </div>
  <div class="card stat">
    <span class="label">Runs vs estimate</span>
    <b class="num" class:bad={totalDiff > 60} class:good={totalDiff < -60}
      >{finished.length ? fmtDelta(totalDiff) : '—'}</b
    >
    <span
      >{finished.length
        ? `${overCount} of ${finished.length} ran over`
        : 'No finished runs yet'}</span
    >
  </div>
  <div class="card stat">
    <span class="label">Likely end</span>
    {#if pace && live.phase !== 'complete'}
      <b class="num">{fmtWhen(live.likelyEnd, live.now)}</b>
      <span
        >{likelyOffset != null ? `${fmtOffsetShort(likelyOffset)} vs schedule · ` : ''}runs at
        {Math.round(pace.runRatio * 100)}% of estimate, changeovers {fmtOffsetShort(
          pace.setupDeltaSec,
        )}</span
      >
    {:else}
      <b class="num">—</b>
      <span
        >{live.phase === 'complete' ? 'Marathon complete' : 'After a few runs have finished'}</span
      >
    {/if}
  </div>
  <div class="card stat">
    <span class="label">Total estimate</span>
    <b class="num">{fmtDuration(s.estimateTotalSec)}</b>
    <span>+ {fmtDuration(s.setupTotalSec)} setup & interludes</span>
  </div>
  <div class="card stat">
    <span class="label">Runners</span>
    <b class="num">{s.runnersTotal}</b>
    <span
      >Next {live.upcoming.length}: {live.checkIns.ready} ready{live.checkIns.late
        ? `, ${live.checkIns.late} late`
        : ''}, {live.checkIns.missing} missing</span
    >
  </div>
</div>

<section class="card progress">
  <span class="label">Completion · actual vs where the schedule says we should be</span>
  <div class="bar">
    <span class="fill" style:width="{actualPct}%"></span>
    <span class="marker" style:left="{scheduledPct}%" title="Scheduled position"></span>
  </div>
  <div class="legend">
    <span>{fmtClock(s.scheduledStart)}</span>
    <span class="accent">{actualPct.toFixed(1)}% through the schedule</span>
    <span>{scheduledPct.toFixed(1)}% by the clock</span>
    <span>{fmtWhen(s.scheduledEnd, live.now)}</span>
  </div>
</section>

<section>
  <header class="finished">
    <h3 class="label">Finished runs</h3>
    <button class="btn sm" onclick={() => router.navigate(reportPath(live.room.ref))}>
      <FileChartColumn size={15} /> Event report
    </button>
  </header>
  {#if finished.length}
    <table>
      <thead>
        <tr
          ><th>Run</th><th class="t">Started</th><th class="t">Estimate</th><th class="t">Actual</th
          ><th class="t">Difference</th></tr
        >
      </thead>
      <tbody>
        {#each finished as r (r.line.key)}
          <tr onclick={() => (ui.runSheet = r.line.key)}>
            <td
              ><strong>{lineTitle(r.line)}</strong>
              <span class="muted">{r.line.runners.join(', ')}</span></td
            >
            <td class="t num">{fmtClock(r.start)}</td>
            <td class="t num">{fmtHMS(r.line.estimateSec)}</td>
            <td class="t num">{fmtHMS(r.actual)}</td>
            <td class="t num" class:bad={r.diff > 30} class:good={r.diff < -30}
              >{fmtDelta(r.diff)}</td
            >
          </tr>
        {/each}
      </tbody>
    </table>
  {:else}
    <p class="muted">Finished runs appear here with their actual times against the estimate.</p>
  {/if}
</section>

<style>
  .catchup {
    display: grid;
    gap: 12px;
    margin-bottom: 16px;
    padding: 16px 18px;
    border-color: color-mix(in oklab, var(--warn) 40%, transparent);
    background: color-mix(in oklab, var(--warn) 6%, var(--surface));
  }
  .catchup header {
    display: grid;
    gap: 4px;
  }
  .catchup header .label {
    color: var(--warn);
  }
  .catchup ol {
    list-style: none;
    margin: 0;
    padding: 0;
    display: grid;
  }
  .catchup li {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto auto;
    align-items: baseline;
    gap: 16px;
    padding: 8px 0;
    border-top: 1px solid var(--border);
  }
  .catchup li.dim {
    opacity: 0.55;
  }
  .catchup .what small {
    margin-left: 8px;
    color: var(--muted);
  }
  .catchup .save {
    color: var(--ok);
    font-weight: 600;
  }
  .catchup .end {
    color: var(--text-2);
    font-size: 13px;
  }
  .catchup li.enough {
    display: block;
    border-top: 0;
    padding: 2px 0 6px;
    color: var(--ok);
    font-size: 12.5px;
    font-weight: 600;
  }
  .catchup li.more {
    display: block;
  }
  .cards {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(190px, 1fr));
    gap: 12px;
    margin-bottom: 16px;
  }
  .stat {
    display: grid;
    gap: 4px;
    padding: 16px;
    box-shadow: none;
  }
  .stat b {
    font-size: 28px;
    font-weight: 700;
  }
  .stat b small {
    font-size: 16px;
    color: var(--muted);
  }
  .stat > span:last-child {
    font-size: 12.5px;
    color: var(--muted);
  }
  .bad {
    color: var(--bad);
  }
  .good {
    color: var(--info);
  }
  .accent {
    color: var(--accent);
  }
  .progress {
    display: grid;
    gap: 12px;
    padding: 18px;
    margin-bottom: 24px;
    box-shadow: none;
  }
  .bar {
    position: relative;
    height: 16px;
    border-radius: 16px;
    background: var(--surface-3);
  }
  .fill {
    position: absolute;
    inset: 0 auto 0 0;
    border-radius: 16px;
    background: linear-gradient(
      90deg,
      color-mix(in oklab, var(--accent) 60%, transparent),
      var(--accent)
    );
  }
  .marker {
    position: absolute;
    top: -5px;
    bottom: -5px;
    width: 3px;
    margin-left: -1px;
    border-radius: 2px;
    background: var(--text);
  }
  .legend {
    display: flex;
    justify-content: space-between;
    font-family: var(--font-mono);
    font-size: 12px;
    color: var(--muted);
  }
  .finished {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    margin-bottom: 10px;
  }
  table {
    width: 100%;
    border-collapse: collapse;
    font-size: 14px;
  }
  th {
    text-align: left;
    padding: 8px 10px;
    border-bottom: 1px solid var(--border);
    font-family: var(--font-mono);
    font-size: 10.5px;
    letter-spacing: 0.12em;
    text-transform: uppercase;
    color: var(--muted);
  }
  td {
    padding: 9px 10px;
    border-bottom: 1px solid var(--border);
  }
  tr:hover td {
    background: var(--surface);
    cursor: pointer;
  }
  .t {
    text-align: right;
    white-space: nowrap;
  }
</style>
