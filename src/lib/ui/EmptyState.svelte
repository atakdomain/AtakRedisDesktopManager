<script lang="ts">
  import type { Component, Snippet } from "svelte";

  let { icon, title, description, children, compact = false }: { icon?: Component; title: string; description?: string; children?: Snippet; compact?: boolean } = $props();
</script>

<div class="empty" class:compact>
  {#if icon}
    {@const Icon = icon}
    <div class="icon"><Icon size={compact ? 20 : 26} strokeWidth={1.6} /></div>
  {/if}
  <div class="title">{title}</div>
  {#if description}<p class="description">{description}</p>{/if}
  {#if children}<div class="actions">{@render children()}</div>{/if}
</div>

<style>
  .empty {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 6px;
    height: 100%;
    padding: 32px 24px;
    text-align: center;
  }

  .compact {
    padding: 20px 16px;
  }

  .icon {
    display: grid;
    place-items: center;
    width: 52px;
    height: 52px;
    margin-bottom: 6px;
    border-radius: 14px;
    background: var(--bg-hover);
    color: var(--text-3);
  }

  .compact .icon {
    width: 38px;
    height: 38px;
    border-radius: 10px;
  }

  .title {
    font-weight: 600;
    font-size: var(--fs-md);
  }

  .compact .title {
    font-size: var(--fs);
  }

  .description {
    max-width: 380px;
    color: var(--text-3);
    font-size: var(--fs-sm);
    line-height: 1.55;
  }

  .actions {
    display: flex;
    gap: 8px;
    margin-top: 10px;
  }
</style>
