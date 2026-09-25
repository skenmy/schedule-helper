<script lang="ts">
  import { CircleCheck, CircleX, Info, TriangleAlert, X } from '@lucide/svelte';
  import { fly } from 'svelte/transition';
  import { toasts } from '../../lib/toasts.svelte.ts';

  const ICONS = { success: CircleCheck, error: CircleX, warning: TriangleAlert, info: Info };
</script>

<div class="toasts" role="status" aria-live="polite">
  {#each toasts.items as toast (toast.id)}
    {@const Icon = ICONS[toast.kind]}
    <div class="toast {toast.kind}" transition:fly={{ y: 16, duration: 180 }}>
      <Icon size={18} />
      <div class="text">
        <strong>{toast.title}</strong>
        {#if toast.body}<span>{toast.body}</span>{/if}
      </div>
      {#if toast.action}
        <button
          class="btn sm"
          onclick={() => {
            toast.action?.run();
            toasts.dismiss(toast.id);
          }}>{toast.action.label}</button
        >
      {/if}
      <button
        class="btn ghost icon sm"
        aria-label="Dismiss"
        onclick={() => toasts.dismiss(toast.id)}
      >
        <X size={16} />
      </button>
    </div>
  {/each}
</div>

<style>
  .toasts {
    position: fixed;
    right: 16px;
    bottom: calc(16px + env(safe-area-inset-bottom));
    z-index: 1000;
    display: grid;
    gap: 8px;
    width: min(420px, calc(100vw - 32px));
    pointer-events: none;
  }
  :global(body.has-bottom-nav) .toasts {
    bottom: calc(150px + env(safe-area-inset-bottom));
  }
  .toast {
    pointer-events: auto;
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 12px 10px 12px 14px;
    border: 1px solid var(--border-strong);
    border-left: 3px solid var(--tone, var(--info));
    border-radius: var(--radius);
    background: color-mix(in oklab, var(--surface-2) 94%, transparent);
    backdrop-filter: blur(10px);
    box-shadow: var(--shadow-lg);
  }
  .toast > :global(svg) {
    color: var(--tone);
    flex: none;
  }
  .toast.success {
    --tone: var(--ok);
  }
  .toast.error {
    --tone: var(--bad);
  }
  .toast.warning {
    --tone: var(--warn);
  }
  .toast.info {
    --tone: var(--info);
  }
  .text {
    flex: 1;
    display: grid;
    gap: 2px;
    min-width: 0;
    font-size: 13.5px;
  }
  .text span {
    color: var(--text-2);
  }
</style>
