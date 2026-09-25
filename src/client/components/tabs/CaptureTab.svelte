<script lang="ts">
  import { Camera, Download, Eye, EyeOff, LoaderCircle } from '@lucide/svelte';
  import { untrack } from 'svelte';
  import { roomPath } from '../../../shared/sources.ts';
  import { fmtClock, fmtDelta, fmtHMS, relTime } from '../../lib/format.ts';
  import { getLive, getOps } from '../../lib/live.svelte.ts';
  import { getRoom } from '../../lib/room.svelte.ts';

  const room = getRoom();
  const live = getLive();
  const ops = getOps();

  const c = $derived(live.state.capture);
  const busy = $derived(live.state.captureBusy);
  const frameUrl = $derived(
    c && !c.error ? `/api/rooms${roomPath(room.ref)}/frames/${c.id}` : null,
  );
  const mismatch = $derived(!!c?.runKey && !!c.currentKey && c.runKey !== c.currentKey);
  const drifting = $derived(
    c?.driftSec != null && Math.abs(c.driftSec) > live.state.drift.thresholdSec,
  );
  /** The live run changed since this capture; applying it would rewind the marathon. */
  const stale = $derived(!!c && c.currentKey !== live.state.currentKey);
  const canApply = $derived(!!c && !c.error && c.elapsedSec != null && !stale);

  // Local drafts: other operators' changes never clobber what you're typing.
  let channel = $state(live.state.twitchChannel);
  let channelDirty = $state(false);
  const serverChannel = $derived(live.state.twitchChannel);
  $effect(() => {
    const server = serverChannel;
    if (!untrack(() => channelDirty)) channel = server;
  });

  let driftEnabled = $state(live.state.drift.enabled);
  let intervalMin = $state(live.state.drift.intervalMin);
  let thresholdSec = $state(live.state.drift.thresholdSec);
  // A string only changes when the settings do, not on every state broadcast.
  const serverDrift = $derived(
    `${live.state.drift.enabled}|${live.state.drift.intervalMin}|${live.state.drift.thresholdSec}`,
  );
  $effect(() => {
    const [enabled, interval, threshold] = serverDrift.split('|');
    driftEnabled = enabled === 'true';
    intervalMin = Number(interval);
    thresholdSec = Number(threshold);
  });

  let showPlayer = $state(false);
  const activeChannel = $derived(live.state.twitchChannel || room.schedule?.twitch || '');

  function saveChannel(e: SubmitEvent) {
    e.preventDefault();
    ops.setTwitch(channel);
    channelDirty = false;
  }

  /** Whole number within range; blank or junk falls back to the current setting. */
  function clampInt(value: number, min: number, max: number, fallback: number): number {
    const n = Math.round(Number(value));
    return Number.isFinite(n) && n > 0 ? Math.min(max, Math.max(min, n)) : fallback;
  }

  function saveDrift() {
    intervalMin = clampInt(intervalMin, 1, 60, live.state.drift.intervalMin);
    thresholdSec = clampInt(thresholdSec, 2, 600, live.state.drift.thresholdSec);
    ops.configureDrift(driftEnabled, intervalMin, thresholdSec);
  }
</script>

<div class="grid">
  <section class="result">
    <div class="frame" class:busy>
      {#if frameUrl}<img src={frameUrl} alt="Captured stream frame" />{/if}
      {#if busy}
        <div class="overlay">
          <LoaderCircle size={28} class="spin" />
          <strong>Capturing…</strong>
          <span>streamlink → ffmpeg → Claude. Usually 5–10 seconds.</span>
        </div>
      {:else if !c}
        <div class="overlay">
          <Camera size={28} />
          <strong>No capture yet</strong>
          <span>Grab a frame from the stream and compare its timer with ours.</span>
        </div>
      {:else if c.error}
        <div class="overlay error">
          <strong>Capture failed</strong>
          <span>{c.error}</span>
        </div>
      {/if}
      {#if c && !busy}
        <span class="stamp num"
          >{fmtClock(c.at, true)} · {c.auto ? 'auto' : (c.by ?? 'manual')} · {c.channel}</span
        >
      {/if}
    </div>

    <div class="actions">
      <button
        class="btn primary"
        disabled={!room.canWrite || busy || !activeChannel}
        onclick={() => ops.capture()}
      >
        <Camera size={16} />
        {busy ? 'Capturing…' : 'Capture now'}
      </button>
      {#if !activeChannel}<span class="hint">Set a Twitch channel first.</span>{/if}
    </div>

    {#if c && !c.error && !busy}
      <div class="reading" class:warn={mismatch || drifting}>
        <div class="cells">
          <div>
            <span class="label">Stream timer</span>
            <b class="num">{c.elapsedSec != null ? fmtHMS(c.elapsedSec) : 'not found'}</b>
          </div>
          <div>
            <span class="label">Our timer then</span>
            <b class="num">{c.ourElapsedSec != null ? fmtHMS(c.ourElapsedSec) : '—'}</b>
          </div>
          <div>
            <span class="label">Drift</span>
            <b class="num" class:bad={drifting} class:ok={c.driftSec != null && !drifting}>
              {c.driftSec != null ? fmtDelta(c.driftSec) : '—'}
            </b>
          </div>
          <div>
            <span class="label">Game</span>
            <b>{c.game ?? 'not recognised'}</b>
            {#if c.confidence}<small>{c.confidence} confidence</small>{/if}
          </div>
        </div>
        <p class="verdict">
          {#if mismatch}
            The stream shows <b>{live.titleOf(c.runKey)}</b>, but the current run was
            <b>{live.titleOf(c.currentKey)}</b>. Applying will switch to it.
          {:else if drifting}
            Our timer is {Math.abs(c.driftSec ?? 0)}s {(c.driftSec ?? 0) > 0
              ? 'behind'
              : 'ahead of'} the stream.
          {:else if c.driftSec != null}
            In sync with the stream (within ±{live.state.drift.thresholdSec}s).
          {:else if c.elapsedSec != null}
            The timer on stream reads {fmtHMS(c.elapsedSec)}. Our timer hadn’t started.
          {:else}
            Couldn’t find a run timer in this frame.
          {/if}
          <span class="muted">Captured {relTime(c.at, live.now)}.</span>
        </p>
        {#if stale && !c.error}
          <p class="hint">
            The live run has changed since this capture. Capture again to apply it.
          </p>
        {/if}
        {#if canApply}
          <button
            class="btn {mismatch || drifting ? 'primary' : ''}"
            disabled={!room.canWrite}
            onclick={() => ops.applyCapture()}
          >
            <Download size={16} /> Apply stream timer{c.runKey && c.runKey !== live.current?.key
              ? ` to ${live.titleOf(c.runKey)}`
              : ''}
          </button>
          <p class="hint">
            Sets the timer from the frame’s capture time, so processing delay doesn’t matter.
          </p>
        {/if}
      </div>
    {/if}
  </section>

  <aside class="settings">
    <form class="card box" onsubmit={saveChannel}>
      <h3>Twitch channel</h3>
      <div class="row">
        <input
          class="input"
          placeholder={room.schedule?.twitch || 'channel or twitch.tv/…'}
          bind:value={channel}
          oninput={() => (channelDirty = true)}
          disabled={!room.canWrite}
        />
        <button class="btn" type="submit" disabled={!room.canWrite || !channelDirty}>Save</button>
      </div>
      {#if !live.state.twitchChannel && room.schedule?.twitch}
        <p class="hint">
          Using the marathon’s channel from {room.ref.source === 'horaro' ? 'Horaro' : 'Oengus'}: {room
            .schedule.twitch}
        </p>
      {/if}
      {#if activeChannel}
        <button class="btn ghost sm" type="button" onclick={() => (showPlayer = !showPlayer)}>
          {#if showPlayer}<EyeOff size={14} /> Hide stream{:else}<Eye size={14} /> Watch stream{/if}
        </button>
      {/if}
    </form>

    {#if showPlayer && activeChannel}
      <div class="player">
        <iframe
          title="Twitch stream"
          src="https://player.twitch.tv/?channel={encodeURIComponent(
            activeChannel,
          )}&parent={location.hostname}&muted=true"
          allow="autoplay; fullscreen"
        ></iframe>
      </div>
    {/if}

    <div class="card box">
      <h3>Auto drift check</h3>
      <p class="hint">
        While a run is live, capture the stream every few minutes and log a warning if the timers
        drift apart or the stream shows a different run. Each capture costs roughly $0.01.
      </p>
      <label class="toggle">
        <input
          type="checkbox"
          bind:checked={driftEnabled}
          disabled={!room.canWrite}
          onchange={saveDrift}
        />
        <span>{driftEnabled ? 'On' : 'Off'}</span>
      </label>
      <div class="row two">
        <label class="field">
          <span class="label">Every (minutes)</span>
          <input
            class="input"
            type="number"
            min="1"
            max="60"
            bind:value={intervalMin}
            disabled={!room.canWrite}
            onchange={saveDrift}
          />
        </label>
        <label class="field">
          <span class="label">Warn beyond (seconds)</span>
          <input
            class="input"
            type="number"
            min="2"
            max="600"
            bind:value={thresholdSec}
            disabled={!room.canWrite}
            onchange={saveDrift}
          />
        </label>
      </div>
    </div>
  </aside>
</div>

<style>
  .grid {
    display: grid;
    grid-template-columns: minmax(0, 1.6fr) minmax(280px, 1fr);
    gap: 24px;
  }
  .frame {
    position: relative;
    aspect-ratio: 16 / 9;
    border-radius: var(--radius);
    overflow: hidden;
    background: #050608;
    border: 1px solid var(--border);
  }
  .frame img {
    width: 100%;
    height: 100%;
    object-fit: cover;
  }
  .frame.busy img {
    filter: blur(3px) brightness(0.5);
  }
  .overlay {
    position: absolute;
    inset: 0;
    display: grid;
    place-content: center;
    justify-items: center;
    gap: 8px;
    padding: 24px;
    text-align: center;
    color: var(--text-2);
  }
  .overlay span {
    color: var(--muted);
    font-size: 13.5px;
    max-width: 380px;
  }
  .overlay.error strong {
    color: var(--bad);
  }
  .overlay :global(.spin) {
    animation: spin 1s linear infinite;
    color: var(--accent);
  }
  @keyframes spin {
    to {
      transform: rotate(360deg);
    }
  }
  .stamp {
    position: absolute;
    left: 10px;
    bottom: 10px;
    padding: 3px 8px;
    border-radius: 5px;
    background: rgb(0 0 0 / 0.7);
    font-size: 11.5px;
    color: #fff;
  }
  .actions {
    display: flex;
    align-items: center;
    gap: 12px;
    margin: 14px 0;
  }
  .reading {
    display: grid;
    gap: 14px;
    justify-items: start;
    padding: 18px;
    border-radius: var(--radius);
    border: 1px solid var(--border);
    background: var(--surface);
  }
  .reading.warn {
    border-color: color-mix(in oklab, var(--warn) 45%, transparent);
    background: color-mix(in oklab, var(--warn) 6%, var(--surface));
  }
  .cells {
    display: grid;
    grid-template-columns: repeat(4, minmax(0, 1fr));
    gap: 16px;
    width: 100%;
  }
  .cells div {
    display: grid;
    gap: 3px;
    align-content: start;
  }
  .cells b {
    font-size: 20px;
  }
  .cells small {
    color: var(--muted);
    font-size: 12px;
  }
  .bad {
    color: var(--bad);
  }
  .ok {
    color: var(--ok);
  }
  .verdict {
    color: var(--text-2);
  }
  .settings {
    display: grid;
    gap: 16px;
    align-content: start;
  }
  .box {
    padding: 16px;
    display: grid;
    gap: 10px;
    box-shadow: none;
  }
  h3 {
    font-size: 15px;
  }
  .row {
    display: flex;
    gap: 8px;
  }
  .row.two > * {
    flex: 1;
  }
  .toggle {
    display: inline-flex;
    align-items: center;
    gap: 10px;
    font-weight: 600;
    cursor: pointer;
  }
  .toggle input {
    width: 18px;
    height: 18px;
    accent-color: var(--accent);
  }
  .player {
    aspect-ratio: 16 / 9;
    border-radius: var(--radius);
    overflow: hidden;
    border: 1px solid var(--border);
  }
  .player iframe {
    width: 100%;
    height: 100%;
    border: 0;
  }
  @media (max-width: 1000px) {
    .grid {
      grid-template-columns: 1fr;
    }
    .cells {
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }
  }
</style>
