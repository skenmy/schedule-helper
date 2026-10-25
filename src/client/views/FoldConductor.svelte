<script lang="ts">
  import { Ellipsis, Search } from '@lucide/svelte';
  import { MediaQuery } from 'svelte/reactivity';
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
  import Segmented from '../components/ui/Segmented.svelte';
  import { clock } from '../lib/clock.svelte.ts';
  import { keepAwake } from '../lib/device.ts';
  import { fmtClock } from '../lib/format.ts';
  import { TABLET_MODES } from '../lib/layout.ts';
  import { prefs } from '../lib/prefs.svelte.ts';
  import { ui } from '../lib/ui.svelte.ts';

  /**
   * A foldable's inner screen: the iPhone Duo, open. Two panes, one either
   * side of the fold, each with its own header, so nothing sits on the crease:
   * - book (landscape, folding down the middle): the live run and its
   *   controls on the left page; the marathon's status and the tools or the
   *   runners on the right;
   * - tabletop (portrait, folding across): the status and the live run on the
   *   top half, which stands up with the phone half folded on a desk, and the
   *   tools or runners on the flat half, with the controls docked along its
   *   bottom edge.
   *
   * Where the browser reports the fold (the Viewport Segments API: Chrome, and
   * Safari 27.1 behind a feature flag) its direction picks the arrangement and
   * the panes meet exactly on it. Otherwise the screen splits down the middle,
   * which is where the Duo folds; across, Safari's toolbar on top puts the split
   * a little below the fold, so the controls never ride up onto the standing half.
   *
   * Console and floor modes as on the iPad (`prefs.tabletMode`). Both
   * arrangements are the same component tree (bar the status strip, which
   * has nothing to type in), so turning the phone keeps whatever the operator
   * was typing.
   */
  const across = new MediaQuery('(vertical-viewport-segments: 2)');
  const down = new MediaQuery('(horizontal-viewport-segments: 2)');
  const portrait = new MediaQuery('(orientation: portrait)');
  const stacked = $derived(across.current || (portrait.current && !down.current));
  const floor = $derived(prefs.tabletMode === 'floor');

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

<div class="fold" class:stacked class:floor>
  <section class="pane live" aria-label="Live run">
    <TopBar variant="phone" />
    <AnnouncementBanner />
    <DetectionBanner />
    {#if stacked}<StatusStrip compact />{/if}
    <div class="scroll">
      <NowCard stage={floor} />
      {#if !floor}<UpNext />{/if}
    </div>
    <Transport variant={stacked ? 'dock' : floor ? 'floor' : 'pane'} />
  </section>
  <section class="pane side" aria-label={floor ? 'Runners' : 'Tools'}>
    <header class="bar">
      <Segmented label="Interface mode" options={TABLET_MODES} bind:value={prefs.tabletMode} />
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
    <!-- Half a book is short: the status sits over the tools, the run gets the other page. -->
    {#if !stacked}<StatusStrip compact />{/if}
    {#if floor}
      <div class="scroll">
        <OnDeck />
        <MiniLog />
      </div>
    {:else}
      <div class="tools"><Workspace pane timeline /></div>
    {/if}
  </section>
</div>

<MoreSheet />
<RoomDialogs />
<Shortcuts />

<style>
  /* ── Book: two pages, split where the screen folds ──────────────────── */
  .fold {
    /* Pinned to the window, not sized in viewport units: installed on the Duo, iOS
       takes the status bar's width (a column down the side) off 100dvh as well,
       which left a band of nothing along the bottom. */
    position: fixed;
    inset: 0;
    padding: 0 env(safe-area-inset-right) 0 env(safe-area-inset-left);
    display: grid;
    /* Half the screen, not half the safe area: the Duo's insets aren't symmetric. */
    grid-template-columns: calc(50vw - env(safe-area-inset-left, 0px)) minmax(0, 1fr);
    grid-template-rows: minmax(0, 1fr);
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
  .pane > .tools {
    flex: 1;
    min-height: 0;
  }
  .live {
    border-right: 1px solid var(--border);
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
  .side .scroll {
    padding-bottom: calc(20px + env(safe-area-inset-bottom));
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
    margin: 0 6px 0 auto;
    font-size: 14px;
    color: var(--text-2);
  }

  /* ── Tabletop: the live run up top, everything to touch below ───────── */
  .stacked {
    grid-template-columns: minmax(0, 1fr);
    grid-template-rows: minmax(0, 1fr) minmax(0, 1fr);
  }
  .stacked .live {
    border-right: 0;
    border-bottom: 1px solid var(--border);
  }
  .stacked .bar {
    height: 56px;
    padding-top: 0;
  }
  /* The controls are docked over the bottom of this half. */
  .stacked .side {
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
