<script lang="ts">
  import { Check, Clock, CloudOff, TriangleAlert, X } from '@lucide/svelte';
  import { tick, untrack } from 'svelte';
  import { indexOfKey, lineTitle } from '../../shared/derive.ts';
  import { etaText, linkIsValid, selfCheckIn } from '../lib/checkin.ts';
  import { haptic } from '../lib/device.ts';
  import { checkInState, fmtDuration, fmtHM, fmtWhen } from '../lib/format.ts';
  import { getLive } from '../lib/live.svelte.ts';
  import { getRoom } from '../lib/room.svelte.ts';

  /**
   * The page behind a runner's check-in link: their run, when it's expected to
   * start, and two buttons — "I'm here" and "Running late" — plus a way to take
   * back what they said (not what an organiser set). Runners aren't
   * operators: the link's token is what lets them post (lib/checkin.ts), and only
   * for this run. The rest of the page is the same live state any viewer sees.
   */
  let { runKey, token }: { runKey: string; token: string } = $props();

  const room = getRoom();
  const live = getLive();

  const index = $derived(indexOfKey(live.lines, runKey));
  const line = $derived(live.lines[index] ?? null);
  const rec = $derived(line ? live.state.runs[line.key] : undefined);
  const ci = $derived(checkInState(rec));
  const expected = $derived(live.projection[index]?.start ?? line?.scheduledStart ?? null);
  const stage = $derived(
    !line || line.setupBlock
      ? 'gone'
      : rec?.skipped
        ? 'skipped'
        : rec?.startedAt != null && rec.endedAt == null
          ? 'live'
          : rec?.startedAt != null || live.phase === 'complete'
            ? 'done'
            : 'upcoming',
  );

  /** Whether the server accepts this link: null while asking, or when it couldn't be asked. */
  let valid = $state<boolean | null>(null);
  $effect(() => {
    const t = token;
    let current = true;
    valid = null;
    void linkIsValid(room.ref, runKey, t).then((v) => current && (valid = v));
    return () => {
      current = false;
    };
  });

  const MINUTES = [
    { value: '5', label: '5 min' },
    { value: '10', label: '10 min' },
    { value: '15', label: '15 min' },
    { value: '30', label: '30 min' },
    { value: '45', label: '45 min' },
    { value: '60', label: '1 hour' },
    { value: 'unsure', label: 'Not sure' },
  ];
  let telling = $state(false);
  let away = $state('15');
  const minutes = $derived(away === 'unsure' ? null : Number(away));
  /** Read out after each send: the confirmation cards appear later, with the broadcast. */
  let announcement = $state('');
  let runHeading = $state<HTMLElement>();
  let formHeading = $state<HTMLElement>();
  let note = $state('');
  let busy = $state(false);
  let error = $state<string | null>(null);
  const canSend = $derived(room.synced && valid !== false && !busy && stage === 'upcoming');
  /** What they said themselves can be taken back; what an organiser set (no `selfAt`) can't. */
  const canClear = $derived((ci === 'ready' || ci === 'late') && rec?.selfAt != null);

  async function startLate() {
    // Seed the form from what they said last time, without tracking later broadcasts.
    const late = untrack(() => rec?.late);
    note = late?.note ?? '';
    telling = true;
    error = null;
    await tick();
    formHeading?.focus();
  }

  async function cancelLate() {
    telling = false;
    await tick();
    runHeading?.focus();
  }

  async function send(body: Parameters<typeof selfCheckIn>[2]) {
    busy = true;
    error = null;
    announcement = '';
    haptic(10);
    try {
      await selfCheckIn(room.ref, runKey, body);
      telling = false;
      announcement =
        body.status === 'ready'
          ? 'You’re checked in.'
          : body.status === 'clear'
            ? 'Your check-in is cleared.'
            : 'Thanks. The organisers know you’re running late.';
      // The button pressed is gone now; don't leave focus nowhere.
      await tick();
      runHeading?.focus();
    } catch (err) {
      error = (err as Error).message;
    } finally {
      busy = false;
    }
  }
</script>

<main class="checkin">
  <p class="visually-hidden" role="status" aria-live="polite">{announcement}</p>
  <header>
    <span class="label">Runner check-in</span>
    <h1>{room.schedule?.eventName}</h1>
    <p class="muted">{room.schedule?.scheduleName}</p>
  </header>

  {#if valid === false}
    <section class="card notice bad" role="alert">
      <TriangleAlert size={20} />
      <div>
        <h2>This link isn’t valid</h2>
        <p>It may be for another schedule, or out of date. Ask an organiser for a new one.</p>
      </div>
    </section>
  {:else if !line || stage === 'gone'}
    <section class="card notice bad" role="alert">
      <TriangleAlert size={20} />
      <div>
        <h2>This run isn’t on the schedule any more</h2>
        <p>Talk to an organiser.</p>
      </div>
    </section>
  {:else}
    <section class="card run" aria-label="Your run">
      <span class="label">Your run</span>
      <h2 tabindex="-1" bind:this={runHeading}>{lineTitle(line)}</h2>
      {#if line.category || line.runners.length}
        <p class="muted">
          {[line.category, line.runners.join(', ')].filter(Boolean).join(' · ')}
        </p>
      {/if}
      {#if stage === 'upcoming'}
        <dl>
          <dt>Expected start</dt>
          <dd class="num">
            {fmtWhen(expected, live.now)}
            {#if expected != null && expected > live.now}<small
                >in {fmtDuration((expected - live.now) / 1000)}</small
              >{/if}
          </dd>
          {#if line.scheduledStart != null && expected !== line.scheduledStart}
            <dt>Scheduled</dt>
            <dd class="num">{fmtWhen(line.scheduledStart, live.now)}</dd>
          {/if}
          <dt>Estimate</dt>
          <dd class="num">{fmtHM(line.estimateSec)}</dd>
        </dl>
      {/if}
    </section>

    {#if stage === 'upcoming' && !telling}
      <section class="card how" aria-label="How it works">
        <span class="label">How it works</span>
        <ul>
          <li>Check in here 1–2 hours before your run, once you’re ready to go.</li>
          <li>Running late? Tell the organisers roughly how far away you are.</li>
          <li>Checked in too early, or by mistake? Clear it and check in again later.</li>
        </ul>
      </section>
    {/if}

    {#if stage === 'live'}
      <section class="card notice ok">
        <Check size={20} />
        <div>
          <h2>You’re live. Good luck!</h2>
        </div>
      </section>
    {:else if stage === 'done'}
      <section class="card notice">
        <Check size={20} />
        <div>
          <h2>Your run is done</h2>
          <p>Thanks for running!</p>
        </div>
      </section>
    {:else if stage === 'skipped'}
      <section class="card notice bad" role="status">
        <TriangleAlert size={20} />
        <div>
          <h2>This run was taken off the schedule</h2>
          <p>Talk to an organiser.</p>
        </div>
      </section>
    {:else if telling}
      <form
        class="card late-form"
        aria-label="Running late"
        onsubmit={(e) => {
          e.preventDefault();
          void send({ t: token, status: 'late', minutes, note: note.trim() });
        }}
      >
        <h2 id="away-label" tabindex="-1" bind:this={formHeading}>How far away are you?</h2>
        <div class="minutes" role="radiogroup" aria-labelledby="away-label">
          {#each MINUTES as m (m.value)}
            <label class="choice">
              <input type="radio" name="away" value={m.value} bind:group={away} />
              <span>{m.label}</span>
            </label>
          {/each}
        </div>
        <label class="field">
          <span class="label">Anything to add? (optional)</span>
          <input
            class="input"
            maxlength="140"
            placeholder="Train delayed, here for setup"
            bind:value={note}
          />
        </label>
        <div class="actions">
          <button class="btn primary lg" type="submit" disabled={!canSend}>
            <Clock size={18} /> Tell the organisers
          </button>
          <button class="btn ghost lg" type="button" onclick={cancelLate}>Cancel</button>
        </div>
      </form>
    {:else}
      {#if ci === 'ready'}
        <section class="card notice ok">
          <Check size={20} />
          <div>
            <h2>You’re checked in</h2>
            <p>The organisers can see you’re here. Stay close until you’re called.</p>
          </div>
        </section>
      {:else if ci === 'late' && rec?.late}
        <section class="card notice warn">
          <Clock size={20} />
          <div>
            <h2>The organisers know you’re on your way</h2>
            <p>
              {etaText(rec.late, live.now)}{rec.late.note ? ` · “${rec.late.note}”` : ''}
            </p>
          </div>
        </section>
      {:else if ci === 'missing'}
        <section class="card notice bad" role="status">
          <TriangleAlert size={20} />
          <div>
            <h2>The organisers are looking for you</h2>
            <p>Let them know you’re here, or that you’re on your way.</p>
          </div>
        </section>
      {/if}

      <div class="actions main">
        {#if ci !== 'ready'}
          <button
            class="btn primary xl"
            disabled={!canSend}
            onclick={() => send({ t: token, status: 'ready' })}
          >
            <Check size={22} />
            {ci === 'late' ? 'I’m here now' : 'I’m here'}
          </button>
        {/if}
        <button
          class="btn {ci === 'ready' ? 'ghost' : ''} xl"
          disabled={!canSend}
          onclick={startLate}
        >
          <Clock size={20} />
          {ci === 'late'
            ? 'Update my ETA'
            : ci === 'ready'
              ? 'Actually, I’m running late'
              : 'Running late'}
        </button>
        {#if canClear}
          <button
            class="btn ghost lg"
            disabled={!canSend}
            onclick={() => send({ t: token, status: 'clear' })}
          >
            <X size={18} /> Clear my check-in
          </button>
        {/if}
      </div>
    {/if}

    {#if error}<p class="error" role="alert">{error}</p>{/if}
    {#if !room.synced && stage === 'upcoming'}
      <p class="offline" role="status">
        <CloudOff size={16} />
        {room.status === 'open'
          ? 'Connecting…'
          : 'No connection. Check in once you’re back online.'}
      </p>
    {/if}
    <p class="foot muted">
      Your check-in, and anything you add, shows on the organisers’ screens and to anyone following
      the schedule.
    </p>
  {/if}
</main>

<style>
  .checkin {
    max-width: 480px;
    margin: 0 auto;
    padding: calc(24px + env(safe-area-inset-top, 0px)) 16px
      calc(32px + env(safe-area-inset-bottom, 0px));
    display: grid;
    gap: 14px;
  }
  header {
    display: grid;
    gap: 2px;
    margin-bottom: 4px;
  }
  h1 {
    font-size: 24px;
    line-height: 1.2;
  }
  h2 {
    font-size: 17px;
    line-height: 1.3;
  }
  .run {
    display: grid;
    gap: 6px;
    padding: 18px;
  }
  .how {
    display: grid;
    gap: 6px;
    padding: 14px 18px;
    box-shadow: none;
  }
  .how ul {
    display: grid;
    gap: 4px;
    margin: 0;
    padding-left: 18px;
    color: var(--text-2);
    font-size: 14px;
  }
  .run h2 {
    font-size: 22px;
  }
  dl {
    display: grid;
    grid-template-columns: auto 1fr;
    gap: 6px 16px;
    margin: 10px 0 0;
  }
  dt {
    color: var(--muted);
    font-size: 13.5px;
  }
  dd {
    margin: 0;
    font-weight: 600;
  }
  dd small {
    margin-left: 6px;
    color: var(--muted);
    font-weight: 500;
  }
  .notice {
    display: flex;
    gap: 12px;
    align-items: flex-start;
    padding: 16px 18px;
    box-shadow: none;
  }
  .notice > :global(svg) {
    flex: none;
    margin-top: 1px;
  }
  .notice div {
    display: grid;
    gap: 2px;
  }
  .notice p {
    color: var(--text-2);
    font-size: 14px;
  }
  .notice.ok {
    border-color: color-mix(in oklab, var(--ok) 40%, transparent);
    background: var(--ok-soft);
  }
  .notice.ok > :global(svg) {
    color: var(--ok);
  }
  .notice.warn {
    border-color: color-mix(in oklab, var(--warn) 40%, transparent);
    background: var(--warn-soft);
  }
  .notice.warn > :global(svg) {
    color: var(--warn);
  }
  .notice.bad {
    border-color: color-mix(in oklab, var(--bad) 40%, transparent);
    background: var(--bad-soft);
  }
  .notice.bad > :global(svg) {
    color: var(--bad);
  }
  .actions {
    display: grid;
    gap: 10px;
  }
  .btn.xl {
    min-height: 60px;
    font-size: 17px;
    border-radius: var(--radius-lg);
  }
  .late-form {
    display: grid;
    gap: 14px;
    padding: 18px;
  }
  .minutes {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(88px, 1fr));
    gap: 8px;
  }
  .choice {
    position: relative;
    display: grid;
    place-items: center;
    min-height: 48px;
    border-radius: var(--radius);
    border: 1px solid var(--border-strong);
    background: var(--surface-2);
    font-weight: 600;
    cursor: pointer;
  }
  .choice input {
    position: absolute;
    inset: 0;
    opacity: 0;
    margin: 0;
    cursor: pointer;
  }
  .choice:has(input:checked) {
    border-color: var(--warn);
    background: var(--warn-soft);
    color: var(--warn);
  }
  .choice:has(input:focus-visible) {
    box-shadow: var(--ring);
  }
  h2[tabindex='-1']:focus {
    outline: none;
  }
  .error {
    color: var(--bad);
    font-weight: 600;
  }
  .offline {
    display: flex;
    align-items: center;
    gap: 8px;
    color: var(--warn);
    font-size: 14px;
  }
  .foot {
    font-size: 12.5px;
    text-align: center;
  }
</style>
