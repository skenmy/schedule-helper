<script lang="ts">
  import { Ellipsis, RefreshCw, RotateCcw, Search } from '@lucide/svelte';
  import { lineTitle } from '../../../shared/derive.ts';
  import { upstreamUrl } from '../../../shared/sources.ts';
  import {
    fmtClock,
    fmtDay,
    fmtDelta,
    fmtHM,
    fmtHMS,
    fmtOffsetShort,
    runStatus,
    sameDay,
  } from '../../lib/format.ts';
  import { getLive, getOps } from '../../lib/live.svelte.ts';
  import { getRoom } from '../../lib/room.svelte.ts';
  import { ui } from '../../lib/ui.svelte.ts';

  const room = getRoom();
  const live = getLive();
  const ops = getOps();

  type Filter = 'upcoming' | 'all' | 'done' | 'missing' | 'skipped';
  let filter = $state<Filter>('upcoming');
  let query = $state('');

  const multiDay = $derived(
    live.stats.scheduledStart != null &&
      live.stats.scheduledEnd != null &&
      !sameDay(live.stats.scheduledStart, live.stats.scheduledEnd),
  );

  const rows = $derived.by(() => {
    const q = query.trim().toLowerCase();
    const out = [];
    let lastDay: number | null = null;
    for (let i = 0; i < live.lines.length; i++) {
      const line = live.lines[i]!;
      const status = runStatus(live, i);
      const rec = live.state.runs[line.key];
      if (q) {
        if (line.setupBlock) continue;
        const hay =
          `${line.game} ${line.category} ${line.console} ${line.runners.join(' ')}`.toLowerCase();
        if (!hay.includes(q)) continue;
      }
      if (
        filter === 'upcoming' &&
        (status === 'done' || (status === 'skipped' && i < live.curIndex))
      )
        continue;
      if (filter === 'done' && status !== 'done') continue;
      if (filter === 'skipped' && status !== 'skipped') continue;
      if (filter === 'missing' && rec?.checkIn !== 'missing') continue;

      let dayBreak: string | null = null;
      if (multiDay && line.scheduledStart != null) {
        if (lastDay == null || !sameDay(lastDay, line.scheduledStart))
          dayBreak = fmtDay(line.scheduledStart);
        lastDay = line.scheduledStart;
      }
      out.push({ i, line, status, rec, dayBreak, projected: live.projection[i] });
    }
    return out;
  });

  const counts = $derived({
    missing: live.lines.filter((l) => live.state.runs[l.key]?.checkIn === 'missing').length,
    skipped: live.lines.filter((l) => live.state.runs[l.key]?.skipped).length,
  });

  const FILTERS: { id: Filter; label: string }[] = [
    { id: 'upcoming', label: 'Live & upcoming' },
    { id: 'all', label: 'All' },
    { id: 'done', label: 'Done' },
    { id: 'missing', label: 'Runner missing' },
    { id: 'skipped', label: 'Skipped' },
  ];

  const STATUS: Record<string, { label: string; cls: string }> = {
    current: { label: 'Live', cls: 'accent' },
    done: { label: 'Done', cls: '' },
    skipped: { label: 'Skipped', cls: '' },
    setup: { label: 'Interlude', cls: 'warn' },
    upcoming: { label: 'Upcoming', cls: '' },
  };

  async function refresh() {
    const ok = await ui.ask({
      title: 'Re-import the schedule?',
      body: `Fetches the latest runs, runners and estimates from ${room.ref.source === 'horaro' ? 'Horaro' : 'Oengus'} for everyone. Timings and check-ins stay attached to their runs.`,
      confirmLabel: 'Re-import',
    });
    if (ok) ops.refreshSchedule();
  }

  const source = $derived(upstreamUrl(room.ref));
</script>

<div class="head">
  <label class="search">
    <Search size={16} />
    <input class="input" placeholder="Filter by game, runner, platform…" bind:value={query} />
  </label>
  <div class="filters" role="group" aria-label="Filter runs">
    {#each FILTERS as f (f.id)}
      <button class="chip" class:accent={filter === f.id} onclick={() => (filter = f.id)}>
        {f.label}
        {#if f.id === 'missing' && counts.missing}<b>{counts.missing}</b>{/if}
        {#if f.id === 'skipped' && counts.skipped}<b>{counts.skipped}</b>{/if}
      </button>
    {/each}
  </div>
  <div class="actions">
    {#if source}<a class="btn ghost sm" href={source} target="_blank" rel="noopener"
        >Open on {room.ref.source === 'horaro' ? 'Horaro' : 'Oengus'}</a
      >{/if}
    <button class="btn sm" disabled={!room.canWrite || room.refreshing} onclick={refresh}>
      <RefreshCw size={14} />
      {room.refreshing ? 'Re-importing…' : 'Re-import'}
    </button>
    {#if room.canWrite}
      <button
        class="btn ghost sm reset"
        title="Clear all progress and start the marathon over"
        onclick={() => ops.resetMarathon()}
      >
        <RotateCcw size={14} /> Reset…
      </button>
    {/if}
  </div>
</div>

<table class="sched">
  <thead>
    <tr>
      <th class="n">#</th>
      <th>Run</th>
      <th class="runners">Runners</th>
      <th class="t">Est.</th>
      <th class="t">Scheduled</th>
      <th class="t">Projected / started</th>
      <th class="t">Actual</th>
      <th>Status</th>
      <th class="menu"><span class="visually-hidden">Actions</span></th>
    </tr>
  </thead>
  <tbody>
    {#each rows as r (r.line.key)}
      {#if r.dayBreak}
        <tr class="day"><td colspan="9">{r.dayBreak}</td></tr>
      {/if}
      {@const started = r.rec?.startedAt}
      {@const ended = r.rec?.endedAt}
      {@const drift =
        r.projected && r.line.scheduledStart != null
          ? (r.projected.start - r.line.scheduledStart) / 1000
          : null}
      <tr
        class="row {r.status}"
        class:missing={r.rec?.checkIn === 'missing'}
        onclick={() => (ui.runSheet = r.line.key)}
      >
        <td class="n num"
          >{r.line.setupBlock
            ? ''
            : live.lines.slice(0, r.i + 1).filter((l) => !l.setupBlock).length}</td
        >
        <td class="run">
          <strong>{lineTitle(r.line)}</strong>
          {#if r.line.type !== 'SINGLE' && !r.line.setupBlock}<span class="chip info type"
              >{r.line.type.toLowerCase()}</span
            >{/if}
          {#if r.line.category || r.line.console}
            <small>{[r.line.category, r.line.console].filter(Boolean).join(' · ')}</small>
          {/if}
        </td>
        <td class="runners">{r.line.runners.join(', ')}</td>
        <td class="t num">{fmtHM(r.line.estimateSec)}</td>
        <td class="t num dim">{fmtClock(r.line.scheduledStart)}</td>
        <td class="t num">
          {#if started && r.status !== 'upcoming'}
            {fmtClock(started)}
          {:else if r.projected}
            {fmtClock(r.projected.start)}
            {#if drift != null && Math.abs(drift) >= 60}
              <small class:late={drift > 0} class:early={drift < 0}>{fmtOffsetShort(drift)}</small>
            {/if}
          {:else}—{/if}
        </td>
        <td class="t num">
          {#if started && ended}
            {@const dur = (ended - started) / 1000}
            {fmtHMS(dur)}
            <small
              class:late={dur > r.line.estimateSec + 30}
              class:early={dur < r.line.estimateSec - 30}
            >
              {fmtDelta(dur - r.line.estimateSec)}
            </small>
          {:else if r.status === 'current' && started}
            <span class="accent">{fmtHMS(live.elapsedSec)}</span>
          {:else}—{/if}
        </td>
        <td>
          {#if r.rec?.checkIn === 'missing'}
            <span class="chip bad">Runner missing</span>
          {:else if r.rec?.checkIn === 'ready' && r.status === 'upcoming'}
            <span class="chip ok">Ready</span>
          {:else}
            <span class="chip {STATUS[r.status]!.cls}">{STATUS[r.status]!.label}</span>
          {/if}
        </td>
        <td class="menu">
          <button
            class="btn ghost icon sm"
            aria-label="Actions for {lineTitle(r.line)}"
            onclick={(e) => {
              e.stopPropagation();
              ui.runSheet = r.line.key;
            }}><Ellipsis size={16} /></button
          >
        </td>
      </tr>
    {:else}
      <tr><td colspan="9" class="empty">No runs match.</td></tr>
    {/each}
  </tbody>
</table>

<style>
  .head {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 12px;
    margin-bottom: 14px;
  }
  .search {
    position: relative;
    flex: 0 1 320px;
    display: flex;
    align-items: center;
  }
  .search :global(svg) {
    position: absolute;
    left: 11px;
    color: var(--muted);
    pointer-events: none;
  }
  .search .input {
    padding-left: 34px;
  }
  .filters {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    flex: 1;
  }
  .filters .chip {
    cursor: pointer;
    height: 28px;
  }
  .filters .chip b {
    color: var(--bad);
  }
  .actions {
    display: flex;
    gap: 6px;
  }
  .reset:hover {
    color: var(--bad);
  }
  .sched {
    width: 100%;
    border-collapse: collapse;
    font-size: 14px;
  }
  th {
    position: sticky;
    top: calc(var(--topbar-h) + 47px);
    z-index: 1;
    padding: 8px 10px;
    background: var(--bg);
    border-bottom: 1px solid var(--border);
    text-align: left;
    font-family: var(--font-mono);
    font-size: 10.5px;
    font-weight: 600;
    letter-spacing: 0.12em;
    text-transform: uppercase;
    color: var(--muted);
    white-space: nowrap;
  }
  td {
    padding: 10px;
    border-bottom: 1px solid var(--border);
    vertical-align: middle;
  }
  .row {
    cursor: pointer;
  }
  .row:hover td {
    background: var(--surface);
  }
  .row.current td {
    background: var(--accent-soft);
  }
  .row.current td:first-child {
    box-shadow: inset 3px 0 0 var(--accent);
  }
  .row.missing td:first-child {
    box-shadow: inset 3px 0 0 var(--bad);
  }
  .row.done td,
  .row.skipped td {
    color: var(--muted);
  }
  .row.skipped strong {
    text-decoration: line-through;
  }
  .row.setup td {
    color: var(--warn);
    font-style: italic;
  }
  .n {
    width: 44px;
    color: var(--muted);
  }
  .run strong {
    font-weight: 600;
  }
  .run small {
    display: block;
    color: var(--muted);
    font-size: 12.5px;
  }
  .type {
    height: 20px;
    margin-left: 6px;
    font-size: 11px;
  }
  .runners {
    color: var(--text-2);
    max-width: 240px;
  }
  .t {
    white-space: nowrap;
  }
  .t small {
    display: block;
    font-size: 11px;
    color: var(--muted);
  }
  .dim {
    color: var(--muted);
  }
  .late {
    color: var(--bad) !important;
  }
  .early {
    color: var(--info) !important;
  }
  .accent {
    color: var(--accent);
  }
  .menu {
    width: 40px;
    text-align: right;
  }
  .day td {
    padding: 18px 10px 6px;
    font-family: var(--font-mono);
    font-size: 11px;
    font-weight: 700;
    letter-spacing: 0.14em;
    text-transform: uppercase;
    color: var(--text-2);
  }
  .empty {
    text-align: center;
    color: var(--muted);
    padding: 32px;
  }
  @media (max-width: 1100px) {
    .runners,
    th:nth-child(7),
    td:nth-child(7) {
      display: none;
    }
  }
  @media (max-width: 820px) {
    .sched thead {
      display: none;
    }
    .sched,
    .sched tbody {
      display: block;
    }
    .row {
      display: grid;
      grid-template-columns: 1fr auto;
      grid-template-areas: 'run status' 'times times';
      gap: 4px 12px;
      padding: 12px 4px;
      border-bottom: 1px solid var(--border);
    }
    .row td {
      display: none;
      padding: 0;
      border: 0;
      background: none !important;
    }
    .row .run {
      display: block;
      grid-area: run;
    }
    .row td:nth-child(8) {
      display: block;
      grid-area: status;
    }
    .row td:nth-child(6) {
      display: block;
      grid-area: times;
      font-size: 13px;
      color: var(--muted);
    }
    .row td:nth-child(6)::before {
      content: 'Starts ';
      font-family: var(--font-ui);
    }
    .row td:nth-child(6) small {
      display: inline;
      margin-left: 6px;
    }
    .row.current {
      background: var(--accent-soft);
      border-radius: var(--radius-sm);
      padding-inline: 10px;
    }
    .day {
      display: block;
    }
    .day td {
      display: block;
      border: 0;
    }
  }
</style>
