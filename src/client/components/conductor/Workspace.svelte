<script lang="ts">
  import { getLive } from '../../lib/live.svelte.ts';
  import { ui, type TabId } from '../../lib/ui.svelte.ts';
  import BroadcastTab from '../tabs/BroadcastTab.svelte';
  import CaptureTab from '../tabs/CaptureTab.svelte';
  import KioskTab from '../tabs/KioskTab.svelte';
  import LogTab from '../tabs/LogTab.svelte';
  import ProgressTab from '../tabs/ProgressTab.svelte';
  import ScheduleTab from '../tabs/ScheduleTab.svelte';
  import Timeline from './Timeline.svelte';

  /**
   * `pane`: the tablet's right-hand pane — the tab bar stays put and the
   * panel scrolls on its own; the timeline becomes a tab. Otherwise the page
   * scrolls and the tab bar sticks under the top bar.
   */
  let { pane = false }: { pane?: boolean } = $props();

  const live = getLive();
  const TABS: { id: TabId; label: string }[] = [
    { id: 'schedule', label: 'Schedule' },
    { id: 'log', label: 'Event log' },
    { id: 'capture', label: 'Stream capture' },
    { id: 'broadcast', label: 'Broadcast' },
    { id: 'kiosk', label: 'Kiosk' },
    { id: 'progress', label: 'Progress' },
  ];
  const tabs = $derived(pane ? [{ id: 'timeline' as const, label: 'Timeline' }, ...TABS] : TABS);
  /** The desktop shows the timeline above, not as a tab. */
  const active = $derived<TabId>(!pane && ui.tab === 'timeline' ? 'schedule' : ui.tab);
  const counts = $derived<Partial<Record<TabId, number>>>({
    schedule: live.stats.runsTotal,
    log: live.state.log.length,
  });
  let workspace: HTMLElement;
  let panel: HTMLElement;

  // Jump down to the workspace (or back to the top of the pane) when the tab changes.
  let first = true;
  $effect(() => {
    void active;
    if (first) {
      first = false;
      return;
    }
    if (pane) panel?.scrollTo({ top: 0 });
    else workspace?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  });
</script>

<section class="workspace" class:pane bind:this={workspace}>
  <div class="tabs" role="tablist" aria-label="Workspace">
    {#each tabs as tab (tab.id)}
      <button
        role="tab"
        id="tab-{tab.id}"
        aria-selected={active === tab.id}
        aria-controls="panel-{tab.id}"
        class:on={active === tab.id}
        onclick={() => (ui.tab = tab.id)}
      >
        {tab.label}
        {#if counts[tab.id] != null}<span class="count num">{counts[tab.id]}</span>{/if}
        {#if tab.id === 'capture' && live.state.drift.enabled}<span
            class="dot auto"
            title="Auto drift check on"
          ></span>{/if}
        {#if tab.id === 'broadcast' && (live.state.message || live.state.announcement)}<span
            class="dot live"
            title="Broadcasting"
          ></span>{/if}
      </button>
    {/each}
  </div>
  <div
    class="panel"
    role="tabpanel"
    id="panel-{active}"
    aria-labelledby="tab-{active}"
    bind:this={panel}
  >
    {#if active === 'schedule'}<ScheduleTab />
    {:else if active === 'log'}<LogTab />
    {:else if active === 'capture'}<CaptureTab />
    {:else if active === 'broadcast'}<BroadcastTab />
    {:else if active === 'kiosk'}<KioskTab />
    {:else if active === 'timeline'}<Timeline />
    {:else}<ProgressTab />{/if}
  </div>
</section>

<style>
  .workspace {
    scroll-margin-top: calc(var(--topbar-h) + 8px);
  }
  .tabs {
    position: sticky;
    top: var(--topbar-h);
    z-index: 20;
    display: flex;
    gap: 4px;
    padding: 0 var(--gutter);
    border-bottom: 1px solid var(--border);
    background: color-mix(in oklab, var(--bg) 92%, transparent);
    backdrop-filter: blur(10px);
    overflow-x: auto;
    scrollbar-width: none;
  }
  .tabs button {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    height: 46px;
    padding: 0 14px;
    border: 0;
    border-bottom: 2px solid transparent;
    background: none;
    color: var(--muted);
    font-weight: 600;
    font-size: 14px;
    white-space: nowrap;
    cursor: pointer;
  }
  .tabs button:hover {
    color: var(--text);
  }
  .tabs button.on {
    color: var(--text);
    border-bottom-color: var(--accent);
  }
  .count {
    padding: 1px 6px;
    border-radius: 999px;
    background: var(--surface-2);
    color: var(--muted);
    font-size: 11px;
  }
  .dot.auto {
    color: var(--info);
  }
  .dot.live {
    color: var(--warn);
  }
  .panel {
    container: panel / inline-size;
    padding: 20px var(--gutter) 40px;
  }

  /* ── Tablet pane: fixed tabs, the panel scrolls ─────────────────────── */
  .pane {
    display: flex;
    flex-direction: column;
    min-height: 0;
    height: 100%;
  }
  .pane .tabs {
    position: static;
    flex: none;
  }
  .pane .tabs button {
    height: 50px;
    font-size: 14.5px;
  }
  .pane .panel {
    --panel-sticky-top: 0px;
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    overscroll-behavior: contain;
    padding-bottom: calc(40px + env(safe-area-inset-bottom));
  }
</style>
