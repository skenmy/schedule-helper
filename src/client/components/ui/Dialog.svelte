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
</script>

<dialog
  bind:this={el}
  class="dialog {variant} {size}"
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
      <header>
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
  }
  .dialog.sheet[open] {
    animation: slide-left 0.22s var(--ease);
  }
  @media (max-width: 820px) {
    .dialog.sheet {
      margin: auto 0 0;
      height: auto;
      max-height: 88dvh;
      width: 100vw;
      max-width: 100vw;
      border-radius: var(--radius-lg) var(--radius-lg) 0 0;
      border-right: 1px solid var(--border-strong);
      border-bottom: 0;
    }
    .dialog.sheet[open] {
      animation: slide-up 0.22s var(--ease);
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
    height: 100%;
  }
  header {
    display: flex;
    align-items: flex-start;
    gap: 12px;
    padding: 18px 16px 12px 22px;
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
    flex: 1;
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
