<script lang="ts">
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
  import { keepAwake } from '../lib/device.ts';
  import { prefs } from '../lib/prefs.svelte.ts';

  /**
   * iPad (and other tablets). Two modes, remembered per device:
   * - console: everything the desktop can do, rearranged for touch;
   * - floor: the live run, a big timer and one-tap runner check-ins.
   *
   * Wide screens (landscape, or a 13" in portrait) are an app shell: fixed
   * chrome and two panes that scroll on their own, with the run controls
   * pinned to the bottom of the live pane. Narrower ones scroll as a page
   * with the controls docked along the bottom.
   *
   * Both shapes are the same component tree, switched by CSS and props, so
   * rotating the iPad (which crosses 1000px on most models) keeps whatever the
   * operator was typing — an announcement, a log note, the schedule filter.
   */
  const wide = new MediaQuery('min-width: 1000px');
  const floor = $derived(prefs.tabletMode === 'floor');

  // An operator's iPad shouldn't lock mid-show, setup gaps included.
  $effect(() => keepAwake(() => true));

  $effect(() => {
    const html = document.documentElement;
    if (wide.current) {
      html.classList.add('app-shell');
      return () => html.classList.remove('app-shell');
    }
    document.body.classList.add('has-dock');
    return () => document.body.classList.remove('has-dock');
  });
</script>

<div class="tablet" class:wide={wide.current} class:floor>
  <TopBar variant="tablet" />
  <AnnouncementBanner />
  <DetectionBanner />
  <StatusStrip />
  <div class="panes">
    <section class="pane live" aria-label="Live run">
      <div class="scroll">
        <!-- Narrow floor view: the timer rides in the card, the dock has no room for it. -->
        <NowCard stage={floor} timer={floor && !wide.current} />
        {#if !floor}
          <UpNext />
          <div class="log"><MiniLog /></div>
        {/if}
      </div>
      <Transport
        variant={wide.current ? (floor ? 'floor' : 'pane') : 'dock'}
        readout={wide.current || !floor}
      />
    </section>
    <section class="pane side" aria-label={floor ? 'Runners' : 'Tools'}>
      {#if floor}
        <div class="scroll">
          <OnDeck />
          <MiniLog />
        </div>
      {:else}
        <Workspace pane={wide.current} timeline />
      {/if}
    </section>
  </div>
</div>

<MoreSheet />
<RoomDialogs />
<Shortcuts />

<style>
  .scroll {
    display: grid;
    align-content: start;
    gap: 14px;
    padding: 14px var(--gutter);
  }

  /* ── Wide: an app shell with two independently scrolling panes ─────── */
  .wide {
    display: flex;
    flex-direction: column;
    height: 100dvh;
  }
  .wide .panes {
    flex: 1;
    min-height: 0;
    display: grid;
    grid-template-columns: minmax(360px, 0.62fr) minmax(0, 1fr);
  }
  .wide.floor .panes {
    grid-template-columns: minmax(0, 1.1fr) minmax(0, 1fr);
  }
  .wide .pane {
    display: flex;
    flex-direction: column;
    min-height: 0;
    min-width: 0;
  }
  .wide .live {
    border-right: 1px solid var(--border);
  }
  .wide .scroll {
    flex: 1;
    min-height: 0;
    padding-bottom: 20px;
    overflow-y: auto;
    overscroll-behavior: contain;
  }
  .wide .side .scroll {
    padding-bottom: calc(20px + env(safe-area-inset-bottom));
  }

  /* ── Narrow: a scrolling page with the controls docked ──────────────── */
  .tablet:not(.wide):not(.floor) .live .scroll {
    grid-template-columns: minmax(0, 1.25fr) minmax(0, 1fr);
    align-items: start;
  }
  .tablet:not(.wide) .log {
    display: none;
  }
  .tablet:not(.wide).floor .side .scroll {
    padding-top: 0;
  }
</style>
