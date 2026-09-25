<script lang="ts">
  // One kiosk cell. Every panel updates in place (no re-mounting), so the
  // Twitch player and scroll positions survive live updates.
  import { Play, Square, StepForward } from '@lucide/svelte';
  import { lineTitle } from '../../../shared/derive.ts';
  import {
    fmtClock,
    fmtDelta,
    fmtHM,
    fmtHMS,
    fmtOffsetShort,
    fmtWhen,
    runStatus,
  } from '../../lib/format.ts';
  import { PANELS, type PanelId } from '../../lib/kiosk.ts';
  import { getLive, getOps } from '../../lib/live.svelte.ts';
  import { getRoom } from '../../lib/room.svelte.ts';

  let { id }: { id: PanelId } = $props();

  const room = getRoom();
  const live = getLive();
  const ops = getOps();

  const line = $derived(live.current);
  const est = $derived(line?.estimateSec ?? 0);
  const over = $derived(est > 0 && live.elapsedSec > est);
  const phaseText = $derived(
    live.phase === 'complete'
      ? 'Complete'
      : live.timing?.phase === 'running'
        ? 'Now playing'
        : live.timing?.phase === 'finished'
          ? 'Run finished'
          : 'Setting up',
  );
  const next = $derived(
    live.upcoming.map((i) => ({
      line: live.lines[i]!,
      start: live.projection[i]?.start ?? live.lines[i]!.scheduledStart,
    })),
  );
  const deltaText = $derived.by(() => {
    if (live.phase === 'pre')
      return {
        label: 'Starts in',
        value: fmtHMS(((live.stats.scheduledStart ?? live.now) - live.now) / 1000),
        tone: 'idle',
      };
    if (live.phase === 'complete')
      return { label: 'Complete', value: fmtClock(live.state.finishedAt), tone: 'on' };
    if (live.delta == null) return { label: 'Not started', value: '—', tone: 'idle' };
    const label = { on: 'On schedule', ahead: 'Ahead', behind: 'Behind' }[live.status ?? 'on'];
    return { label, value: fmtDelta(live.delta), tone: live.tone };
  });
  const scheduleRows = $derived(
    live.lines
      .map((l, i) => ({ l, i, status: runStatus(live, i) }))
      .filter(
        (r) =>
          !r.l.setupBlock && r.status !== 'skipped' && (r.i >= live.curIndex || live.curIndex < 0),
      ),
  );
  const channel = $derived(live.state.twitchChannel || room.schedule?.twitch || '');
</script>

<section class="panel tone-{deltaText.tone}" data-panel={id}>
  <header>
    <h2>{PANELS[id].name}</h2>
    {#if id === 'running' && line}<span class="badge"
        >{live.timing?.phase === 'running' ? '● Live' : phaseText}</span
      >{/if}
    {#if id === 'schedule'}<span class="badge"
        >{live.stats.runsDone}/{live.stats.runsTotal} done</span
      >{/if}
  </header>

  <div class="body">
    {#if id === 'delta'}
      <div class="delta">
        <span class="state">{deltaText.label}</span>
        <span class="big num">{deltaText.value}</span>
        {#if line && live.phase === 'live'}
          <span class="sub"
            >Scheduled {fmtClock(line.scheduledStart)} · {live.timing?.startedAt
              ? `started ${fmtClock(live.timing.startedAt)}`
              : 'setting up'}</span
          >
        {/if}
      </div>
    {:else if id === 'running'}
      {#if line}
        <div class="running">
          <h3>{lineTitle(line)}</h3>
          <p class="meta">
            {[line.runners.join(', '), line.category, line.console].filter(Boolean).join(' · ')}
          </p>
          <span class="timer num" class:over class:live={live.timing?.phase === 'running'}
            >{fmtHMS(live.elapsedSec)}</span
          >
          <span class="meta num"
            >estimate {fmtHMS(est)}{over ? ` · +${fmtHMS(live.elapsedSec - est)}` : ''}</span
          >
        </div>
      {:else}
        <p class="empty">{live.phase === 'complete' ? 'That’s a wrap!' : 'No run live yet'}</p>
      {/if}
    {:else if id === 'timing'}
      <div class="grid4">
        <div><span class="k">Elapsed</span><b class="num">{fmtHMS(live.elapsedSec)}</b></div>
        <div><span class="k">Estimate</span><b class="num">{fmtHMS(est)}</b></div>
        <div>
          <span class="k">{over ? 'Over by' : 'Remaining'}</span>
          <b class="num" class:bad={over}>{fmtHMS(Math.abs(est - live.elapsedSec))}</b>
        </div>
        <div>
          <span class="k">Delta</span><b class="num"
            >{live.delta == null ? '—' : fmtDelta(live.delta)}</b
          >
        </div>
      </div>
    {:else if id === 'ondeck'}
      <ol class="list">
        {#each next as n, i (n.line.key)}
          <li class:first={i === 0}>
            <span class="when num">{fmtClock(n.start)}</span>
            <span class="what"
              ><b>{lineTitle(n.line)}</b><small
                >{n.line.runners.join(', ')}{n.line.category ? ` · ${n.line.category}` : ''}</small
              ></span
            >
            <span class="est num">{fmtHM(n.line.estimateSec)}</span>
          </li>
        {:else}
          <li class="empty">Nothing queued</li>
        {/each}
      </ol>
    {:else if id === 'checkins'}
      <ol class="list">
        {#each next as n (n.line.key)}
          {@const ci = live.state.runs[n.line.key]?.checkIn}
          <li>
            <span class="ci {ci ?? 'none'}"
              >{ci === 'ready' ? '✓' : ci === 'missing' ? '✗' : '?'}</span
            >
            <span class="what"
              ><b>{n.line.runners.join(', ') || '—'}</b><small
                >{lineTitle(n.line)} · {fmtClock(n.start)}</small
              ></span
            >
          </li>
        {:else}
          <li class="empty">Nothing queued</li>
        {/each}
      </ol>
    {:else if id === 'schedule'}
      <ol class="list sched">
        {#each scheduleRows as r (r.l.key)}
          <li class={r.status}>
            <span class="when num"
              >{fmtClock(live.projection[r.i]?.start ?? r.l.scheduledStart)}</span
            >
            <span class="what"><b>{lineTitle(r.l)}</b><small>{r.l.runners.join(', ')}</small></span>
            <span class="est num"
              >{r.status === 'current'
                ? live.timing?.phase === 'running'
                  ? '● LIVE'
                  : phaseText.toUpperCase()
                : fmtHM(r.l.estimateSec)}</span
            >
          </li>
        {/each}
      </ol>
    {:else if id === 'progress'}
      {@const pct = live.stats.runsTotal
        ? ((live.stats.runsDone + live.stats.runsSkipped) / live.stats.runsTotal) * 100
        : 0}
      <div class="progress">
        <b class="num">{Math.round(pct)}%</b>
        <div class="bar"><span style:width="{pct}%"></span></div>
        <p class="meta">{live.stats.runsDone} of {live.stats.runsTotal} runs done</p>
        <p class="meta">
          Projected end <b class="num">{fmtWhen(live.projectedEnd, live.now)}</b>
          {#if live.projectedEnd && live.stats.scheduledEnd}({fmtOffsetShort(
              (live.projectedEnd - live.stats.scheduledEnd) / 1000,
            )}){/if}
        </p>
      </div>
    {:else if id === 'clock'}
      <div class="clock">
        <span class="big num">{fmtClock(live.now)}</span>
        <span class="sub"
          >{new Date(live.now).toLocaleDateString('en-GB', {
            weekday: 'long',
            day: 'numeric',
            month: 'long',
          })}</span
        >
      </div>
    {:else if id === 'message'}
      <div class="message">
        {#if live.state.message}
          <p style:color={live.state.message.color}>{live.state.message.text}</p>
        {:else}
          <p class="empty">—</p>
        {/if}
      </div>
    {:else if id === 'controls'}
      <div class="controls">
        <span class="timer num" class:live={live.timing?.phase === 'running'}
          >{fmtHMS(live.elapsedSec)}</span
        >
        {#if room.canWrite}
          <div class="row">
            <button
              class="btn lg {live.timing?.phase === 'running' ? 'danger' : 'primary'}"
              onclick={() => ops.toggleTimer()}
            >
              {#if live.timing?.phase === 'running'}<Square size={20} /> Stop{:else}<Play
                  size={20}
                /> Start{/if}
            </button>
            <button class="btn lg" onclick={() => ops.advance()}
              ><StepForward size={20} /> Next</button
            >
          </div>
        {:else}
          <p class="meta">Sign in on the conductor to control the timer.</p>
        {/if}
      </div>
    {:else if id === 'log'}
      <ol class="list log">
        {#each live.state.log.slice(0, 12) as e (e.id)}
          <li class={e.kind}>
            <span class="when num">{fmtClock(e.at)}</span><span class="what">{e.text}</span>
          </li>
        {:else}
          <li class="empty">No entries yet</li>
        {/each}
      </ol>
    {:else if id === 'twitch'}
      {#if channel}
        <iframe
          title="Twitch stream"
          src="https://player.twitch.tv/?channel={encodeURIComponent(
            channel,
          )}&parent={location.hostname}&muted=true"
          allow="autoplay; fullscreen"
        ></iframe>
      {:else}
        <p class="empty">No Twitch channel set</p>
      {/if}
    {/if}
  </div>
</section>

<style>
  .panel {
    height: 100%;
    display: flex;
    flex-direction: column;
    border: 1px solid var(--border);
    border-radius: var(--radius-lg);
    background: var(--surface);
    overflow: hidden;
  }
  header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    padding: 10px 16px;
    border-bottom: 1px solid var(--border);
  }
  h2 {
    font-family: var(--font-mono);
    font-size: 11px;
    font-weight: 700;
    letter-spacing: 0.16em;
    text-transform: uppercase;
    color: var(--muted);
  }
  .badge {
    font-family: var(--font-mono);
    font-size: 11px;
    font-weight: 700;
    letter-spacing: 0.1em;
    text-transform: uppercase;
    color: var(--accent);
  }
  .body {
    flex: 1;
    min-height: 0;
    container-type: size;
    display: grid;
    overflow: hidden;
  }
  .empty {
    place-self: center;
    color: var(--muted);
    font-size: clamp(14px, 6cqmin, 40px);
  }
  .meta {
    color: var(--text-2);
    font-size: clamp(12px, 4.2cqmin, 30px);
  }
  .bad {
    color: var(--bad);
  }

  .delta,
  .clock {
    place-self: center;
    display: grid;
    justify-items: center;
    gap: 1cqmin;
    text-align: center;
  }
  .state {
    font-family: var(--font-mono);
    font-weight: 700;
    letter-spacing: 0.16em;
    text-transform: uppercase;
    font-size: clamp(12px, 5cqmin, 36px);
    color: var(--tone);
  }
  .big {
    font-size: clamp(32px, 26cqmin, 280px);
    font-weight: 700;
    line-height: 1;
    letter-spacing: -0.03em;
  }
  .delta .big {
    color: var(--tone);
  }
  .sub {
    color: var(--text-2);
    font-size: clamp(12px, 4cqmin, 28px);
  }

  .running,
  .controls,
  .progress {
    align-self: center;
    display: grid;
    gap: 1.5cqmin;
    padding: 4cqmin 5cqmin;
  }
  .running h3 {
    font-size: clamp(20px, 11cqmin, 110px);
    font-weight: 800;
    line-height: 1.02;
    letter-spacing: -0.02em;
  }
  .timer {
    font-size: clamp(28px, 17cqmin, 200px);
    font-weight: 700;
    line-height: 1;
  }
  .timer.live {
    color: var(--accent);
  }
  .timer.over {
    color: var(--warn);
  }
  .controls {
    justify-items: center;
  }
  .row {
    display: flex;
    gap: 12px;
  }

  .grid4 {
    display: grid;
    grid-template-columns: 1fr 1fr;
    grid-template-rows: 1fr 1fr;
  }
  .grid4 div {
    display: grid;
    align-content: center;
    padding: 3cqmin 4cqmin;
    border: 1px solid var(--border);
    margin: -1px 0 0 -1px;
  }
  .k {
    font-family: var(--font-mono);
    font-size: clamp(10px, 3.4cqmin, 22px);
    letter-spacing: 0.14em;
    text-transform: uppercase;
    color: var(--muted);
  }
  .grid4 b {
    font-size: clamp(18px, 10cqmin, 100px);
  }

  .list {
    list-style: none;
    margin: 0;
    padding: 1cqmin 0;
    overflow: auto;
    align-self: start;
    max-height: 100%;
  }
  .list li {
    display: grid;
    grid-template-columns: auto 1fr auto;
    align-items: center;
    gap: 3cqmin;
    padding: 2cqmin 4cqmin;
    border-bottom: 1px solid var(--border);
    font-size: clamp(13px, 4.6cqmin, 34px);
  }
  .list li.first,
  .list li.current {
    background: var(--accent-soft);
  }
  .list li.done {
    opacity: 0.5;
  }
  .when {
    color: var(--muted);
  }
  .first .when,
  .current .when,
  .current .est {
    color: var(--accent);
  }
  .what {
    display: grid;
    min-width: 0;
  }
  .what b,
  .what small {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .what small {
    color: var(--muted);
    font-size: 0.72em;
  }
  .est {
    color: var(--text-2);
  }
  .list .ci {
    display: grid;
    place-items: center;
    width: 1.8em;
    height: 1.8em;
    border-radius: 50%;
    font-weight: 800;
    background: var(--surface-3);
    color: var(--muted);
  }
  .ci.ready {
    background: var(--ok-soft);
    color: var(--ok);
  }
  .ci.missing {
    background: var(--bad-soft);
    color: var(--bad);
  }
  .log li {
    grid-template-columns: auto 1fr;
    font-size: clamp(12px, 3.8cqmin, 26px);
  }
  .log li.warning .what {
    color: var(--warn);
  }
  .log .what {
    display: block;
  }

  .progress b {
    font-size: clamp(28px, 20cqmin, 200px);
    line-height: 1;
  }
  .bar {
    height: clamp(8px, 3cqmin, 24px);
    border-radius: 99px;
    background: var(--surface-3);
    overflow: hidden;
  }
  .bar span {
    display: block;
    height: 100%;
    background: var(--accent);
  }

  .message {
    display: grid;
    place-items: center;
    padding: 5cqmin;
    background: #000;
  }
  .message p {
    font-size: clamp(24px, 14cqmin, 220px);
    font-weight: 800;
    line-height: 1.05;
    text-align: center;
    overflow-wrap: anywhere;
  }
  iframe {
    width: 100%;
    height: 100%;
    border: 0;
  }
</style>
