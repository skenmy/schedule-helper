<script lang="ts">
  import { ArrowLeft, Braces, CloudOff, Download, Printer } from '@lucide/svelte';
  import { ON_SCHEDULE_WINDOW_SEC, scheduleStatus } from '../../shared/derive.ts';
  import { buildReport, type ReportRow } from '../../shared/report.ts';
  import { roomPath } from '../../shared/sources.ts';
  import DeltaChart from '../components/report/DeltaChart.svelte';
  import { clock } from '../lib/clock.svelte.ts';
  import { fmtDelta, fmtDuration, fmtHMS, fmtLate, fmtWhen, relTime } from '../lib/format.ts';
  import { getLive } from '../lib/live.svelte.ts';
  import { downloadCsv, reportApi } from '../lib/report.ts';
  import { getRoom } from '../lib/room.svelte.ts';
  import { router } from '../lib/router.svelte.ts';

  /**
   * The event report: planned against actual, overall and per run. Read-only,
   * so it works for anyone with the link and from the offline snapshot. The
   * numbers are shared/report.ts — the same ones the CSV and JSON exports carry.
   */
  const room = getRoom();
  const live = getLive();

  // Re-built on every state change, but only every 15 s for the clock: the
  // projections move by the minute and the page shouldn't churn at 4 Hz.
  const at = $derived(Math.floor(live.now / 15_000) * 15_000);
  const report = $derived(buildReport(room.schedule!, live.state, at));
  /** Times here only need to know which day it is, so the 15-second clock will do. */
  const now = $derived(at);
  const runRows = $derived(report.rows.filter((r) => r.number != null));

  const startLate = $derived(
    report.actualStart != null && report.scheduledStart != null
      ? (report.actualStart - report.scheduledStart) / 1000
      : null,
  );
  const end = $derived(report.actualEnd ?? report.projectedEnd);
  const endLate = $derived(
    end != null && report.scheduledEnd != null ? (end - report.scheduledEnd) / 1000 : null,
  );
  const likelyLate = $derived(
    report.likelyEnd != null && report.scheduledEnd != null
      ? (report.likelyEnd - report.scheduledEnd) / 1000
      : null,
  );
  const runDiff = $derived(report.runTimeSec - report.runEstimateSec);
  const changeovers = $derived(report.changeoversMeasured);
  const { runs } = $derived(report);
  const toGo = $derived(
    report.complete ? 0 : runs.total - runs.done - runs.skipped - runs.unplayed,
  );
  const runsNote = $derived(
    [
      runs.skipped ? `${runs.skipped} skipped` : '',
      runs.unplayed ? `${runs.unplayed} not run` : '',
      toGo > 0 ? `${toGo} to go` : '',
    ]
      .filter(Boolean)
      .join(' · ') || 'None skipped',
  );

  const badge = $derived(
    report.complete
      ? { tone: 'ok', text: 'Final' }
      : report.actualStart == null
        ? { tone: '', text: 'Not started' }
        : { tone: 'accent', text: 'In progress · updates live' },
  );

  const tone = (sec: number | null, window = 30) =>
    sec == null || Math.abs(sec) <= window ? '' : sec > 0 ? 'bad' : 'good';
  const toneAhead = (sec: number | null) =>
    sec == null ? '' : { on: '', ahead: 'good', behind: 'bad' }[scheduleStatus(sec)];
  const changeoverDiff = (r: ReportRow) =>
    r.changeoverSec != null && r.plannedChangeoverSec != null
      ? r.changeoverSec - r.plannedChangeoverSec
      : null;

  const extremes = $derived([
    { title: 'Furthest over estimate', list: report.overruns, empty: 'No run went over.' },
    { title: 'Furthest under estimate', list: report.underruns, empty: 'No run came in under.' },
  ]);

  const since = $derived(room.syncedAt ? relTime(room.syncedAt, clock.local) : null);
</script>

<div class="report">
  <header class="bar">
    <button
      class="btn ghost back"
      onclick={() => router.back(roomPath(room.ref))}
      aria-label="Back to the console"
    >
      <ArrowLeft size={18} /><span class="txt">Console</span>
    </button>
    <div class="actions">
      <button class="btn sm" onclick={() => downloadCsv(report)} title="Download CSV">
        <Download size={15} /> <span class="txt">CSV</span>
      </button>
      <a
        class="btn sm ghost"
        href={reportApi(room.ref, 'json')}
        target="_blank"
        rel="noopener"
        title="Open as JSON"
      >
        <Braces size={15} /> <span class="txt">JSON</span>
      </a>
      <button class="btn sm ghost" onclick={() => window.print()} title="Print">
        <Printer size={15} /> <span class="txt">Print</span>
      </button>
    </div>
  </header>

  <main>
    <div class="title">
      <span class="label">Event report</span>
      <h1>{report.event.name}</h1>
      <p>
        {report.event.schedule}
        <span class="chip {badge.tone}">{badge.text}</span>
        {#if room.offline}
          <span class="chip warn"
            ><CloudOff size={13} /> Offline{since ? ` · as of ${since}` : ''}</span
          >
        {/if}
      </p>
    </div>

    <section class="tiles" aria-label="Summary">
      <div class="tile-grid">
        <div class="card tile">
          <span class="label">Started</span>
          <b class="num">{fmtWhen(report.actualStart, now)}</b>
          <span
            >{startLate != null
              ? `${fmtLate(startLate)} · scheduled ${fmtWhen(report.scheduledStart, now)}`
              : `Scheduled ${fmtWhen(report.scheduledStart, now)}`}</span
          >
        </div>
        <div class="card tile wide">
          <span class="label">{report.complete ? 'Finished' : 'Projected end'}</span>
          <b class="num">{fmtWhen(end, now)}</b>
          <span
            >{endLate != null ? `${fmtLate(endLate)} · ` : ''}scheduled {fmtWhen(
              report.scheduledEnd,
              now,
            )}{#if report.likelyEnd != null}<br />likely {fmtWhen(report.likelyEnd, now)}
              at this event’s pace{likelyLate != null ? ` (${fmtLate(likelyLate)})` : ''}{/if}</span
          >
        </div>
        <div class="card tile">
          <span class="label">Runs</span>
          <b class="num">{report.runs.done}<small>/{report.runs.total}</small></b>
          <span>{runsNote}</span>
        </div>
        <div class="card tile">
          <span class="label">Runs vs estimate</span>
          <b class="num {tone(runDiff, 60)}">{report.runs.done ? fmtDelta(runDiff) : '—'}</b>
          <span
            >{report.runs.done
              ? `${fmtDuration(report.runTimeSec)} of runs against ${fmtDuration(report.runEstimateSec)} estimated`
              : 'No finished runs yet'}</span
          >
        </div>
        <div class="card tile">
          <span class="label">Changeovers</span>
          <b class="num {tone(report.changeoverDeltaSec)}"
            >{report.changeoverDeltaSec != null ? fmtDelta(report.changeoverDeltaSec) : '—'}</b
          >
          <span
            >{changeovers
              ? `Median against plan, over ${changeovers} changeover${changeovers === 1 ? '' : 's'}`
              : 'Measured once a run follows another'}</span
          >
        </div>
      </div>
    </section>

    <section class="card chart" aria-labelledby="chart-title">
      <header>
        <h2 id="chart-title">Start against schedule</h2>
        <p class="muted">
          How far ahead or behind each run started. Within {ON_SCHEDULE_WINDOW_SEC / 60} minutes is on
          schedule, as in the console.
        </p>
      </header>
      <DeltaChart rows={report.rows} {now} />
    </section>

    {#if report.overruns.length || report.underruns.length}
      <div class="extremes">
        {#each extremes as group (group.title)}
          <section class="card extreme" aria-label={group.title}>
            <h2>{group.title}</h2>
            {#if group.list.length}
              <ol>
                {#each group.list as r (r.key)}
                  <li>
                    <span class="what">
                      <b class="truncate">{r.title}</b>
                      <small class="muted truncate">{r.runners.join(', ')}</small>
                    </span>
                    <span class="num times muted"
                      >{fmtHMS(r.estimateSec)} → {fmtHMS(r.actualSec ?? 0)}</span
                    >
                    <span class="num diff {tone(r.overSec)}">{fmtDelta(r.overSec ?? 0)}</span>
                  </li>
                {/each}
              </ol>
            {:else}
              <p class="muted">{group.empty}</p>
            {/if}
          </section>
        {/each}
      </div>
    {/if}

    <section class="runs" aria-labelledby="runs-title">
      <h2 id="runs-title">Every run</h2>
      <div class="scroll">
        <table>
          <thead>
            <tr>
              <th class="n">#</th>
              <th>Run</th>
              <th class="t opt">Scheduled</th>
              <th class="t opt2">Started</th>
              <th class="t opt">Estimate</th>
              <th class="t">Actual</th>
              <th class="t" title="Actual against estimate">vs est.</th>
              <th class="t" title="Start against schedule">Start</th>
              <th class="t opt">Changeover</th>
            </tr>
          </thead>
          <tbody>
            {#each report.rows as r (r.key)}
              {#if r.status === 'interlude'}
                <tr class="interlude">
                  <td class="n"></td>
                  <td colspan="8"
                    ><span class="truncate">{r.title}</span>
                    <small class="num"
                      >{fmtWhen(r.scheduledStart, now)} · {fmtHMS(r.estimateSec)}</small
                    ></td
                  >
                </tr>
              {:else}
                {@const co = changeoverDiff(r)}
                <tr class={r.status}>
                  <td class="n num">{r.number}</td>
                  <td class="run">
                    <b>{r.title}</b>
                    <small class="muted"
                      >{r.category}{r.category && r.runners.length ? ' · ' : ''}{r.runners.join(
                        ', ',
                      )}</small
                    >
                  </td>
                  <td class="t num opt">{fmtWhen(r.scheduledStart, now)}</td>
                  <td class="t num opt2">{r.startedAt != null ? fmtWhen(r.startedAt, now) : ''}</td>
                  <td class="t num opt">{fmtHMS(r.estimateSec)}</td>
                  <td class="t num">
                    {#if r.status === 'skipped'}<span class="chip">Skipped</span>
                    {:else if r.status === 'unplayed'}<span class="chip">Not run</span>
                    {:else if r.status === 'live'}<span class="chip accent">Live</span>
                    {:else if r.actualSec != null}{fmtHMS(r.actualSec)}{/if}
                  </td>
                  <td class="t num {tone(r.overSec)}"
                    >{r.overSec != null ? fmtDelta(r.overSec) : ''}</td
                  >
                  <td class="t {toneAhead(r.startDeltaSec)}"
                    >{r.startDeltaSec != null ? fmtLate(-r.startDeltaSec) : ''}</td
                  >
                  <td class="t num opt">
                    {#if r.changeoverSec != null}
                      {fmtDuration(r.changeoverSec)}
                      {#if co != null && Math.abs(co) >= 60}<small class={tone(co, 59)}
                          >{co > 0 ? '+' : '−'}{fmtDuration(Math.abs(co))}</small
                        >{/if}
                    {/if}
                  </td>
                </tr>
              {/if}
            {/each}
          </tbody>
        </table>
      </div>
      {#if !runRows.length}<p class="muted">This schedule has no runs.</p>{/if}
    </section>

    <p class="foot muted">
      Generated {fmtWhen(report.generatedAt, now)} · times are local to this device · “Start” compares
      each run’s start with the schedule; changeovers run from a run’s end to the start of the run played
      next, against its setup time plus any interlude between (gaps over 90 minutes count as breaks).
    </p>
  </main>
</div>

<style>
  .report {
    min-height: 100dvh;
    container: report / inline-size;
  }
  /* Phones: icon-only actions, so the bar stays one row. The labels stay for screen readers. */
  @container report (max-width: 520px) {
    .bar .txt {
      position: absolute;
      width: 1px;
      height: 1px;
      overflow: hidden;
      clip-path: inset(50%);
      white-space: nowrap;
    }
  }
  .bar {
    position: sticky;
    top: 0;
    z-index: 5;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    padding: calc(10px + env(safe-area-inset-top, 0px)) var(--gutter) 10px;
    background: color-mix(in oklab, var(--bg) 88%, transparent);
    backdrop-filter: blur(12px);
    -webkit-backdrop-filter: blur(12px);
    border-bottom: 1px solid var(--border);
  }
  .back span {
    margin-left: 4px;
  }
  .actions {
    display: flex;
    gap: 6px;
    flex-wrap: wrap;
    justify-content: flex-end;
  }
  main {
    max-width: 1180px;
    margin: 0 auto;
    padding: 24px var(--gutter) calc(48px + env(safe-area-inset-bottom, 0px));
    display: grid;
    gap: 20px;
  }
  .title {
    display: grid;
    gap: 4px;
  }
  h1 {
    font-size: clamp(24px, 4vw, 34px);
    line-height: 1.15;
  }
  .title p {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 8px;
    color: var(--text-2);
  }
  h2 {
    font-size: 15px;
    font-weight: 650;
  }
  .tiles {
    container: tiles / inline-size;
  }
  .tile-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
    gap: 12px;
  }
  /* Phones: two across, the end time (the longest) on a row of its own. */
  @container tiles (max-width: 520px) {
    .tile-grid {
      grid-template-columns: 1fr 1fr;
      grid-auto-flow: dense;
    }
    .tile.wide {
      grid-column: span 2;
    }
    .tile {
      padding: 14px;
    }
    .tile b {
      font-size: 22px;
    }
  }
  .tile {
    display: grid;
    align-content: start;
    gap: 4px;
    padding: 16px;
    box-shadow: none;
  }
  .tile b {
    font-size: 28px;
    font-weight: 700;
    line-height: 1.2;
  }
  .tile b small {
    font-size: 16px;
    color: var(--muted);
  }
  .tile > span:last-child {
    font-size: 12.5px;
    color: var(--muted);
  }
  .bad {
    color: var(--bad);
  }
  .good {
    color: var(--info);
  }
  .chart {
    display: grid;
    gap: 14px;
    padding: 16px 18px 12px;
    box-shadow: none;
  }
  .chart header {
    display: grid;
    gap: 2px;
  }
  .chart header p {
    font-size: 13px;
  }
  .extremes {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(min(100%, 360px), 1fr));
    gap: 12px;
  }
  .extreme {
    display: grid;
    align-content: start;
    gap: 8px;
    padding: 16px 18px;
    box-shadow: none;
    container: extreme / inline-size;
  }
  @container extreme (max-width: 420px) {
    .extreme li {
      grid-template-columns: minmax(0, 1fr) auto;
    }
    .extreme .times {
      display: none;
    }
  }
  .extreme ol {
    list-style: none;
    margin: 0;
    padding: 0;
  }
  .extreme li {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto auto;
    align-items: center;
    gap: 12px;
    padding: 8px 0;
    border-top: 1px solid var(--border);
  }
  .extreme .what {
    display: grid;
    min-width: 0;
  }
  .extreme .times {
    font-size: 12.5px;
  }
  .extreme .diff {
    font-weight: 650;
    min-width: 64px;
    text-align: right;
  }
  .runs {
    display: grid;
    gap: 10px;
    container: report-table / inline-size;
  }
  .scroll {
    overflow-x: auto;
    border: 1px solid var(--border);
    border-radius: var(--radius-lg);
    background: var(--surface);
  }
  table {
    width: 100%;
    border-collapse: collapse;
    font-size: 13.5px;
  }
  th {
    position: sticky;
    top: 0;
    text-align: left;
    padding: 10px;
    border-bottom: 1px solid var(--border);
    background: var(--surface);
    font-family: var(--font-mono);
    font-size: 10.5px;
    font-weight: 500;
    letter-spacing: 0.1em;
    text-transform: uppercase;
    color: var(--muted);
    white-space: nowrap;
  }
  td {
    padding: 8px 10px;
    border-bottom: 1px solid var(--border);
    vertical-align: middle;
  }
  tbody tr:last-child td {
    border-bottom: 0;
  }
  .n {
    width: 1%;
    color: var(--muted);
    text-align: right;
  }
  .run {
    min-width: 140px;
  }
  .run b {
    display: block;
    font-weight: 600;
  }
  .run small {
    display: block;
    font-size: 12px;
  }
  .t {
    text-align: right;
    white-space: nowrap;
  }
  td.t small {
    margin-left: 4px;
    font-size: 11.5px;
  }
  tr.upcoming td,
  tr.skipped td,
  tr.unplayed td {
    color: var(--muted);
  }
  tr.upcoming .run b,
  tr.skipped .run b,
  tr.unplayed .run b {
    color: var(--text-2);
    font-weight: 500;
  }
  tr.live td {
    background: var(--accent-soft);
  }
  tr.interlude td {
    padding-block: 5px;
    color: var(--muted);
    font-size: 12.5px;
    font-style: italic;
  }
  tr.interlude small {
    margin-left: 8px;
    font-style: normal;
  }
  .foot {
    font-size: 12px;
    max-width: 70ch;
  }
  @container report-table (max-width: 720px) {
    .opt {
      display: none;
    }
  }
  @container report-table (max-width: 480px) {
    .opt2 {
      display: none;
    }
    .run {
      min-width: 120px;
    }
    th,
    td {
      padding-inline: 6px;
    }
  }

  /* Paper: dark themes off, no chrome, nothing split across pages that needn't be. */
  @media print {
    :global(:root),
    :global(:root[data-theme]) {
      --bg: #fff;
      --bg-2: #fff;
      --surface: #fff;
      --surface-2: #f4f4f5;
      --surface-3: #e4e4e7;
      --border: #d4d4d8;
      --border-strong: #a1a1aa;
      --text: #111;
      --text-2: #333;
      --muted: #555;
      --info: #0369a1;
      --bad: #b91c1c;
      --ok: #047857;
      --accent: #047857;
      --accent-soft: #ecfdf5;
    }
    :global(html),
    :global(body) {
      background: #fff;
      print-color-adjust: exact;
      -webkit-print-color-adjust: exact;
    }
    .bar {
      display: none;
    }
    main {
      padding: 0;
      max-width: none;
    }
    .card,
    .extreme li,
    tr {
      break-inside: avoid;
    }
    .scroll {
      overflow: visible;
      border: 0;
    }
    .opt,
    .opt2 {
      display: table-cell;
    }
    th {
      position: static;
    }
  }
</style>
