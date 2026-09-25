<script lang="ts">
  import { Maximize, Pencil, X } from '@lucide/svelte';
  import { roomPath } from '../../shared/sources.ts';
  import Panel from '../components/kiosk/Panel.svelte';
  import { keepAwake } from '../lib/device.ts';
  import {
    areaNames,
    LAYOUTS,
    layoutById,
    PANELS,
    readKioskParams,
    type KioskConfig,
    type PanelId,
  } from '../lib/kiosk.ts';
  import { getLive } from '../lib/live.svelte.ts';
  import { prefs } from '../lib/prefs.svelte.ts';
  import { getRoom } from '../lib/room.svelte.ts';
  import { router } from '../lib/router.svelte.ts';

  const room = getRoom();
  const live = getLive();

  // The URL is the source of truth; a bare ?kiosk=1 falls back to this browser's saved layout.
  const config = $derived<KioskConfig>(readKioskParams(router.params) ?? prefs.kiosk);
  const layout = $derived(layoutById(config.layout));
  const cells = $derived(areaNames(layout));
  const PANEL_IDS = Object.keys(PANELS) as PanelId[];

  let editing = $state(false);
  let idle = $state(false);
  let idleTimer: ReturnType<typeof setTimeout> | undefined;

  function wake() {
    idle = false;
    clearTimeout(idleTimer);
    idleTimer = setTimeout(() => (idle = true), 3000);
  }

  $effect(() => {
    wake();
    const stop = keepAwake(() => true);
    return () => {
      stop();
      clearTimeout(idleTimer);
    };
  });

  function update(next: KioskConfig) {
    prefs.kiosk = next;
    router.setParams({
      kiosk: '1',
      layout: next.layout,
      panels: next.panels.map((p) => p ?? '').join(','),
    });
  }

  function setPanel(i: number, id: string) {
    const panels = [...config.panels];
    while (panels.length <= i) panels.push(null);
    panels[i] = (id || null) as PanelId | null;
    update({ ...config, panels });
  }

  function fullscreen() {
    if (document.fullscreenElement) void document.exitFullscreen();
    else void document.documentElement.requestFullscreen().catch(() => {});
  }
</script>

<svelte:window onmousemove={wake} onkeydown={wake} ontouchstart={wake} />

<div class="kiosk" class:idle={idle && !editing}>
  <div
    class="grid"
    style:grid-template-columns={layout.cols}
    style:grid-template-rows={layout.rows}
    style:grid-template-areas={layout.areas}
  >
    {#each cells as area, i (area)}
      {@const id = config.panels[i]}
      <div class="cell" style:grid-area={area}>
        {#if editing}
          <label class="picker">
            <span class="label">Cell {i + 1}</span>
            <select
              class="select"
              value={id ?? ''}
              onchange={(e) => setPanel(i, e.currentTarget.value)}
            >
              <option value="">Empty</option>
              {#each PANEL_IDS as p (p)}<option value={p}>{PANELS[p].name}</option>{/each}
            </select>
          </label>
        {:else if id}
          <Panel {id} />
        {:else}
          <div class="blank">Empty cell</div>
        {/if}
      </div>
    {/each}
  </div>

  <div class="bar" data-huds="bar">
    <strong class="truncate">{room.schedule?.eventName}</strong>
    {#if room.status !== 'open'}<span class="chip bad">Reconnecting…</span>{/if}
    {#if live.state.announcement}<span class="chip warn truncate"
        >📣 {live.state.announcement.text}</span
      >{/if}
    <span class="spacer"></span>
    {#if editing}
      <select
        class="select layout"
        value={layout.id}
        onchange={(e) => update({ ...config, layout: e.currentTarget.value })}
      >
        {#each LAYOUTS as l (l.id)}<option value={l.id}>{l.name}</option>{/each}
      </select>
      <button class="btn sm primary" onclick={() => (editing = false)}>Done</button>
    {:else}
      <button class="btn sm" onclick={() => (editing = true)}
        ><Pencil size={14} /> Edit layout</button
      >
    {/if}
    <button class="btn sm icon" aria-label="Toggle full screen" onclick={fullscreen}
      ><Maximize size={15} /></button
    >
    <button class="btn sm" onclick={() => router.navigate(roomPath(room.ref))}
      ><X size={15} /> Exit kiosk</button
    >
  </div>
</div>

<style>
  .kiosk {
    position: fixed;
    inset: 0;
    background: var(--bg);
  }
  .kiosk.idle {
    cursor: none;
  }
  .grid {
    position: absolute;
    inset: 0;
    display: grid;
    gap: 10px;
    padding: 10px;
  }
  .cell {
    min-width: 0;
    min-height: 0;
  }
  .blank,
  .picker {
    height: 100%;
    display: grid;
    place-content: center;
    gap: 8px;
    border: 1px dashed var(--border-strong);
    border-radius: var(--radius-lg);
    color: var(--faint);
  }
  .picker {
    padding: 16px;
    color: var(--text-2);
  }
  .bar {
    position: absolute;
    left: 50%;
    bottom: 16px;
    transform: translateX(-50%);
    display: flex;
    align-items: center;
    gap: 10px;
    width: min(900px, calc(100vw - 32px));
    padding: 8px 8px 8px 16px;
    border: 1px solid var(--border-strong);
    border-radius: 999px;
    background: color-mix(in oklab, var(--surface-2) 92%, transparent);
    backdrop-filter: blur(12px);
    box-shadow: var(--shadow-lg);
    transition:
      opacity 0.3s,
      transform 0.3s var(--ease);
  }
  .idle .bar {
    opacity: 0;
    transform: translate(-50%, 20px);
    pointer-events: none;
  }
  .spacer {
    flex: 1;
  }
  .layout {
    width: auto;
    min-height: 30px;
    padding: 2px 8px;
    font-size: 13px;
  }
  .bar .chip {
    max-width: 320px;
  }
</style>
