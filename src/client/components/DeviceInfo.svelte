<script lang="ts">
  import { innerHeight, innerWidth } from 'svelte/reactivity/window';
  import { BUILD, isStandalone } from '../lib/device.ts';
  import { foldX } from '../lib/layout.ts';
  import { layout } from '../lib/layout.svelte.ts';
  import { prefs } from '../lib/prefs.svelte.ts';

  /**
   * What this device tells the app about itself: the numbers the layout is
   * picked from, for working out why a device got the layout it did.
   */
  let probe: HTMLElement;
  let insets = $state('');

  const width = $derived(innerWidth.current ?? window.innerWidth);
  const height = $derived(innerHeight.current ?? window.innerHeight);
  const rows = $derived<[string, string][]>([
    ['Build', BUILD],
    ['Layout', `${layout.kind}${prefs.layout === 'auto' ? '' : ` (chosen: ${prefs.layout})`}`],
    ['Window', `${width} × ${height}`],
    ['Screen', `${screen.width} × ${screen.height}`],
    ['Available', `${screen.availWidth} × ${screen.availHeight}`],
    ['Outer', `${window.outerWidth} × ${window.outerHeight}`],
    ['Pixel ratio', String(Math.round(devicePixelRatio * 1000) / 1000)],
    ['Safe area', insets],
    ['Installed', isStandalone() ? 'yes' : 'no'],
    ['Orientation', `${screen.orientation?.type ?? '?'} ${screen.orientation?.angle ?? ''}`],
    ['Fold segments', String(segments() ?? 'not reported')],
    ['Fold split', `${foldX(width, screen.width, screen.height)}`],
  ]);

  /** The Viewport Segments API, where the browser has it (not in the DOM types yet). */
  function segments(): number | undefined {
    return (window as Window & { viewport?: { segments?: DOMRect[] } }).viewport?.segments?.length;
  }

  // The safe area only exists in CSS: read it back off an element that uses it.
  $effect(() => {
    void width;
    void height;
    const cs = getComputedStyle(probe);
    insets = [cs.paddingTop, cs.paddingRight, cs.paddingBottom, cs.paddingLeft]
      .map((v) => parseFloat(v))
      .join(' ');
  });
</script>

<dl class="info num">
  {#each rows as [label, value] (label)}
    <dt>{label}</dt>
    <dd>{value}</dd>
  {/each}
</dl>
<div class="probe" bind:this={probe} aria-hidden="true"></div>

<style>
  .info {
    display: grid;
    grid-template-columns: auto minmax(0, 1fr);
    gap: 4px 16px;
    margin: 0;
    font-size: 13px;
  }
  dt {
    color: var(--muted);
  }
  dd {
    margin: 0;
    color: var(--text-2);
  }
  .probe {
    position: fixed;
    visibility: hidden;
    pointer-events: none;
    padding: env(safe-area-inset-top, 0px) env(safe-area-inset-right, 0px)
      env(safe-area-inset-bottom, 0px) env(safe-area-inset-left, 0px);
  }
</style>
