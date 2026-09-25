<script lang="ts">
  import { Camera, Flag } from '@lucide/svelte';
  import { firstPlayableIndex, lineTitle } from '../../../shared/derive.ts';
  import type { CheckIn } from '../../../shared/types.ts';
  import {
    fmtClock,
    fmtDelta,
    fmtHM,
    fmtHMS,
    fmtOffsetShort,
    hueOf,
    initials,
    relTime,
  } from '../../lib/format.ts';
  import { getLive, getOps } from '../../lib/live.svelte.ts';
  import { getRoom } from '../../lib/room.svelte.ts';
  import { ui } from '../../lib/ui.svelte.ts';
  import Segmented from '../ui/Segmented.svelte';

  const room = getRoom();
  const live = getLive();
  const ops = getOps();

  /** The live run, or the one Start will begin. */
  const index = $derived(
    live.curIndex >= 0 ? live.curIndex : firstPlayableIndex(live.lines, live.state.runs),
  );
  const line = $derived(live.lines[index] ?? null);
  const isCurrent = $derived(index === live.curIndex);
  const timing = $derived(isCurrent ? live.timing : null);
  const est = $derived((line?.estimateSec ?? 0) * 1000);
  const elapsed = $derived(timing?.elapsedMs ?? 0);
  const over = $derived(est > 0 && elapsed > est);
  const fill = $derived(est > 0 ? Math.min(1, elapsed / est) : 0);
  const overFill = $derived(est > 0 && over ? Math.min(1, (elapsed - est) / est) : 0);

  const eyebrow = $derived.by(() => {
    if (live.phase === 'complete') return { tone: 'ok', text: 'Marathon complete' };
    if (!isCurrent)
      return { tone: 'idle', text: live.phase === 'pre' ? 'Up first' : 'Not started' };
    switch (timing?.phase) {
      case 'running':
        return { tone: 'live', text: 'Live' };
      case 'finished':
        return { tone: 'ok', text: 'Run finished' };
      default:
        return { tone: 'idle', text: 'Setting up' };
    }
  });

  const checkIn = $derived<CheckIn | 'none'>(
    (line && live.state.runs[line.key]?.checkIn) || 'none',
  );
  const CHECK_OPTIONS = [
    { value: 'none', label: 'Not checked' },
    { value: 'ready', label: 'Ready', tone: 'ok' },
    { value: 'missing', label: 'Missing', tone: 'bad' },
  ] as const;

  const lateBy = $derived(
    line?.scheduledStart != null && timing?.startedAt != null
      ? (timing.startedAt - line.scheduledStart) / 1000
      : null,
  );
  const projectedEnd = $derived(live.projection[index]?.end ?? null);

  const capture = $derived(live.state.capture);
  const captureInfo = $derived.by(() => {
    if (live.state.captureBusy)
      return { tone: 'muted', text: 'Checking the stream…', apply: false };
    if (!capture || !line || live.now - capture.at > 30 * 60_000) return null;
    if (capture.error)
      return { tone: 'warn', text: `Stream check failed: ${capture.error}`, apply: false };
    if (capture.runKey && capture.runKey !== line.key) {
      return { tone: 'warn', text: `Stream shows ${live.titleOf(capture.runKey)}`, apply: true };
    }
    if (capture.currentKey !== line.key || capture.driftSec == null) return null;
    const off = Math.abs(capture.driftSec) > live.state.drift.thresholdSec;
    return {
      tone: off ? 'warn' : 'ok',
      text: off ? `Stream timer ${fmtDelta(capture.driftSec)} vs ours` : 'Stream timer in sync',
      apply: off,
    };
  });
</script>

<article class="card now">
  {#if live.phase === 'complete'}
    <div class="done">
      <Flag size={34} />
      <h2>That’s a wrap!</h2>
      <p>
        Finished at <b>{fmtClock(live.state.finishedAt)}</b>
        {#if live.stats.scheduledEnd}
          · {fmtOffsetShort(((live.state.finishedAt ?? 0) - live.stats.scheduledEnd) / 1000)} vs schedule
        {/if}
      </p>
      <p class="muted">
        {live.stats.runsDone} runs done{live.stats.runsSkipped
          ? `, ${live.stats.runsSkipped} skipped`
          : ''}. Select a run to reopen the marathon.
      </p>
    </div>
  {:else if line}
    <div class="eyebrow">
      <span class="pill {eyebrow.tone}">
        {#if eyebrow.tone === 'live'}<span class="dot pulse"></span>{/if}
        {eyebrow.text}
      </span>
      <span class="label"
        >Run {live.lines.slice(0, index + 1).filter((l) => !l.setupBlock).length} of {live.stats
          .runsTotal}</span
      >
      {#if line.type !== 'SINGLE'}<span class="chip info">{line.type.toLowerCase()}</span>{/if}
    </div>

    <h1 data-huds="text">{lineTitle(line)}</h1>
    <p class="cat">{[line.category, line.console].filter(Boolean).join(' · ') || '—'}</p>

    <div class="runners">
      {#each line.runners as name (name)}
        <span class="runner">
          <span class="avatar" style:--h={hueOf(name)}>{initials(name)}</span>
          {name}
        </span>
      {:else}
        <span class="muted">No runners listed</span>
      {/each}
      {#if line.runners.length}
        <span class="checkin">
          <Segmented
            label="Runner check-in"
            size="sm"
            options={CHECK_OPTIONS}
            value={checkIn}
            disabled={!room.canWrite}
            onchange={(v) => ops.checkIn(line.key, v === 'none' ? null : v)}
          />
        </span>
      {/if}
    </div>

    <dl class="facts">
      <div>
        <dt class="label">Scheduled</dt>
        <dd class="num">{fmtClock(line.scheduledStart)}</dd>
      </div>
      <div>
        <dt class="label">Started</dt>
        <dd class="num">
          {timing?.startedAt ? fmtClock(timing.startedAt) : '—'}
          {#if lateBy != null && Math.abs(lateBy) >= 60}
            <small class:late={lateBy > 0} class:early={lateBy < 0}>{fmtOffsetShort(lateBy)}</small>
          {/if}
        </dd>
      </div>
      <div>
        <dt class="label">Estimate</dt>
        <dd class="num">{fmtHM(line.estimateSec)}</dd>
      </div>
      <div>
        <dt class="label">{timing?.phase === 'finished' ? 'Ended' : 'Projected end'}</dt>
        <dd class="num">
          {fmtClock(timing?.phase === 'finished' ? timing.endedAt : projectedEnd)}
        </dd>
      </div>
    </dl>

    {#if isCurrent && timing?.phase !== 'setup'}
      <div class="progress" class:over>
        <div class="track">
          <span class="fill" style:width="{fill * 100}%"></span>
          {#if over}<span class="overflow" style:width="{overFill * 50}%"></span>{/if}
        </div>
        <span class="num">
          {over
            ? `Over estimate by ${fmtHMS((elapsed - est) / 1000)}`
            : `${fmtHMS((est - elapsed) / 1000)} left on estimate`}
        </span>
      </div>
    {/if}

    {#if captureInfo}
      <div class="capture {captureInfo.tone}">
        <Camera size={15} />
        <span
          >{captureInfo.text}{capture && !live.state.captureBusy
            ? ` · ${relTime(capture.at, live.now)}`
            : ''}</span
        >
        {#if captureInfo.apply && room.canWrite}
          <button class="btn sm" onclick={() => ops.applyCapture()}>Apply stream timer</button>
        {/if}
        <button class="btn ghost sm" onclick={() => ui.openTab('capture')}>Details</button>
      </div>
    {/if}
  {:else}
    <div class="done">
      <h2>No runs on this schedule</h2>
      <p class="muted">
        Check the schedule on {room.ref.source === 'horaro' ? 'Horaro' : 'Oengus'}, then re-import
        it.
      </p>
    </div>
  {/if}
</article>

<style>
  .now {
    padding: 22px 24px;
    display: grid;
    gap: 14px;
    align-content: start;
    min-width: 0;
  }
  .eyebrow {
    display: flex;
    align-items: center;
    gap: 12px;
    flex-wrap: wrap;
  }
  .pill {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    height: 26px;
    padding: 0 12px;
    border-radius: 999px;
    font-family: var(--font-mono);
    font-size: 11px;
    font-weight: 700;
    letter-spacing: 0.14em;
    text-transform: uppercase;
  }
  .pill.live {
    background: var(--bad-soft);
    color: var(--bad);
  }
  .pill.ok {
    background: var(--ok-soft);
    color: var(--ok);
  }
  .pill.idle {
    background: var(--warn-soft);
    color: var(--warn);
  }
  h1 {
    font-size: clamp(28px, 3.4vw, 44px);
    line-height: 1.05;
    font-weight: 800;
    letter-spacing: -0.025em;
    overflow-wrap: anywhere;
  }
  .cat {
    color: var(--text-2);
    font-size: 16px;
    margin-top: -6px;
  }
  .runners {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 10px 16px;
  }
  .runner {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    font-weight: 600;
  }
  .avatar {
    display: grid;
    place-items: center;
    width: 30px;
    height: 30px;
    border-radius: 50%;
    background: oklch(0.42 0.12 var(--h));
    color: oklch(0.95 0.03 var(--h));
    font-size: 13px;
    font-weight: 800;
  }
  .checkin {
    margin-left: auto;
  }
  .facts {
    display: grid;
    grid-template-columns: repeat(4, minmax(0, 1fr));
    gap: 12px;
    margin: 4px 0 0;
    padding: 14px 0;
    border-top: 1px solid var(--border);
    border-bottom: 1px solid var(--border);
  }
  .facts div {
    display: grid;
    gap: 3px;
  }
  dd {
    margin: 0;
    font-size: 19px;
    font-weight: 600;
  }
  dd small {
    font-size: 12px;
    margin-left: 4px;
  }
  .late {
    color: var(--bad);
  }
  .early {
    color: var(--info);
  }
  .progress {
    display: grid;
    gap: 6px;
  }
  .progress .track {
    position: relative;
    display: flex;
    height: 10px;
    border-radius: 10px;
    background: var(--surface-3);
    overflow: hidden;
  }
  .progress .fill {
    background: var(--accent);
    transition: width 0.3s linear;
  }
  .progress.over .fill {
    background: var(--warn);
  }
  .progress .overflow {
    background: var(--bad);
  }
  .progress .num {
    font-size: 13px;
    color: var(--text-2);
  }
  .progress.over .num {
    color: var(--bad);
  }
  .capture {
    display: flex;
    align-items: center;
    gap: 10px;
    flex-wrap: wrap;
    padding: 8px 8px 8px 12px;
    border-radius: var(--radius-sm);
    background: var(--surface-2);
    font-size: 13.5px;
  }
  .capture span {
    flex: 1;
  }
  .capture.ok {
    color: var(--ok);
  }
  .capture.warn {
    color: var(--warn);
    background: var(--warn-soft);
  }
  .capture.muted {
    color: var(--muted);
  }
  .done {
    display: grid;
    justify-items: start;
    gap: 8px;
    padding: 10px 0;
  }
  .done :global(svg) {
    color: var(--accent);
  }
  .done h2 {
    font-size: 28px;
    font-weight: 800;
  }
  @media (max-width: 640px) {
    .facts {
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }
    .checkin {
      margin-left: 0;
      width: 100%;
    }
    .now {
      padding: 18px 16px;
    }
  }
</style>
