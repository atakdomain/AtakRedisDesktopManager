<script lang="ts">
  import X from "@lucide/svelte/icons/x";
  import type { Snippet } from "svelte";
  import { t } from "$lib/i18n/index.svelte";

  interface Props {
    title: string;
    subtitle?: string;
    size?: "sm" | "md" | "lg" | "xl";
    /** Arka plana tıklama / Esc ile kapanabilir mi (iş sürerken false) */
    dismissible?: boolean;
    onclose: () => void;
    children: Snippet;
    footer?: Snippet;
    /** Başlığın solunda özel içerik (ikon vb.) */
    icon?: Snippet;
  }

  let { title, subtitle, size = "md", dismissible = true, onclose, children, footer, icon }: Props = $props();

  let panel = $state<HTMLDivElement>();
  let restoreFocus: Element | null = null;

  $effect(() => {
    restoreFocus = document.activeElement;
    const first = panel?.querySelector<HTMLElement>("[data-autofocus], input:not([type=hidden]):not([disabled]), textarea, select, button.primary");
    (first ?? panel)?.focus();
    return () => (restoreFocus as HTMLElement | null)?.focus?.();
  });

  function onkeydown(e: KeyboardEvent) {
    if (e.key === "Escape" && dismissible) {
      e.stopPropagation();
      onclose();
    }
    if (e.key === "Tab" && panel) {
      const focusable = [...panel.querySelectorAll<HTMLElement>("button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex='-1'])")];
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }
  }
</script>

<div class="scrim" role="presentation" onpointerdown={(e) => e.target === e.currentTarget && dismissible && onclose()}>
  <div class="panel {size}" bind:this={panel} role="dialog" aria-modal="true" aria-label={title} tabindex="-1" {onkeydown}>
    <header>
      {#if icon}<div class="icon">{@render icon()}</div>{/if}
      <div class="titles">
        <h2>{title}</h2>
        {#if subtitle}<p class="subtitle">{subtitle}</p>{/if}
      </div>
      {#if dismissible}
        <button class="btn ghost icon sm" aria-label={t("common.close")} onclick={onclose}><X size={16} /></button>
      {/if}
    </header>
    <div class="body">{@render children()}</div>
    {#if footer}<footer>{@render footer()}</footer>{/if}
  </div>
</div>

<style>
  .scrim {
    position: fixed;
    inset: 0;
    z-index: var(--z-modal);
    display: grid;
    place-items: center;
    padding: 24px;
    background: var(--scrim);
    animation: fade 120ms var(--ease);
  }

  @keyframes fade {
    from {
      opacity: 0;
    }
  }

  .panel {
    display: flex;
    flex-direction: column;
    width: 100%;
    max-height: min(860px, calc(100vh - 48px));
    background: var(--bg-elevated);
    border: 1px solid var(--border);
    border-radius: var(--radius-xl);
    box-shadow: var(--shadow-lg);
    animation: rise 160ms var(--ease);
  }

  /* Panel yalnızca odak tuzağı için odaklanır; çerçeve göstermez */
  .panel:focus-visible {
    outline: none;
  }

  @keyframes rise {
    from {
      opacity: 0;
      transform: translateY(6px) scale(0.99);
    }
  }

  .sm {
    max-width: 420px;
  }
  .md {
    max-width: 560px;
  }
  .lg {
    max-width: 760px;
  }
  .xl {
    max-width: 1040px;
  }

  header {
    display: flex;
    align-items: flex-start;
    gap: 12px;
    padding: 16px 16px 12px 20px;
  }

  .icon {
    flex: none;
    margin-top: 1px;
  }

  .titles {
    flex: 1;
    min-width: 0;
  }

  h2 {
    font-size: var(--fs-lg);
    font-weight: 600;
    line-height: 1.35;
  }

  .subtitle {
    margin-top: 2px;
    color: var(--text-3);
    font-size: var(--fs-sm);
  }

  .body {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    padding: 4px 20px 16px;
  }

  footer {
    display: flex;
    align-items: center;
    justify-content: flex-end;
    gap: 8px;
    padding: 12px 16px;
    border-top: 1px solid var(--border-subtle);
  }
</style>
