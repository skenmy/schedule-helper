<script lang="ts">
  import { Ellipsis, Search } from '@lucide/svelte';
  import { MediaQuery } from 'svelte/reactivity';
  import { innerWidth } from 'svelte/reactivity/window';
  import AnnouncementBanner from '../components/conductor/AnnouncementBanner.svelte';
  import DetectionBanner from '../components/conductor/DetectionBanner.svelte';
  import MiniLog from '../components/conductor/MiniLog.svelte';
  import NowCard from '../components/conductor/NowCard.svelte';
  import StatusStrip from '../components/conductor/StatusStrip.svelte';
  import TopBar from '../components/conductor/TopBar.svelte';
  import UpNext from '../components/conductor/UpNext.svelte';
  import Workspace from '../components/conductor/Workspace.svelte';
  import RoomDialogs from '../components/RoomDialogs.svelte';
  import Shortcuts from '../components/Shortcuts.svelte';
  import MoreSheet from '../components/touch/MoreSheet.svelte';
  import OnDeck from '../components/touch/OnDeck.svelte';
  import Transport from '../components/touch/Transport.svelte';
  import { clock } from '../lib/clock.svelte.ts';
  import { isStandalone, keepAwake, largeViewportHeight } from '../lib/device.ts';
  import { fmtClock } from '../lib/format.ts';
  import { foldX, screenSize } from '../lib/layout.ts';
  import { prefs } from '../lib/prefs.svelte.ts';
  import { ui } from '../lib/ui.svelte.ts';

  /**
   * The iPhone Duo, open: a page of information and a page of controls, one
   * either side of the fold, each with its own header, so nothing sits on the
   * crease.
   * - Information: the marathon's status over tabs, Live (the current run, up
   *   next, the latest log) first, then whichever tools this device chose
   *   (More → Tabs on this device).
   * - Controls: the run controls, the runners on deck to check in, and the
   *   tracking banner to accept.
   * Open like a book (landscape) the information is the left page and the
   * controls the right, under the thumb; installed, the status bar narrows the
   * right page, so the controls get the smaller one. In portrait or tabletop the
   * information is the top half, which stands up with the phone half folded on
   * a desk, and the controls the flat half, docked along its bottom edge. No
   * console and floor modes: the two pages are both at once.
   *
   * Where the browser reports the fold (the Viewport Segments API: Chrome, and
   * Safari 27.1 behind a feature flag) its direction picks the arrangement and
   * the panes meet exactly on it. Otherwise the screen splits where the Duo
   * folds; across, Safari's toolbar on top puts the split a little below the
   * fold, so the controls never ride up onto the standing half.
   *
   * Both arrangements are the same component tree, so turning the phone keeps
   * whatever the operator was typing.
   */
  const across = new MediaQuery('(vertical-viewport-segments: 2)');
  const down = new MediaQuery('(horizontal-viewport-segments: 2)');
  const portrait = new MediaQuery('(orientation: portrait)');
  const stacked = $derived(across.current || (portrait.current && !down.current));
  /** Side by side, where the pages meet: on the crease, not half the window. */
  const split = $derived(
    foldX(
      innerWidth.current ?? window.innerWidth,
      screenSize(screen.width, screen.height, outerWidth, outerHeight).long,
    ),
  );
  /** Launched from the Home Screen: no browser toolbars to make room for. */
  const installed = isStandalone();
  /**
   * Installed, the large viewport's height, measured afresh. After an app
   * switch or a turn, iOS leaves the window a status bar short on the Duo and
   * fires nothing, and even a shell already sized by 100lvh keeps the short
   * height (a dialog opened then measured the whole screen behind a gap). So
   * it's measured whenever the app comes to the front, turns or resizes, and
   * again a moment later, once iOS has settled.
   */
  let height = $state<number | null>(null);
  $effect(() => {
    if (!installed) return;
    const timers: ReturnType<typeof setTimeout>[] = [];
    const measure = () => (height = largeViewportHeight());
    const remeasure = () => {
      if (document.visibilityState !== 'visible') return;
      timers.forEach(clearTimeout);
      measure();
      timers.splice(0, Infinity, setTimeout(measure, 300), setTimeout(measure, 1000));
    };
    remeasure();
    const targets: [EventTarget | null, string][] = [
      [document, 'visibilitychange'],
      [window, 'pageshow'],
      [window, 'focus'],
      [window, 'orientationchange'],
      [window, 'resize'],
      [window.visualViewport, 'resize'],
    ];
    for (const [target, type] of targets) target?.addEventListener(type, remeasure);
    return () => {
      for (const [target, type] of targets) target?.removeEventListener(type, remeasure);
      timers.forEach(clearTimeout);
    };
  });
  /** The tabs this device chose, and a tool opened from More or search while it's open. */
  const tabs = $derived(
    prefs.foldTabs.includes(ui.tab) || ui.tab === 'live'
      ? prefs.foldTabs
      : [...prefs.foldTabs, ui.tab],
  );

  // An operator's phone shouldn't lock mid-show, setup gaps included.
  $effect(() => keepAwake(() => true));

  $effect(() => {
    const html = document.documentElement;
    html.classList.add('app-shell');
    return () => html.classList.remove('app-shell');
  });
  // Toasts keep clear of the docked controls.
  $effect(() => {
    if (!stacked) return;
    document.body.classList.add('has-dock');
    return () => document.body.classList.remove('has-dock');
  });
</script>

<div
  class="fold"
  class:stacked
  class:installed
  style:--fold-x="{split}px"
  style:height={height ? `${height}px` : undefined}
  data-shell
>
  <section class="pane info" aria-label="Information">
    <TopBar variant="phone" />
    <AnnouncementBanner />
    <StatusStrip compact />
    <div class="tabs">
      <Workspace pane {tabs}>
        {#snippet current()}
          <div class="now">
            <NowCard />
            <UpNext />
            <MiniLog />
          </div>
        {/snippet}
      </Workspace>
    </div>
  </section>
  <section class="pane controls" aria-label="Controls">
    <header class="bar">
      <span class="clock num">{fmtClock(clock.now)}</span>
      <button
        class="btn ghost icon"
        aria-label="Search runs and commands"
        onclick={() => (ui.palette = true)}
      >
        <Search size={19} />
      </button>
      <button class="btn ghost icon" aria-label="More" onclick={() => (ui.moreOpen = true)}>
        <Ellipsis size={20} />
      </button>
    </header>
    <DetectionBanner />
    <div class="scroll">
      <OnDeck />
    </div>
    <Transport variant={stacked ? 'dock' : 'floor'} />
  </section>
</div>

<MoreSheet />
<RoomDialogs />
<Shortcuts />

<style>
  /* ── Book: two pages, split where the screen folds ──────────────────── */
  .fold {
    /* Pinned to the window rather than 100dvh, which iOS shortens on an installed
       Duo by the status bar's width (a column down the side). */
    position: fixed;
    inset: 0;
    /* The docked controls sit on its bottom edge, stretched or not. */
    contain: layout;
    padding: 0 env(safe-area-inset-right) 0 env(safe-area-inset-left);
    display: grid;
    /* Measured from the window's edge, not the safe area's. */
    grid-template-columns: calc(var(--fold-x, 50vw) - env(safe-area-inset-left, 0px)) minmax(
        0,
        1fr
      );
    grid-template-rows: minmax(0, 1fr);
  }
  /* Installed on the Duo, iOS leaves the window a status bar short at the bottom
     (867 × 587 on a 951 × 669 screen) after unfolding, switching back to the
     app or turning it, until it's reopened, and says nothing when it does. The
     large viewport stays the whole screen, and with no browser toolbars to come
     and go it's the right height whenever the app is in front; the script keeps
     it measured. Not in Safari, where it's taller than what shows. */
  .installed {
    height: 100lvh;
  }
  .pane {
    display: flex;
    flex-direction: column;
    min-width: 0;
    min-height: 0;
  }
  /* The chrome keeps its height; the scrolling part gives way. */
  .pane > :global(*) {
    flex: none;
  }
  .pane > .scroll,
  .pane > .tabs {
    flex: 1;
    min-height: 0;
  }
  .info {
    border-right: 1px solid var(--border);
  }
  .now {
    display: grid;
    grid-template-columns: minmax(0, 1fr);
    gap: 14px;
  }
  .scroll {
    display: grid;
    grid-template-columns: minmax(0, 1fr);
    align-content: start;
    gap: 14px;
    padding: 14px var(--gutter) 20px;
    overflow-y: auto;
    overscroll-behavior: contain;
  }
  /* Level with the top bar across the fold. */
  .bar {
    display: flex;
    align-items: center;
    gap: 4px;
    height: var(--topbar-h);
    padding: env(safe-area-inset-top) var(--gutter) 0;
    border-bottom: 1px solid var(--border);
    background: color-mix(in oklab, var(--bg) 88%, transparent);
  }
  .clock {
    margin-right: auto;
    font-size: 15px;
    color: var(--text-2);
  }

  /* ── Tabletop: the information up top, everything to touch below ────── */
  .stacked {
    grid-template-columns: minmax(0, 1fr);
    grid-template-rows: minmax(0, 1fr) minmax(0, 1fr);
  }
  .stacked .info {
    border-right: 0;
    border-bottom: 1px solid var(--border);
  }
  .stacked .bar {
    height: 56px;
    padding-top: 0;
  }
  /* The run controls are docked over the bottom of this half. */
  .stacked .controls {
    padding-bottom: calc(var(--dock-space, 84px) + env(safe-area-inset-bottom));
  }

  /* ── The browser says where the fold is: meet on it exactly ─────────── */
  @media (horizontal-viewport-segments: 2) {
    .fold:not(.stacked) {
      grid-template-columns:
        calc(env(viewport-segment-right 0 0) - env(safe-area-inset-left, 0px))
        minmax(0, 1fr);
      column-gap: calc(env(viewport-segment-left 1 0) - env(viewport-segment-right 0 0));
    }
  }
  @media (vertical-viewport-segments: 2) {
    .stacked {
      grid-template-rows: env(viewport-segment-bottom 0 0) minmax(0, 1fr);
      row-gap: calc(env(viewport-segment-top 0 1) - env(viewport-segment-bottom 0 0));
    }
  }
</style>
