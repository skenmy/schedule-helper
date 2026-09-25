<script lang="ts">
  import { ui } from '../../lib/ui.svelte.ts';
  import Dialog from './Dialog.svelte';

  const req = $derived(ui.confirm);
  /** Starts empty for every request. */
  let typed = $derived.by(() => {
    void req;
    return '';
  });
  const armed = $derived(
    !req?.typeToConfirm || typed.trim().toLowerCase() === req.typeToConfirm.toLowerCase(),
  );

  function settle(ok: boolean) {
    ui.confirm?.resolve(ok);
    ui.confirm = null;
  }
</script>

{#if req}
  <Dialog bind:open={() => !!ui.confirm, (v) => !v && settle(false)} title={req.title} size="sm">
    {#if req.body}<p class="body">{req.body}</p>{/if}
    {#if req.typeToConfirm}
      <form
        onsubmit={(e) => {
          e.preventDefault();
          if (armed) settle(true);
        }}
      >
        <label class="field">
          <span class="label">Type <b>{req.typeToConfirm}</b> to confirm</span>
          <!-- svelte-ignore a11y_autofocus -->
          <input class="input" autocomplete="off" spellcheck="false" autofocus bind:value={typed} />
        </label>
      </form>
    {/if}
    {#snippet footer()}
      <button class="btn ghost" onclick={() => settle(false)}>Cancel</button>
      <button
        class="btn {req.danger ? 'danger' : 'primary'}"
        disabled={!armed}
        onclick={() => settle(true)}>{req.confirmLabel}</button
      >
    {/snippet}
  </Dialog>
{/if}

<style>
  .body {
    color: var(--text-2);
    white-space: pre-line;
  }
  form {
    margin-top: 14px;
  }
</style>
