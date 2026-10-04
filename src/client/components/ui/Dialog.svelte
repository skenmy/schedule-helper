<script lang="ts">
  import { X } from '@lucide/svelte';
  import type { Snippet } from 'svelte';

  interface Props {
    open: boolean;
    title: string;
    subtitle?: string;
    /** `sheet` slides in from the side (bottom on phones). */
    variant?: 'modal' | 'sheet';
    size?: 'sm' | 'md' | 'lg';
    children: Snippet;
    footer?: Snippet;
    onclose?: () => void;
  }

  let {
    open = $bindable(),
    title,
    subtitle,
    variant = 'modal',
    size = 'md',
    children,
    footer,
    onclose,
  }: Props = $props();

  let el: HTMLDialogElement;

  $effect(() => {
    if (open && !el.open) el.showModal();
    else if (!open && el.open) el.close();
  });

  // Sheets can be swiped away by their header: down when docked to the
  // bottom (phones), right when docked to the side.
  let drag = $state(0);
  let axis = $state<'x' | 'y'>('y');
  let start = 0;
  let startAt = 0;
  let pointer = $state<number | null>(null);

  // Closed mid-drag (Escape, a button, the header unmounting): start clean next time.
  $effect(() => {
    if (!open) {
      drag = 0;
      pointer = null;
    }
  });

  function dragStart(e: PointerEvent) {
    if (variant !== 'sheet' || e.pointerType === 'mouse') return;
    if ((e.target as HTMLElement).closest('button, a, input, select, textarea')) return;
    const rect = el.getBoundingClientRect();
    axis = rect.width >= window.innerWidth - 1 ? 'y' : 'x';
    start = axis === 'y' ? e.clientY : e.clientX;
    startAt = performance.now();
    pointer = e.pointerId;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  }
  function dragMove(e: PointerEvent) {
    if (e.pointerId !== pointer) return;
    drag = Math.max(0, (axis === 'y' ? e.clientY : e.clientX) - start);
  }
  function dragEnd(e: PointerEvent) {
    if (e.pointerId !== pointer) return;
    pointer = null;
    const speed = drag / Math.max(1, performance.now() - startAt);
    // Closing leaves the sheet where the finger let go; the effect above resets it.
    if (drag > 110 || (drag > 30 && speed > 0.6)) open = false;
    else drag = 0;
  }
</script>

<dialog
  bind:this={el}
  class="dialog {variant} {size}"
  class:dragging={pointer != null}
  style:translate={drag ? (axis === 'y' ? `0 ${drag}px` : `${drag}px 0`) : null}
  aria-label={title}
  onclose={() => {
    open = false;
    onclose?.();
  }}
  onclick={(e) => {
    if (e.target === el) open = false;
  }}
>
  {#if open}
    <div class="panel">
      <!-- svelte-ignore a11y_no_static_element_interactions (a swipe shortcut; the Close button is the accessible way out) -->
      <header
        onpointerdown={dragStart}
        onpointermove={dragMove}
        onpointerup={dragEnd}
        onpointercancel={dragEnd}
        onlostpointercapture={(e) => {
          if (e.pointerId !== pointer) return;
          pointer = null;
          drag = 0;
        }}
      >
        {#if variant === 'sheet'}<span class="grabber" aria-hidden="true"></span>{/if}
        <div class="titles">
          <h2>{title}</h2>
          {#if subtitle}<p>{subtitle}</p>{/if}
        </div>
        <button class="btn ghost icon" aria-label="Close" onclick={() => (open = false)}>
          <X size={18} />
        </button>
      </header>
      <div class="body">{@render children()}</div>
      {#if footer}<footer>{@render footer()}</footer>{/if}
    </div>
  {/if}
</dialog>

<style>
  .dialog {
    padding: 0;
    border: 1px solid var(--border-strong);
    border-radius: var(--radius-lg);
    background: var(--surface);
    color: var(--text);
    box-shadow: var(--shadow-lg);
    max-height: min(88dvh, 900px);
    width: min(var(--w), calc(100vw - 24px));
    overflow: hidden;
  }
  .dialog.sm {
    --w: 420px;
  }
  .dialog.md {
    --w: 560px;
  }
  .dialog.lg {
    --w: 760px;
  }
  .dialog::backdrop {
    background: rgb(3 4 6 / 0.62);
    backdrop-filter: blur(3px);
  }
  .dialog[open] {
    animation: pop 0.18s var(--ease);
  }
  .dialog.sheet {
    margin: 0 0 0 auto;
    height: 100dvh;
    max-height: 100dvh;
    width: min(460px, 100vw);
    border-radius: var(--radius-lg) 0 0 var(--radius-lg);
    border-right: 0;
    /* Full height: clear the status bar and home indicator in installed apps. */
    padding: env(safe-area-inset-top) env(safe-area-inset-right) 0 0;
    transition: translate 0.2s var(--ease);
  }
  .dialog.sheet.dragging {
    transition: none;
  }
  .dialog.sheet[open] {
    animation: slide-left 0.22s var(--ease);
  }
  .sheet .body {
    padding-bottom: calc(20px + env(safe-area-inset-bottom));
  }
  /* Phones in portrait (and narrow desktop windows): a bottom sheet. */
  @media (orientation: portrait) {
    :global(html[data-layout='phone']) .dialog.sheet {
      margin: auto 0 0;
      height: auto;
      max-height: calc(92dvh - env(safe-area-inset-top));
      width: 100vw;
      max-width: 100vw;
      padding: 0;
      border-radius: var(--radius-lg) var(--radius-lg) 0 0;
      border-right: 1px solid var(--border-strong);
      border-bottom: 0;
    }
    :global(html[data-layout='phone']) .dialog.sheet[open] {
      animation: slide-up 0.22s var(--ease);
    }
    :global(html[data-layout='phone']) .sheet header {
      padding-top: 22px;
    }
    :global(html[data-layout='phone']) .grabber {
      display: block;
    }
  }
  @keyframes pop {
    from {
      opacity: 0;
      transform: translateY(8px) scale(0.98);
    }
  }
  @keyframes slide-left {
    from {
      transform: translateX(40px);
      opacity: 0;
    }
  }
  @keyframes slide-up {
    from {
      transform: translateY(40px);
      opacity: 0;
    }
  }
  .panel {
    display: flex;
    flex-direction: column;
    max-height: inherit;
  }
  /* A sheet is as tall as the screen; a modal is as tall as what's in it. Never 100% of
     a modal: its height is `fit-content`, so that percentage depends on itself, and iPad
     Safari settled it at 0, opening every modal as a bare line (its two borders). */
  .sheet .panel {
    height: 100%;
  }
  header {
    position: relative;
    display: flex;
    align-items: flex-start;
    gap: 12px;
    padding: 18px 16px 12px 22px;
  }
  .sheet header {
    touch-action: none;
    user-select: none;
    -webkit-user-select: none;
  }
  .grabber {
    display: none;
    position: absolute;
    top: 8px;
    left: 50%;
    width: 38px;
    height: 5px;
    margin-left: -19px;
    border-radius: 3px;
    background: var(--border-strong);
  }
  .titles {
    flex: 1;
    min-width: 0;
  }
  h2 {
    font-size: 18px;
    font-weight: 700;
    letter-spacing: -0.01em;
  }
  p {
    margin-top: 2px;
    color: var(--muted);
    font-size: 13.5px;
  }
  .body {
    padding: 4px 22px 20px;
    overflow: auto;
    /* As tall as its content, shrinking (and scrolling) only once the dialog reaches
       its max height. Not `flex: 1`: WebKit has taken that 0% basis literally when the
       dialog's height comes from its content, and a scrolling body has no minimum to
       stop it collapsing. */
    flex: 1 1 auto;
    min-height: 0;
  }
  footer {
    display: flex;
    gap: 8px;
    justify-content: flex-end;
    align-items: center;
    padding: 14px 22px calc(14px + env(safe-area-inset-bottom));
    border-top: 1px solid var(--border);
    background: var(--bg-2);
  }
</style>
