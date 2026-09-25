<script lang="ts">
  import { Megaphone, MessageSquare, Send, X } from '@lucide/svelte';
  import { fmtClock, relTime } from '../../lib/format.ts';
  import { getLive, getOps } from '../../lib/live.svelte.ts';
  import { getRoom } from '../../lib/room.svelte.ts';

  const room = getRoom();
  const live = getLive();
  const ops = getOps();

  const COLORS = [
    '#fbbf24',
    '#f87171',
    '#34d399',
    '#22d3ee',
    '#60a5fa',
    '#a78bfa',
    '#f472b6',
    '#eceff4',
  ];
  const PRESETS = [
    'Please hold',
    'Technical difficulties',
    'Be right back',
    'Runner change',
    'Break time',
  ];

  // Drafts start from what's live, then belong to you until you send them.
  let annText = $state(live.state.announcement?.text ?? '');
  let annColor = $state(live.state.announcement?.color ?? COLORS[0]!);
  let msgText = $state(live.state.message?.text ?? '');
  let msgColor = $state(live.state.message?.color ?? COLORS[0]!);

  const ann = $derived(live.state.announcement);
  const msg = $derived(live.state.message);
</script>

<div class="grid">
  <section class="card box">
    <header>
      <Megaphone size={18} />
      <div>
        <h3>Announcement banner</h3>
        <p class="hint">
          Pinned across the top of every operator’s screen, for things the whole team must see.
        </p>
      </div>
    </header>
    <textarea
      class="textarea"
      maxlength="500"
      placeholder="e.g. Donation incentive closes at 18:00"
      bind:value={annText}
      disabled={!room.canWrite}></textarea>
    {@render swatches(annColor, (c) => (annColor = c))}
    <div class="row">
      <button
        class="btn primary"
        disabled={!room.canWrite || !annText.trim()}
        onclick={() => ops.setAnnouncement(annText.trim(), annColor)}
      >
        <Send size={15} />
        {ann ? 'Update banner' : 'Show banner'}
      </button>
      {#if ann}
        <button class="btn ghost" disabled={!room.canWrite} onclick={() => ops.clearAnnouncement()}
          ><X size={15} /> Clear</button
        >
      {/if}
      <span class="status">
        {#if ann}<span class="dot" style:color={ann.color}></span> Live · {ann.by ?? 'operator'} · {relTime(
            ann.at,
            live.now,
          )}{:else}Not showing{/if}
      </span>
    </div>
  </section>

  <section class="card box">
    <header>
      <MessageSquare size={18} />
      <div>
        <h3>Message board</h3>
        <p class="hint">
          Big text on kiosk screens with a Message board panel — hosts, stage, green room.
        </p>
      </div>
    </header>
    <div class="presets">
      {#each PRESETS as p (p)}
        <button class="chip" disabled={!room.canWrite} onclick={() => (msgText = p)}>{p}</button>
      {/each}
    </div>
    <textarea
      class="textarea"
      maxlength="280"
      placeholder="Type a message for the kiosks…"
      bind:value={msgText}
      disabled={!room.canWrite}></textarea>
    {@render swatches(msgColor, (c) => (msgColor = c))}
    <div class="preview" aria-label="Preview">
      <span class="label">Preview</span>
      <p style:color={msgColor}>{msgText || '—'}</p>
    </div>
    <div class="row">
      <button
        class="btn primary"
        disabled={!room.canWrite || !msgText.trim()}
        onclick={() => ops.setMessage(msgText.trim(), msgColor)}
      >
        <Send size={15} /> Send to kiosks
      </button>
      {#if msg}
        <button class="btn ghost" disabled={!room.canWrite} onclick={() => ops.clearMessage()}
          ><X size={15} /> Clear</button
        >
      {/if}
      <span class="status">
        {#if msg}<span class="dot" style:color={msg.color}></span> Showing “{msg.text}” since {fmtClock(
            msg.at,
          )}{:else}Nothing showing{/if}
      </span>
    </div>
  </section>
</div>

{#snippet swatches(current: string, pick: (c: string) => void)}
  <div class="swatches" role="radiogroup" aria-label="Colour">
    {#each COLORS as c (c)}
      <button
        role="radio"
        aria-checked={current === c}
        aria-label={c}
        class="sw"
        class:on={current === c}
        style:background={c}
        disabled={!room.canWrite}
        onclick={() => pick(c)}
      ></button>
    {/each}
  </div>
{/snippet}

<style>
  .grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(340px, 1fr));
    gap: 20px;
    align-items: start;
  }
  .box {
    padding: 18px;
    display: grid;
    gap: 14px;
    box-shadow: none;
  }
  header {
    display: flex;
    gap: 12px;
    align-items: flex-start;
  }
  header :global(svg) {
    color: var(--accent);
    margin-top: 2px;
    flex: none;
  }
  h3 {
    font-size: 16px;
  }
  .swatches {
    display: flex;
    gap: 8px;
  }
  .sw {
    width: 26px;
    height: 26px;
    border-radius: 50%;
    border: 2px solid transparent;
    cursor: pointer;
    box-shadow: inset 0 0 0 1px rgb(0 0 0 / 0.3);
  }
  .sw.on {
    border-color: var(--text);
    outline: 2px solid var(--bg);
    outline-offset: -4px;
  }
  .presets {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
  }
  .presets .chip {
    cursor: pointer;
  }
  .preview {
    display: grid;
    gap: 8px;
    padding: 18px;
    border-radius: var(--radius);
    background: #050608;
    border: 1px solid var(--border);
  }
  .preview p {
    font-size: 30px;
    font-weight: 800;
    line-height: 1.1;
    text-align: center;
    overflow-wrap: anywhere;
  }
  .row {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 8px;
  }
  .status {
    flex: 1;
    min-width: 180px;
    display: inline-flex;
    align-items: center;
    gap: 8px;
    color: var(--muted);
    font-size: 13px;
  }
</style>
