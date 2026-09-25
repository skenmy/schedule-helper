<script lang="ts">
  import { lineTitle } from '../../../shared/derive.ts';
  import {
    fmtClock,
    fmtDelta,
    fmtDuration,
    fmtHMS,
    fmtOffsetShort,
    fmtWhen,
  } from '../../lib/format.ts';
  import { getLive } from '../../lib/live.svelte.ts';
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
</script>

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
    <span class="label">Total estimate</span>
    <b class="num">{fmtDuration(s.estimateTotalSec)}</b>
    <span>+ {fmtDuration(s.setupTotalSec)} setup & interludes</span>
  </div>
  <div class="card stat">
    <span class="label">Runners</span>
    <b class="num">{s.runnersTotal}</b>
    <span
      >Next {live.upcoming.length}: {live.checkIns.ready} ready, {live.checkIns.missing} missing</span
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
  <h3 class="label">Finished runs</h3>
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
  h3.label {
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
