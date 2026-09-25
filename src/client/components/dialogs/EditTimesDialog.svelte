<script lang="ts">
  import { untrack } from 'svelte';
  import { lineTitle } from '../../../shared/derive.ts';
  import { fmtHMS, parseDurationInput } from '../../../shared/time.ts';
  import { clock } from '../../lib/clock.svelte.ts';
  import { getLive, getOps } from '../../lib/live.svelte.ts';
  import { ui } from '../../lib/ui.svelte.ts';
  import Dialog from '../ui/Dialog.svelte';

  const live = getLive();
  const ops = getOps();

  let open = $state(false);
  let start = $state('');
  let end = $state('');
  let duration = $state('');

  const line = $derived(live.lines.find((l) => l.key === ui.editTimes) ?? null);
  const isCurrent = $derived(!!line && line.key === live.state.currentKey);

  // <input type="datetime-local"> speaks local wall time without a zone.
  const pad = (n: number) => String(n).padStart(2, '0');
  function toLocal(ms: number | undefined): string {
    if (ms == null) return '';
    const d = new Date(ms);
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
  }
  function fromLocal(value: string): number | null {
    if (!value) return null;
    const ms = new Date(value).getTime();
    return Number.isFinite(ms) ? ms : null;
  }

  // Load the record once when the dialog opens; afterwards the fields are yours.
  $effect(() => {
    const key = ui.editTimes;
    open = key != null;
    if (key == null) return;
    const rec = untrack(() => live.state.runs[key]);
    start = toLocal(rec?.startedAt);
    end = toLocal(rec?.endedAt);
    duration = rec?.startedAt && rec.endedAt ? fmtHMS((rec.endedAt - rec.startedAt) / 1000) : '';
  });

  function onStartOrEnd() {
    const s = fromLocal(start);
    const e = fromLocal(end);
    if (s != null && e != null && e >= s) duration = fmtHMS((e - s) / 1000);
  }
  function onDuration() {
    const s = fromLocal(start);
    const d = parseDurationInput(duration);
    if (d == null) return;
    if (s != null) end = toLocal(s + d * 1000);
    else if (fromLocal(end) != null) start = toLocal(fromLocal(end)! - d * 1000);
  }

  const error = $derived.by(() => {
    const s = fromLocal(start);
    const e = fromLocal(end);
    if (duration && parseDurationInput(duration) == null)
      return 'Duration should look like 1:02:03.';
    if (e != null && s == null) return 'Set a start time before an end time.';
    if (s != null && e != null && e < s) return 'The end is before the start.';
    if (s != null && s > clock.now + 60_000) return 'The start is in the future.';
    if (s != null && e == null && !isCurrent)
      return 'Only the live run can be left without an end.';
    return null;
  });

  function save() {
    if (!line || error) return;
    if (ops.editTimes(line.key, fromLocal(start), fromLocal(end))) ui.editTimes = null;
  }
</script>

{#if line}
  <Dialog
    bind:open
    title="Edit times"
    subtitle={lineTitle(line)}
    size="sm"
    onclose={() => (ui.editTimes = null)}
  >
    <form
      class="form"
      onsubmit={(e) => {
        e.preventDefault();
        save();
      }}
    >
      <label class="field">
        <span class="label">Started</span>
        <div class="row">
          <input
            class="input num"
            type="datetime-local"
            step="1"
            bind:value={start}
            onchange={onStartOrEnd}
          />
          <button
            type="button"
            class="btn sm"
            onclick={() => ((start = toLocal(clock.read())), onStartOrEnd())}>Now</button
          >
        </div>
      </label>
      <label class="field">
        <span class="label">Ended</span>
        <div class="row">
          <input
            class="input num"
            type="datetime-local"
            step="1"
            bind:value={end}
            onchange={onStartOrEnd}
          />
          <button
            type="button"
            class="btn sm"
            onclick={() => ((end = toLocal(clock.read())), onStartOrEnd())}>Now</button
          >
        </div>
        {#if isCurrent}<span class="hint">Leave empty while the run is still going.</span>{/if}
      </label>
      <label class="field">
        <span class="label">Duration</span>
        <input
          class="input num"
          placeholder="1:02:03"
          bind:value={duration}
          onchange={onDuration}
        />
        <span class="hint">Fill in any two; the third is worked out for you.</span>
      </label>
      {#if error}<p class="error">{error}</p>{/if}
      <button type="submit" hidden aria-label="Save"></button>
    </form>
    {#snippet footer()}
      <button
        class="btn ghost"
        onclick={() => {
          start = '';
          end = '';
          duration = '';
        }}>Clear times</button
      >
      <span style="flex:1"></span>
      <button class="btn ghost" onclick={() => (ui.editTimes = null)}>Cancel</button>
      <button class="btn primary" disabled={!!error} onclick={save}>Save</button>
    {/snippet}
  </Dialog>
{/if}

<style>
  .form {
    display: grid;
    gap: 16px;
  }
  .row {
    display: flex;
    gap: 8px;
  }
  .error {
    color: var(--bad);
    font-size: 13.5px;
  }
</style>
