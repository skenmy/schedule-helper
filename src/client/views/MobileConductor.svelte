<script lang="ts">
  import {
    Camera,
    ChartNoAxesColumn,
    CircleQuestionMark,
    Ellipsis,
    House,
    LayoutGrid,
    List,
    Megaphone,
    NotebookPen,
    Play,
    Search,
    Square,
    StepForward,
    TvMinimalPlay,
  } from '@lucide/svelte';
  import { lineTitle } from '../../shared/derive.ts';
  import AnnouncementBanner from '../components/conductor/AnnouncementBanner.svelte';
  import MiniLog from '../components/conductor/MiniLog.svelte';
  import NowCard from '../components/conductor/NowCard.svelte';
  import StatusStrip from '../components/conductor/StatusStrip.svelte';
  import TimerPanel from '../components/conductor/TimerPanel.svelte';
  import TopBar from '../components/conductor/TopBar.svelte';
  import UpNext from '../components/conductor/UpNext.svelte';
  import RoomDialogs from '../components/RoomDialogs.svelte';
  import BroadcastTab from '../components/tabs/BroadcastTab.svelte';
  import CaptureTab from '../components/tabs/CaptureTab.svelte';
  import KioskTab from '../components/tabs/KioskTab.svelte';
  import LogTab from '../components/tabs/LogTab.svelte';
  import ProgressTab from '../components/tabs/ProgressTab.svelte';
  import ScheduleTab from '../components/tabs/ScheduleTab.svelte';
  import Dialog from '../components/ui/Dialog.svelte';
  import { haptic, keepAwake } from '../lib/device.ts';
  import { getLive, getOps } from '../lib/live.svelte.ts';
  import { prefs, THEMES } from '../lib/prefs.svelte.ts';
  import { getRoom } from '../lib/room.svelte.ts';
  import { router } from '../lib/router.svelte.ts';
  import { ui, type MobileView, type TabId } from '../lib/ui.svelte.ts';

  const room = getRoom();
  const live = getLive();
  const ops = getOps();

  const running = $derived(live.timing?.phase === 'running');
  const disabled = $derived(!room.canWrite || room.status !== 'open' || live.phase === 'complete');

  const NAV: { id: MobileView | 'more'; label: string; icon: typeof Play }[] = [
    { id: 'now', label: 'Now', icon: Play },
    { id: 'upnext', label: 'Up next', icon: StepForward },
    { id: 'schedule', label: 'Schedule', icon: List },
    { id: 'log', label: 'Log', icon: NotebookPen },
    { id: 'more', label: 'More', icon: Ellipsis },
  ];
  const SWIPE_ORDER: MobileView[] = ['now', 'upnext', 'schedule', 'log'];
  const TOOLS: { id: TabId; label: string; hint: string; icon: typeof Play }[] = [
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

  // Unseen log entries since the Log view was last open.
  let seenLog = $state(live.state.log[0]?.id ?? 0);
  const unseen = $derived(live.state.log.filter((e) => e.id > seenLog).length);
  $effect(() => {
    if (ui.mobileView === 'log') seenLog = live.state.log[0]?.id ?? 0;
  });

  $effect(() => {
    document.body.classList.add('has-bottom-nav');
    return () => document.body.classList.remove('has-bottom-nav');
  });
  $effect(() => keepAwake(() => live.timing?.phase === 'running'));

  function go(id: MobileView | 'more') {
    haptic(8);
    if (id === 'more') ui.moreOpen = true;
    else {
      ui.mobileView = id;
      window.scrollTo({ top: 0 });
    }
  }

  // Horizontal swipe between the main views.
  let sx = 0;
  let sy = 0;
  let st = 0;
  function touchstart(e: TouchEvent) {
    const t = e.touches[0]!;
    [sx, sy, st] = [t.clientX, t.clientY, Date.now()];
  }
  function touchend(e: TouchEvent) {
    const t = e.changedTouches[0]!;
    const dx = t.clientX - sx;
    const dy = t.clientY - sy;
    if (Math.abs(dx) < 80 || Math.abs(dy) > 60 || Date.now() - st > 450) return;
    if ((e.target as HTMLElement).closest('input, textarea, select, table, .seg, iframe')) return;
    const i = SWIPE_ORDER.indexOf(ui.mobileView);
    if (i < 0) return;
    const next = SWIPE_ORDER[i + (dx < 0 ? 1 : -1)];
    if (next) go(next);
  }
</script>

<TopBar compact />
<AnnouncementBanner />
<StatusStrip compact />

<main class="view" ontouchstart={touchstart} ontouchend={touchend}>
  {#if ui.mobileView === 'now'}
    <NowCard />
    <TimerPanel compact />
    <MiniLog />
  {:else if ui.mobileView === 'upnext'}
    <UpNext count={12} title={false} />
  {:else if ui.mobileView === 'schedule'}
    <ScheduleTab />
  {:else if ui.mobileView === 'log'}
    <LogTab />
  {:else if ui.tab === 'capture'}
    <CaptureTab />
  {:else if ui.tab === 'broadcast'}
    <BroadcastTab />
  {:else if ui.tab === 'kiosk'}
    <KioskTab />
  {:else}
    <ProgressTab />
  {/if}
</main>

<div class="dock">
  {#if ui.mobileView === 'now'}
    <div class="actions">
      <button
        class="btn lg {running ? 'danger' : 'primary'}"
        {disabled}
        onclick={() => {
          haptic(14);
          ops.toggleTimer();
        }}
      >
        {#if running}<Square size={18} /> Stop{:else}<Play size={18} />
          {live.timing?.phase === 'finished' ? 'Resume' : 'Start'}{/if}
      </button>
      <button
        class="btn lg"
        {disabled}
        onclick={() => {
          haptic(14);
          ops.advance();
        }}
      >
        <StepForward size={18} />
        <span class="truncate">{live.next ? lineTitle(live.next) : 'Finish'}</span>
      </button>
    </div>
  {/if}
  <nav aria-label="Views">
    {#each NAV as item (item.id)}
      {@const Icon = item.icon}
      <button
        class:on={item.id === 'more'
          ? ui.moreOpen || ui.mobileView === 'tool'
          : ui.mobileView === item.id}
        onclick={() => go(item.id)}
      >
        <Icon size={20} />
        {item.label}
        {#if item.id === 'log' && unseen > 0 && ui.mobileView !== 'log'}<span class="badge"
            >{unseen > 9 ? '9+' : unseen}</span
          >{/if}
      </button>
    {/each}
  </nav>
</div>

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
    <li>
      <button onclick={() => ((ui.moreOpen = false), (ui.palette = true))}>
        <Search size={20} /><span><b>Search</b><small>Jump to any run or action</small></span>
      </button>
    </li>
    <li>
      <button onclick={() => window.open(`${location.pathname}?kiosk=1`, '_blank')}>
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
      <button onclick={() => router.navigate('/')}>
        <House size={20} /><span
          ><b>Change schedule</b><small>{room.schedule?.scheduleName}</small></span
        >
      </button>
    </li>
  </ul>
  <label class="field theme">
    <span class="label">Theme</span>
    <select class="select" bind:value={prefs.theme}>
      {#each THEMES as t (t.id)}<option value={t.id}>{t.name}</option>{/each}
    </select>
  </label>
</Dialog>

<RoomDialogs />

<style>
  .view {
    display: grid;
    gap: 12px;
    padding: 12px 12px calc(160px + env(safe-area-inset-bottom));
    min-height: 60dvh;
  }
  .dock {
    position: fixed;
    left: 0;
    right: 0;
    bottom: 0;
    z-index: 60;
    background: color-mix(in oklab, var(--bg) 92%, transparent);
    backdrop-filter: blur(14px);
    border-top: 1px solid var(--border);
    padding-bottom: env(safe-area-inset-bottom);
  }
  .actions {
    display: grid;
    grid-template-columns: 1fr 1.4fr;
    gap: 8px;
    padding: 10px 12px 4px;
  }
  .actions .btn {
    min-height: 54px;
  }
  nav {
    display: grid;
    grid-template-columns: repeat(5, 1fr);
  }
  nav button {
    position: relative;
    display: grid;
    justify-items: center;
    gap: 3px;
    padding: 8px 0 10px;
    border: 0;
    background: none;
    color: var(--muted);
    font-size: 11px;
    font-weight: 600;
    cursor: pointer;
  }
  nav button.on {
    color: var(--accent);
  }
  .badge {
    position: absolute;
    top: 4px;
    left: calc(50% + 6px);
    min-width: 18px;
    height: 18px;
    padding: 0 5px;
    border-radius: 9px;
    background: var(--bad);
    color: #fff;
    font-size: 10.5px;
    line-height: 18px;
  }
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
    padding: 12px 8px;
    border: 0;
    border-radius: var(--radius-sm);
    background: none;
    text-align: left;
    cursor: pointer;
  }
  .more button:hover {
    background: var(--surface-2);
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
  .theme {
    padding: 0 8px;
  }
</style>
