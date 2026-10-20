<script lang="ts">
  import CircleAlert from "@lucide/svelte/icons/circle-alert";
  import CircleCheck from "@lucide/svelte/icons/circle-check";
  import Info from "@lucide/svelte/icons/info";
  import TriangleAlert from "@lucide/svelte/icons/triangle-alert";
  import X from "@lucide/svelte/icons/x";
  import { dismissToast, toasts } from "$lib/state/toasts.svelte";

  const icons = { info: Info, success: CircleCheck, warning: TriangleAlert, error: CircleAlert };
</script>

<div class="stack" aria-live="polite">
  {#each toasts as item (item.id)}
    {@const Icon = icons[item.kind]}
    <div class="toast {item.kind}" role={item.kind === "error" ? "alert" : "status"}>
      <span class="icon"><Icon size={16} /></span>
      <div class="text">
        <div class="title">{item.title}</div>
        {#if item.message}<div class="message selectable">{item.message}</div>{/if}
      </div>
      {#if item.action}
        <button
          class="btn sm"
          onclick={() => {
            item.action?.run();
            dismissToast(item.id);
          }}>{item.action.label}</button
        >
      {/if}
      <button class="btn ghost icon sm close" aria-label="×" onclick={() => dismissToast(item.id)}><X size={14} /></button>
    </div>
  {/each}
</div>

<style>
  .stack {
    position: fixed;
    right: 16px;
    bottom: 36px;
    z-index: var(--z-toast);
    display: flex;
    flex-direction: column;
    gap: 8px;
    width: min(400px, calc(100vw - 32px));
    pointer-events: none;
  }

  .toast {
    display: flex;
    align-items: flex-start;
    gap: 10px;
    padding: 10px 8px 10px 12px;
    background: var(--bg-elevated);
    border: 1px solid var(--border);
    border-radius: var(--radius-lg);
    box-shadow: var(--shadow-lg);
    pointer-events: auto;
    animation: slide 160ms var(--ease);
  }

  @keyframes slide {
    from {
      opacity: 0;
      transform: translateY(8px);
    }
  }

  .icon {
    margin-top: 1px;
    flex: none;
  }

  .info .icon {
    color: var(--accent);
  }
  .success .icon {
    color: var(--success);
  }
  .warning .icon {
    color: var(--warning);
  }
  .error .icon {
    color: var(--danger);
  }

  .text {
    flex: 1;
    min-width: 0;
  }

  .title {
    font-weight: 500;
  }

  .message {
    margin-top: 2px;
    color: var(--text-2);
    font-size: var(--fs-sm);
    word-break: break-word;
    max-height: 120px;
    overflow: auto;
  }

  .close {
    margin: -2px 0;
    color: var(--text-3);
  }
</style>
