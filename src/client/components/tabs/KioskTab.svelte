<script lang="ts">
  import { Copy, ExternalLink } from '@lucide/svelte';
  import { roomPath } from '../../../shared/sources.ts';
  import {
    areaNames,
    kioskUrl,
    LAYOUTS,
    layoutById,
    PANELS,
    PRESETS,
    type PanelId,
  } from '../../lib/kiosk.ts';
  import { prefs } from '../../lib/prefs.svelte.ts';
  import { getRoom } from '../../lib/room.svelte.ts';
  import { toasts } from '../../lib/toasts.svelte.ts';

  const room = getRoom();
  const layout = $derived(layoutById(prefs.kiosk.layout));
  const cells = $derived(areaNames(layout));
  const url = $derived(kioskUrl(roomPath(room.ref), prefs.kiosk));
  const absolute = $derived(new URL(url, location.origin).toString());
  const feed = $derived(
    new URL(`/api/rooms${roomPath(room.ref)}/feed`, location.origin).toString(),
  );
  const PANEL_IDS = Object.keys(PANELS) as PanelId[];

  function setLayout(id: string) {
    prefs.kiosk = { ...prefs.kiosk, layout: id };
  }

  function setPanel(i: number, id: string) {
    const panels = [...prefs.kiosk.panels];
    while (panels.length <= i) panels.push(null);
    panels[i] = (id || null) as PanelId | null;
    prefs.kiosk = { ...prefs.kiosk, panels };
  }

  async function copy(text: string, what: string) {
    try {
      await navigator.clipboard.writeText(text);
      toasts.push({ kind: 'success', title: `${what} copied` });
    } catch {
      toasts.push({ kind: 'error', title: 'Couldn’t copy', body: text });
    }
  }
</script>

<div class="grid">
  <section>
    <h3 class="label">Presets</h3>
    <div class="presets">
      {#each PRESETS as p (p.id)}
        <button class="preset card" onclick={() => (prefs.kiosk = structuredClone(p.config))}>
          <strong>{p.name}</strong>
          <span>{p.description}</span>
        </button>
      {/each}
    </div>

    <h3 class="label">Layout</h3>
    <div class="layouts">
      {#each LAYOUTS as l (l.id)}
        <button
          class="layout"
          class:on={l.id === layout.id}
          onclick={() => setLayout(l.id)}
          title={l.name}
        >
          <span
            class="mini"
            style:grid-template-columns={l.cols}
            style:grid-template-rows={l.rows}
            style:grid-template-areas={l.areas}
          >
            {#each areaNames(l) as a (a)}<i style:grid-area={a}></i>{/each}
          </span>
          <span class="name">{l.name}</span>
        </button>
      {/each}
    </div>

    <h3 class="label">Panels</h3>
    <div
      class="canvas"
      style:grid-template-columns={layout.cols}
      style:grid-template-rows={layout.rows}
      style:grid-template-areas={layout.areas}
    >
      {#each cells as area, i (area)}
        <label class="cell" style:grid-area={area}>
          <span class="label">Cell {i + 1}</span>
          <select
            class="select"
            value={prefs.kiosk.panels[i] ?? ''}
            onchange={(e) => setPanel(i, e.currentTarget.value)}
          >
            <option value="">Empty</option>
            {#each PANEL_IDS as id (id)}<option value={id}>{PANELS[id].name}</option>{/each}
          </select>
          {#if prefs.kiosk.panels[i]}<small>{PANELS[prefs.kiosk.panels[i]!].description}</small
            >{/if}
        </label>
      {/each}
    </div>
  </section>

  <aside class="side">
    <div class="card box">
      <h3>Launch</h3>
      <p class="hint">
        The layout lives in the link, so open it on a venue TV once and bookmark it. Kiosks stay
        awake and update live; anyone can view them without signing in.
      </p>
      <input
        class="input num"
        readonly
        value={absolute}
        onfocus={(e) => e.currentTarget.select()}
      />
      <div class="row">
        <button
          class="btn primary"
          onclick={() => window.open(url, '_blank', 'width=1280,height=800')}
        >
          <ExternalLink size={15} /> Open kiosk
        </button>
        <button class="btn" onclick={() => copy(absolute, 'Kiosk link')}
          ><Copy size={15} /> Copy link</button
        >
      </div>
    </div>

    <div class="card box">
      <h3>Overlay &amp; integrations feed</h3>
      <p class="hint">
        Read-only JSON with the current run, next runs, delta and projected end, for stream
        overlays, NodeCG or bots. Add <code>/stream</code> for live Server-Sent Events.
      </p>
      <input class="input num" readonly value={feed} onfocus={(e) => e.currentTarget.select()} />
      <div class="row">
        <button class="btn" onclick={() => copy(feed, 'Feed URL')}><Copy size={15} /> Copy</button>
        <a class="btn ghost" href={feed} target="_blank" rel="noopener"
          ><ExternalLink size={15} /> View</a
        >
      </div>
    </div>
  </aside>
</div>

<style>
  .grid {
    display: grid;
    grid-template-columns: minmax(0, 1.5fr) minmax(280px, 1fr);
    gap: 28px;
  }
  h3.label {
    margin: 4px 0 10px;
  }
  section > h3.label:not(:first-child) {
    margin-top: 24px;
  }
  .presets {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(170px, 1fr));
    gap: 10px;
  }
  .preset {
    display: grid;
    gap: 2px;
    padding: 12px 14px;
    text-align: left;
    cursor: pointer;
    box-shadow: none;
  }
  .preset:hover {
    border-color: var(--accent);
  }
  .preset span {
    font-size: 12.5px;
    color: var(--muted);
  }
  .layouts {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(96px, 1fr));
    gap: 10px;
  }
  .layout {
    display: grid;
    gap: 6px;
    padding: 8px;
    border: 1px solid var(--border);
    border-radius: var(--radius);
    background: var(--surface);
    cursor: pointer;
  }
  .layout.on {
    border-color: var(--accent);
    background: var(--accent-soft);
  }
  .mini {
    display: grid;
    gap: 3px;
    aspect-ratio: 16 / 9;
  }
  .mini i {
    border-radius: 3px;
    background: var(--surface-3);
  }
  .layout.on .mini i {
    background: color-mix(in oklab, var(--accent) 55%, var(--surface-3));
  }
  .name {
    font-size: 11.5px;
    color: var(--text-2);
  }
  .canvas {
    display: grid;
    gap: 8px;
    aspect-ratio: 16 / 9;
    padding: 8px;
    border-radius: var(--radius);
    background: #050608;
    border: 1px solid var(--border);
  }
  .cell {
    display: grid;
    align-content: center;
    gap: 6px;
    padding: 10px;
    border-radius: var(--radius-sm);
    background: var(--surface);
    border: 1px dashed var(--border-strong);
    min-width: 0;
  }
  .cell small {
    color: var(--muted);
    font-size: 11.5px;
  }
  .side {
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
  .box h3 {
    font-size: 15px;
  }
  .row {
    display: flex;
    gap: 8px;
    flex-wrap: wrap;
  }
  .input.num {
    font-size: 12px;
  }
  code {
    font-family: var(--font-mono);
    font-size: 12px;
    color: var(--text-2);
  }
  @media (max-width: 1000px) {
    .grid {
      grid-template-columns: 1fr;
    }
  }
</style>
