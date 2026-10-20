<script lang="ts" generics="T extends string | number | boolean">
  import type { Component } from "svelte";

  interface Option {
    value: T;
    label: string;
    icon?: Component;
    title?: string;
  }

  let { options, value = $bindable(), size = "md", onchange }: { options: Option[]; value: T; size?: "sm" | "md"; onchange?: (value: T) => void } = $props();
</script>

<div class="segmented {size}" role="radiogroup">
  {#each options as option (option.value)}
    <button
      type="button"
      role="radio"
      aria-checked={value === option.value}
      class:active={value === option.value}
      title={option.title}
      onclick={() => {
        value = option.value;
        onchange?.(option.value);
      }}
    >
      {#if option.icon}<option.icon size={14} />{/if}
      {#if option.label}<span>{option.label}</span>{/if}
    </button>
  {/each}
</div>

<style>
  .segmented {
    display: inline-flex;
    padding: 2px;
    gap: 2px;
    background: var(--bg-active);
    border-radius: calc(var(--radius) + 2px);
  }

  button {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 6px;
    height: calc(var(--h-control) - 4px);
    padding: 0 10px;
    border: 0;
    border-radius: var(--radius);
    background: none;
    color: var(--text-2);
    font-size: var(--fs);
    font-weight: 500;
    cursor: pointer;
    white-space: nowrap;
  }

  .sm button {
    height: calc(var(--h-control-sm) - 4px);
    padding: 0 8px;
    font-size: var(--fs-sm);
  }

  button:hover {
    color: var(--text);
  }

  button.active {
    background: var(--bg-elevated);
    color: var(--text);
    box-shadow: var(--shadow-sm);
  }
</style>
