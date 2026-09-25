<script lang="ts">
  import { Pencil, Play, RotateCcw, SkipForward } from '@lucide/svelte';
  import { indexOfKey, lineTitle } from '../../../shared/derive.ts';
  import type { CheckIn } from '../../../shared/types.ts';
  import {
    fmtClock,
    fmtDay,
    fmtHM,
    fmtHMS,
    fmtOffsetShort,
    hueOf,
    initials,
    runStatus,
  } from '../../lib/format.ts';
  import { getLive, getOps } from '../../lib/live.svelte.ts';
  import { getRoom } from '../../lib/room.svelte.ts';
  import { ui } from '../../lib/ui.svelte.ts';
  import Dialog from '../ui/Dialog.svelte';
  import Segmented from '../ui/Segmented.svelte';

  const room = getRoom();
  const live = getLive();
  const ops = getOps();

  const index = $derived(indexOfKey(live.lines, ui.runSheet));
  const line = $derived(live.lines[index] ?? null);
  const rec = $derived(line ? live.state.runs[line.key] : undefined);
  const status = $derived(runStatus(live, index));
  const projected = $derived(live.projection[index]);
  const checkIn = $derived<CheckIn | 'none'>(rec?.checkIn ?? 'none');
  const disabled = $derived(!room.canWrite);

  const STATUS_TEXT = {
    current: 'Live now',
    done: 'Done',
    skipped: 'Skipped',
    upcoming: 'Upcoming',
    setup: 'Interlude',
  };
  const CHECK_OPTIONS = [
    { value: 'none', label: 'Not checked' },
    { value: 'ready', label: 'Ready', tone: 'ok' },
    { value: 'missing', label: 'Missing', tone: 'bad' },
  ] as const;

  function close() {
    ui.runSheet = null;
  }
</script>

{#if line}
  <Dialog
    bind:open={() => ui.runSheet != null, (v) => !v && close()}
    variant="sheet"
    title={lineTitle(line)}
    subtitle={[line.category, line.console].filter(Boolean).join(' · ') || undefined}
    onclose={close}
  >
    <div class="status">
      <span class="chip {status === 'current' ? 'accent' : status === 'skipped' ? 'warn' : ''}"
        >{STATUS_TEXT[status]}</span
      >
      {#if line.type !== 'SINGLE' && !line.setupBlock}<span class="chip info"
          >{line.type.toLowerCase()}</span
        >{/if}
    </div>

    {#if !line.setupBlock}
      <section>
        <h4 class="label">Runners</h4>
        <ul class="runners">
          {#each line.runners as name (name)}
            <li><span class="avatar" style:--h={hueOf(name)}>{initials(name)}</span>{name}</li>
          {:else}
            <li class="muted">No runners listed</li>
          {/each}
        </ul>
        <Segmented
          label="Check-in"
          options={CHECK_OPTIONS}
          value={checkIn}
          {disabled}
          onchange={(v) => ops.checkIn(line.key, v === 'none' ? null : v)}
        />
      </section>
    {/if}

    <section>
      <h4 class="label">Timing</h4>
      <dl>
        <dt>Estimate</dt>
        <dd class="num">
          {fmtHM(line.estimateSec)}{line.setupSec ? ` + ${fmtHM(line.setupSec)} setup` : ''}
        </dd>
        <dt>Scheduled</dt>
        <dd class="num">
          {line.scheduledStart
            ? `${fmtDay(line.scheduledStart)} ${fmtClock(line.scheduledStart)}`
            : '—'}
        </dd>
        {#if projected && status !== 'done'}
          <dt>{status === 'current' ? 'Projected end' : 'Projected start'}</dt>
          <dd class="num">
            {fmtClock(status === 'current' ? projected.end : projected.start)}
            {#if status !== 'current' && line.scheduledStart != null}
              <small>{fmtOffsetShort((projected.start - line.scheduledStart) / 1000)}</small>
            {/if}
          </dd>
        {/if}
        {#if rec?.startedAt}
          <dt>Started</dt>
          <dd class="num">{fmtClock(rec.startedAt, true)}</dd>
        {/if}
        {#if rec?.startedAt && rec.endedAt}
          <dt>Ended</dt>
          <dd class="num">
            {fmtClock(rec.endedAt, true)}
            <small>{fmtHMS((rec.endedAt - rec.startedAt) / 1000)}</small>
          </dd>
        {/if}
      </dl>
    </section>

    {#snippet footer()}
      {#if !line.setupBlock}
        {#if rec?.skipped}
          <button class="btn" {disabled} onclick={() => ops.unskip(line.key)}
            ><RotateCcw size={15} /> Restore</button
          >
        {:else if status !== 'done'}
          <button
            class="btn ghost"
            {disabled}
            onclick={() => {
              ops.skip(line.key);
              close();
            }}><SkipForward size={15} /> Skip</button
          >
        {/if}
        <button class="btn" {disabled} onclick={() => (ui.editTimes = line.key)}
          ><Pencil size={15} /> Edit times</button
        >
        {#if status !== 'current' && !rec?.skipped}
          <button
            class="btn primary"
            {disabled}
            onclick={() => {
              ops.select(line.key);
              close();
            }}
          >
            <Play size={15} /> Make current
          </button>
        {/if}
      {/if}
    {/snippet}
  </Dialog>
{/if}

<style>
  .status {
    display: flex;
    gap: 8px;
    margin-bottom: 18px;
  }
  section {
    display: grid;
    gap: 10px;
    margin-bottom: 22px;
  }
  .runners {
    list-style: none;
    margin: 0;
    padding: 0;
    display: grid;
    gap: 8px;
  }
  .runners li {
    display: flex;
    align-items: center;
    gap: 10px;
    font-weight: 600;
  }
  .avatar {
    display: grid;
    place-items: center;
    width: 28px;
    height: 28px;
    border-radius: 50%;
    background: oklch(0.42 0.12 var(--h));
    color: oklch(0.95 0.03 var(--h));
    font-size: 12px;
    font-weight: 800;
  }
  dl {
    display: grid;
    grid-template-columns: auto 1fr;
    gap: 8px 18px;
    margin: 0;
  }
  dt {
    color: var(--muted);
    font-size: 13.5px;
  }
  dd {
    margin: 0;
    font-size: 14px;
  }
  dd small {
    color: var(--muted);
    margin-left: 6px;
  }
</style>
