<script lang="ts" generics="T extends string">
  interface Props {
    value: T;
    options: readonly { value: T; label: string; tone?: string }[];
    label: string;
    size?: 'sm' | 'md';
    disabled?: boolean;
    onchange?: (value: T) => void;
  }
  let {
    value = $bindable(),
    options,
    label,
    size = 'md',
    disabled = false,
    onchange,
  }: Props = $props();
</script>

<div class="seg {size}" role="radiogroup" aria-label={label}>
  {#each options as opt (opt.value)}
    <button
      type="button"
      role="radio"
      aria-checked={value === opt.value}
      class:on={value === opt.value}
      data-tone={opt.tone}
      {disabled}
      onclick={() => {
        value = opt.value;
        onchange?.(opt.value);
      }}>{opt.label}</button
    >
  {/each}
</div>

<style>
  .seg {
    display: inline-flex;
    padding: 3px;
    gap: 2px;
    border: 1px solid var(--border);
    border-radius: 9px;
    background: var(--bg-2);
  }
  button {
    min-height: 30px;
    padding: 0 12px;
    border: 0;
    border-radius: 6px;
    background: transparent;
    color: var(--muted);
    font-size: 13px;
    font-weight: 600;
    cursor: pointer;
    white-space: nowrap;
    transition:
      background 0.15s,
      color 0.15s;
  }
  .sm button {
    min-height: 26px;
    padding: 0 9px;
    font-size: 12px;
  }
  button:hover:not(:disabled) {
    color: var(--text);
  }
  button.on {
    background: var(--surface-3);
    color: var(--text);
    box-shadow: 0 1px 2px rgb(0 0 0 / 0.4);
  }
  button.on[data-tone='ok'] {
    background: var(--ok-soft);
    color: var(--ok);
  }
  button.on[data-tone='bad'] {
    background: var(--bad-soft);
    color: var(--bad);
  }
  button:disabled {
    cursor: not-allowed;
    opacity: 0.6;
  }
</style>
