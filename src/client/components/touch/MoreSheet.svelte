<script lang="ts">
  import {
    Camera,
    ChartGantt,
    ChartNoAxesColumn,
    CircleQuestionMark,
    FileChartColumn,
    House,
    LayoutGrid,
    Megaphone,
    RefreshCw,
    Search,
    TvMinimalPlay,
  } from '@lucide/svelte';
  import { roomPath } from '../../../shared/sources.ts';
  import { isStandalone } from '../../lib/device.ts';
  import { kioskUrl } from '../../lib/kiosk.ts';
  import { reportPath } from '../../lib/report.ts';
  import { LAYOUT_PREFS } from '../../lib/layout.ts';
  import { prefs, THEMES } from '../../lib/prefs.svelte.ts';
  import { getRoom } from '../../lib/room.svelte.ts';
  import { router } from '../../lib/router.svelte.ts';
  import { ui, type TabId } from '../../lib/ui.svelte.ts';
  import AlertsSetting from '../AlertsSetting.svelte';
  import Dialog from '../ui/Dialog.svelte';

  /** Tools, navigation and per-device settings for the phone and tablet layouts. */
  const room = getRoom();

  const TOOLS: { id: TabId; label: string; hint: string; icon: typeof Camera }[] = [
    { id: 'timeline', label: 'Timeline', hint: 'Plan vs. actual at a glance', icon: ChartGantt },
    {
      id: 'capture',
      label: 'Stream capture',
      hint: 'Check our timer against the stream',
      icon: Camera,
    },
    {
      id: 'broadcast',
      label: 'Broadcast',
      hint: 'Announcement banner & message board',
      icon: Megaphone,
    },
    {
      id: 'kiosk',
      label: 'Kiosk & overlays',
      hint: 'Venue screens and the data feed',
      icon: LayoutGrid,
    },
    {
      id: 'progress',
      label: 'Progress',
      hint: 'Completion and estimate accuracy',
      icon: ChartNoAxesColumn,
    },
  ];

  function openKiosk() {
    ui.moreOpen = false;
    const url = kioskUrl(roomPath(room.ref), prefs.kiosk);
    // An installed app can't open windows; show the kiosk in place instead.
    if (isStandalone()) router.navigate(url);
    else window.open(url, '_blank');
  }
</script>

<Dialog bind:open={ui.moreOpen} variant="sheet" title="More">
  <ul class="more">
    {#each TOOLS as t (t.id)}
      {@const Icon = t.icon}
      <li>
        <button onclick={() => ui.openTab(t.id)}>
          <Icon size={20} /><span><b>{t.label}</b><small>{t.hint}</small></span>
        </button>
      </li>
    {/each}
    <li class="sep" role="presentation"></li>
    <li>
      <button onclick={() => ((ui.moreOpen = false), (ui.palette = true))}>
        <Search size={20} /><span><b>Search</b><small>Jump to any run or action</small></span>
      </button>
    </li>
    <li>
      <button onclick={() => ((ui.moreOpen = false), router.navigate(reportPath(room.ref)))}>
        <FileChartColumn size={20} /><span
          ><b>Event report</b><small>Planned against actual, CSV export</small></span
        >
      </button>
    </li>
    <li>
      <button onclick={openKiosk}>
        <TvMinimalPlay size={20} /><span
          ><b>Open kiosk</b><small>Full-screen display on this device</small></span
        >
      </button>
    </li>
    <li>
      <button onclick={() => ((ui.moreOpen = false), (ui.help = true))}>
        <CircleQuestionMark size={20} /><span
          ><b>Help</b><small>How delta, projections and undo work</small></span
        >
      </button>
    </li>
    <li>
      <button onclick={() => location.reload()}>
        <RefreshCw size={20} /><span
          ><b>Reload</b><small>Fetch the latest version of the app</small></span
        >
      </button>
    </li>
    <li>
      <button onclick={() => router.navigate('/')}>
        <House size={20} /><span
          ><b>Change schedule</b><small>{room.schedule?.scheduleName}</small></span
        >
      </button>
    </li>
  </ul>
  <div class="settings">
    {#if room.isOperator}<AlertsSetting />{/if}
    <label class="field">
      <span class="label">Theme</span>
      <select class="select" bind:value={prefs.theme}>
        {#each THEMES as t (t.id)}<option value={t.id}>{t.name}</option>{/each}
      </select>
    </label>
    <label class="field">
      <span class="label">Layout on this device</span>
      <!-- The new layout may have no More sheet; don't leave it open for the trip back. -->
      <select class="select" bind:value={prefs.layout} onchange={() => (ui.moreOpen = false)}>
        {#each LAYOUT_PREFS as l (l.id)}<option value={l.id}>{l.name}</option>{/each}
      </select>
    </label>
  </div>
</Dialog>

<style>
  .more {
    list-style: none;
    margin: 0 0 16px;
    padding: 0;
    display: grid;
    gap: 2px;
  }
  .more button {
    width: 100%;
    display: flex;
    align-items: center;
    gap: 14px;
    min-height: 52px;
    padding: 10px 8px;
    border: 0;
    border-radius: var(--radius-sm);
    background: none;
    text-align: left;
    cursor: pointer;
  }
  .more button:active {
    background: var(--surface-2);
  }
  @media (hover: hover) {
    .more button:hover {
      background: var(--surface-2);
    }
  }
  .more :global(svg) {
    color: var(--accent);
    flex: none;
  }
  .more span {
    display: grid;
  }
  .more small {
    color: var(--muted);
    font-size: 12.5px;
  }
  .sep {
    height: 1px;
    margin: 6px 8px;
    background: var(--border);
  }
  .settings {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
    gap: 12px;
    padding: 0 8px;
  }
</style>
