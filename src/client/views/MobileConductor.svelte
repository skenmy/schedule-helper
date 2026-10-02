<script lang="ts">
  import { Ellipsis, List, NotebookPen, Play, Square, StepForward } from '@lucide/svelte';
  import { tick } from 'svelte';
  import { fly } from 'svelte/transition';
  import { lineTitle } from '../../shared/derive.ts';
  import AnnouncementBanner from '../components/conductor/AnnouncementBanner.svelte';
  import MiniLog from '../components/conductor/MiniLog.svelte';
  import NowCard from '../components/conductor/NowCard.svelte';
  import StatusStrip from '../components/conductor/StatusStrip.svelte';
  import TimerPanel from '../components/conductor/TimerPanel.svelte';
  import Timeline from '../components/conductor/Timeline.svelte';
  import TopBar from '../components/conductor/TopBar.svelte';
  import UpNext from '../components/conductor/UpNext.svelte';
  import RoomDialogs from '../components/RoomDialogs.svelte';
  import BroadcastTab from '../components/tabs/BroadcastTab.svelte';
  import CaptureTab from '../components/tabs/CaptureTab.svelte';
  import KioskTab from '../components/tabs/KioskTab.svelte';
  import LogTab from '../components/tabs/LogTab.svelte';
  import ProgressTab from '../components/tabs/ProgressTab.svelte';
  import ScheduleTab from '../components/tabs/ScheduleTab.svelte';
  import MoreSheet from '../components/touch/MoreSheet.svelte';
  import { haptic, keepAwake } from '../lib/device.ts';
  import { fmtHMS } from '../lib/format.ts';
  import { getLive, getOps } from '../lib/live.svelte.ts';
  import { getRoom } from '../lib/room.svelte.ts';
  import { ui, type MobileView } from '../lib/ui.svelte.ts';

  const room = getRoom();
  const live = getLive();
  const ops = getOps();

  const running = $derived(live.timing?.phase === 'running');
  const disabled = $derived(!room.canWrite || live.phase === 'complete');

  const NAV: { id: MobileView | 'more'; label: string; icon: typeof Play }[] = [
    { id: 'now', label: 'Now', icon: Play },
    { id: 'upnext', label: 'Up next', icon: StepForward },
    { id: 'schedule', label: 'Schedule', icon: List },
    { id: 'log', label: 'Log', icon: NotebookPen },
    { id: 'more', label: 'More', icon: Ellipsis },
  ];
  const SWIPE_ORDER: MobileView[] = ['now', 'upnext', 'schedule', 'log'];

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
  // Landscape keeps Start / Next in a rail on the right while the Now view is open.
  $effect(() => {
    document.body.classList.toggle('now-view', ui.mobileView === 'now');
    return () => document.body.classList.remove('now-view');
  });

  /** Which way the incoming view slides from: +1 from the right, −1 from the left. */
  let direction = $state(0);
  /** Each view keeps its scroll position, like the tabs of a native app. */
  const scrolled: Partial<Record<MobileView, number>> = {};

  async function go(id: MobileView | 'more') {
    haptic(8);
    if (id === 'more') {
      ui.moreOpen = true;
      return;
    }
    if (id === ui.mobileView) {
      // Tapping the tab you're on goes back to its top.
      window.scrollTo({ top: 0, behavior: 'smooth' });
      return;
    }
    const from = SWIPE_ORDER.indexOf(ui.mobileView);
    const to = SWIPE_ORDER.indexOf(id);
    direction = from < 0 || to < 0 ? 0 : Math.sign(to - from);
    scrolled[ui.mobileView] = window.scrollY;
    ui.mobileView = id;
    await tick();
    window.scrollTo({ top: scrolled[id] ?? 0 });
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
    if ((e.target as HTMLElement).closest('input, textarea, select, table, .seg, iframe, .track'))
      return;
    const i = SWIPE_ORDER.indexOf(ui.mobileView);
    if (i < 0) return;
    const next = SWIPE_ORDER[i + (dx < 0 ? 1 : -1)];
    if (next) void go(next);
  }
</script>

<TopBar variant="phone" />
<AnnouncementBanner />
<StatusStrip compact />

<main class="view" ontouchstart={touchstart} ontouchend={touchend}>
  {#key ui.mobileView === 'tool' ? `tool-${ui.tab}` : ui.mobileView}
    <div class="page" in:fly={{ x: direction * 28, duration: 180 }}>
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
      {:else if ui.tab === 'timeline'}
        <Timeline />
      {:else}
        <ProgressTab />
      {/if}
    </div>
  {/key}
</main>

<div class="dock">
  {#if ui.mobileView === 'now'}
    <div class="actions">
      <span class="rail-time num" class:running aria-hidden="true">{fmtHMS(live.elapsedSec)}</span>
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
        aria-current={item.id !== 'more' && ui.mobileView === item.id ? 'page' : undefined}
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

<MoreSheet />
<RoomDialogs />

<style>
  .view {
    container: panel / inline-size;
    padding: 12px 12px calc(160px + env(safe-area-inset-bottom));
    min-height: 60dvh;
  }
  .page {
    display: grid;
    gap: 12px;
  }
  .dock {
    position: fixed;
    left: 0;
    right: 0;
    bottom: 0;
    z-index: 60;
    padding: 0 env(safe-area-inset-right) env(safe-area-inset-bottom) env(safe-area-inset-left);
    background: color-mix(in oklab, var(--bg) 92%, transparent);
    backdrop-filter: blur(14px);
    border-top: 1px solid var(--border);
    user-select: none;
    -webkit-user-select: none;
  }
  .actions {
    display: grid;
    grid-template-columns: 1fr 1.4fr;
    gap: 8px;
    padding: 10px 12px 4px;
  }
  .actions .btn {
    min-height: 56px;
  }
  /* Landscape only: the timer, above the buttons, while the page scrolls. */
  .rail-time {
    display: none;
    font-size: 30px;
    font-weight: 700;
    letter-spacing: -0.03em;
    text-align: center;
  }
  .rail-time.running {
    color: var(--accent);
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
    min-height: 54px;
    padding: 8px 0 10px;
    border: 0;
    background: none;
    color: var(--muted);
    font-size: 11px;
    font-weight: 600;
    cursor: pointer;
    -webkit-touch-callout: none;
  }
  nav button.on {
    color: var(--accent);
  }
  nav button:active {
    color: var(--text);
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

  /* ── Landscape phone: a side rail, Start / Next under the right thumb ─ */
  @media (orientation: landscape) and (max-height: 500px) {
    :global(body.has-bottom-nav) {
      --rail-w: 84px;
      --actions-w: 200px;
      --dock-space: 0px;
      --dock-right: calc(var(--actions-w) + env(safe-area-inset-right));
      padding-left: calc(var(--rail-w) + env(safe-area-inset-left));
    }
    .view {
      padding-bottom: calc(24px + env(safe-area-inset-bottom));
    }
    :global(body.has-bottom-nav.now-view) {
      padding-right: calc(var(--actions-w) + env(safe-area-inset-right));
    }
    .dock {
      display: contents;
    }
    nav {
      position: fixed;
      z-index: 60;
      top: 0;
      bottom: 0;
      left: 0;
      width: calc(var(--rail-w) + env(safe-area-inset-left));
      padding: env(safe-area-inset-top) 0 env(safe-area-inset-bottom) env(safe-area-inset-left);
      grid-template-columns: 1fr;
      grid-auto-rows: min-content;
      align-content: center;
      gap: 4px;
      border-right: 1px solid var(--border);
      background: color-mix(in oklab, var(--bg) 92%, transparent);
      backdrop-filter: blur(14px);
    }
    .actions {
      position: fixed;
      z-index: 60;
      top: 0;
      right: 0;
      bottom: 0;
      width: calc(var(--actions-w) + env(safe-area-inset-right));
      display: flex;
      flex-direction: column;
      justify-content: flex-end;
      padding: calc(12px + env(safe-area-inset-top)) calc(12px + env(safe-area-inset-right))
        calc(12px + env(safe-area-inset-bottom)) 12px;
      border-left: 1px solid var(--border);
      background: color-mix(in oklab, var(--bg) 92%, transparent);
      backdrop-filter: blur(14px);
    }
    .actions .btn {
      flex: 1;
      max-height: 120px;
    }
    .rail-time {
      display: block;
      margin-bottom: auto;
    }
  }
</style>
