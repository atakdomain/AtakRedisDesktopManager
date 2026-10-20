<script lang="ts">
  import Kbd from "./Kbd.svelte";
  import { tooltipState } from "./tooltip.svelte";

  let el = $state<HTMLDivElement>();

  $effect(() => {
    const rect = tooltipState.rect;
    if (!el || !rect || !tooltipState.content) return;
    const { width, height } = el.getBoundingClientRect();
    let x = rect.left + rect.width / 2 - width / 2;
    let y = rect.bottom + 6;
    if (y + height > window.innerHeight - 6) y = rect.top - height - 6;
    x = Math.max(6, Math.min(x, window.innerWidth - width - 6));
    el.style.left = `${Math.round(x)}px`;
    el.style.top = `${Math.round(y)}px`;
  });
</script>

{#if tooltipState.content}
  <div class="tip" bind:this={el} role="tooltip">
    <span>{tooltipState.content.text}</span>
    {#if tooltipState.content.shortcut}<Kbd shortcut={tooltipState.content.shortcut} subtle />{/if}
  </div>
{/if}

<style>
  .tip {
    position: fixed;
    z-index: var(--z-tooltip);
    display: flex;
    align-items: center;
    gap: 8px;
    max-width: 320px;
    padding: 4px 8px;
    border-radius: var(--radius);
    background: #1d2027;
    color: #f1f3f6;
    font-size: var(--fs-sm);
    line-height: 1.4;
    box-shadow: var(--shadow);
    pointer-events: none;
    animation: in 80ms var(--ease);
  }

  .tip :global(.kbd) {
    color: #9aa3b2;
  }

  @keyframes in {
    from {
      opacity: 0;
    }
  }
</style>
