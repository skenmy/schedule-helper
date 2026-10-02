<script lang="ts">
  /**
   * A QR code as crisp SVG, always dark on white (scanners want the contrast,
   * whatever the theme). The encoder loads on first use, so it stays out of
   * the main bundle.
   */
  let { value, size = 180, label }: { value: string; size?: number; label: string } = $props();

  const MARGIN = 4; // the quiet zone scanners need, in modules
  let shape = $state<{ n: number; d: string } | null>(null);

  $effect(() => {
    const text = value;
    let cancelled = false;
    void import('qrcode-generator').then(({ default: qrcode }) => {
      if (cancelled) return;
      const qr = qrcode(0, 'M');
      qr.addData(text);
      qr.make();
      const n = qr.getModuleCount();
      let d = '';
      for (let r = 0; r < n; r++) {
        for (let c = 0; c < n; c++) {
          if (qr.isDark(r, c)) d += `M${c + MARGIN},${r + MARGIN}h1v1h-1z`;
        }
      }
      shape = { n: n + MARGIN * 2, d };
    });
    return () => {
      cancelled = true;
    };
  });
</script>

{#if shape}
  <svg
    class="qr"
    viewBox="0 0 {shape.n} {shape.n}"
    width={size}
    height={size}
    role="img"
    aria-label={label}
    shape-rendering="crispEdges"
  >
    <rect width={shape.n} height={shape.n} fill="#fff" />
    <path d={shape.d} fill="#000" />
  </svg>
{:else}
  <span class="qr placeholder" style:width="{size}px" style:height="{size}px"></span>
{/if}

<style>
  .qr {
    display: block;
    border-radius: 8px;
  }
  .placeholder {
    background: var(--surface-3);
  }
</style>
