<script lang="ts">
  // Seçim çubuğu: listenin altında yüzer (liste kaymaz). Gmail tarzı "sunucudaki tüm eşleşenleri seç" bandı da burada.
  import Copy from "@lucide/svelte/icons/copy";
  import Download from "@lucide/svelte/icons/download";
  import Ellipsis from "@lucide/svelte/icons/ellipsis";
  import Files from "@lucide/svelte/icons/files";
  import Layers from "@lucide/svelte/icons/layers";
  import PencilLine from "@lucide/svelte/icons/pencil-line";
  import Timer from "@lucide/svelte/icons/timer";
  import Trash from "@lucide/svelte/icons/trash";
  import X from "@lucide/svelte/icons/x";
  import { openBulkTab } from "$lib/features/bulk/state.svelte";
  import { t } from "$lib/i18n/index.svelte";
  import { openMenu } from "$lib/state/menu.svelte";
  import { tooltip } from "$lib/ui/tooltip.svelte";
  import { bulkOnSelection, copyNames, deleteSelection, renameSelection } from "./actions";
  import type { BrowserController } from "./controller.svelte";

  let { ctl }: { ctl: BrowserController } = $props();

  const ws = $derived(ctl.ws);
  const count = $derived(ws.selection.size);
  const visible = $derived(count > 0 || ws.allMatching);
  const everyLoaded = $derived(!ws.allMatching && count > 0 && count === ws.keyCount && !ws.scan.done);
  const ro = $derived(ws.readOnly);
  const blocked = $derived(ro ? t("browser.selection.readOnly") : null);

  function more(e: MouseEvent): void {
    openMenu(
      [
        { label: t("browser.selection.copyNames"), icon: Copy, shortcut: "Mod+C", disabled: ws.allMatching, run: () => copyNames(ws.selectedKeys()) },
        { label: t("browser.selection.openBulk"), icon: Layers, run: () => openBulkTab(ws, { source: "selection" }) },
        { kind: "separator" },
        { label: t("browser.selection.clear"), icon: X, shortcut: "Escape", run: () => ws.clearSelection() },
      ],
      e.currentTarget as HTMLElement,
      { align: "end" },
    );
  }
</script>

{#if visible}
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div class="dock" onkeydown={(e) => e.key === "Escape" && !e.defaultPrevented && ws.clearSelection()}>
    {#if everyLoaded}
      <div class="banner">
        <span>{t("browser.selection.allLoaded", { count: ws.keyCount })}</span>
        <button class="link" onclick={() => (ws.allMatching = true)}>{t("browser.selection.selectAllMatching")}</button>
      </div>
    {:else if ws.allMatching}
      <div class="banner strong">
        <span>{t("browser.selection.allMatchingSelected")}</span>
        <button class="link" onclick={() => ws.clearSelection()}>{t("browser.selection.clear")}</button>
      </div>
    {/if}
    <div class="bar" role="toolbar" aria-label={t("browser.selection.count", { count })}>
      <span class="count tabular" use:tooltip={ws.allMatching ? t("browser.selection.allMatchingHint") : undefined}>
        {ws.allMatching ? t("browser.selection.allMatching") : t("browser.selection.count", { count })}
      </span>
      <span class="grow"></span>
      <button class="btn ghost icon sm danger-icon" disabled={ro} aria-label={t("browser.selection.delete")} use:tooltip={blocked ?? { text: t("browser.selection.delete"), shortcut: "Delete" }} onclick={() => deleteSelection(ws)}>
        <Trash size={14} />
      </button>
      <button class="btn ghost icon sm" disabled={ro} aria-label={t("browser.selection.ttl")} use:tooltip={blocked ?? t("browser.selection.ttl")} onclick={() => bulkOnSelection(ws, "expire")}>
        <Timer size={14} />
      </button>
      <button class="btn ghost icon sm" disabled={ro} aria-label={t("browser.selection.rename")} use:tooltip={blocked ?? { text: t("browser.selection.rename"), shortcut: "F2" }} onclick={() => renameSelection(ws)}>
        <PencilLine size={14} />
      </button>
      <button class="btn ghost icon sm" aria-label={t("browser.selection.copy")} use:tooltip={t("browser.selection.copy")} onclick={() => bulkOnSelection(ws, "copy")}>
        <Files size={14} />
      </button>
      <button class="btn ghost icon sm" aria-label={t("browser.selection.export")} use:tooltip={t("browser.selection.export")} onclick={() => bulkOnSelection(ws, "export")}>
        <Download size={14} />
      </button>
      <button class="btn ghost icon sm" aria-label={t("browser.selection.more")} aria-haspopup="menu" use:tooltip={t("browser.selection.more")} onclick={more}>
        <Ellipsis size={14} />
      </button>
      <span class="sep"></span>
      <button class="btn ghost icon sm" aria-label={t("browser.selection.clear")} use:tooltip={{ text: t("browser.selection.clear"), shortcut: "Escape" }} onclick={() => ws.clearSelection()}>
        <X size={14} />
      </button>
    </div>
  </div>
{/if}

<style>
  .dock {
    position: absolute;
    left: 8px;
    right: 8px;
    bottom: 8px;
    z-index: 2;
    display: flex;
    flex-direction: column;
    overflow: hidden;
    border: 1px solid var(--border);
    border-radius: var(--radius-lg);
    background: var(--bg-elevated);
    box-shadow: var(--shadow);
    animation: rise 140ms var(--ease);
  }

  @keyframes rise {
    from {
      opacity: 0;
      transform: translateY(6px);
    }
  }

  .banner {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 2px 8px;
    padding: 7px 10px;
    border-bottom: 1px solid var(--border-subtle);
    background: var(--accent-soft);
    font-size: var(--fs-xs);
    color: var(--text-2);
    line-height: 1.4;
  }

  .banner.strong {
    color: var(--text);
  }

  .link {
    padding: 0;
    border: 0;
    background: none;
    color: var(--accent-text);
    font-size: inherit;
    font-weight: 600;
    cursor: pointer;
  }

  .link:hover {
    text-decoration: underline;
  }

  .bar {
    display: flex;
    align-items: center;
    gap: 1px;
    height: 36px;
    padding: 0 4px 0 12px;
  }

  .count {
    font-size: var(--fs-sm);
    font-weight: 600;
    white-space: nowrap;
  }

  .danger-icon:not(:disabled) {
    color: var(--danger);
  }

  .danger-icon:hover:not(:disabled) {
    background: var(--danger-soft);
  }

  .sep {
    width: 1px;
    height: 16px;
    margin: 0 3px;
    background: var(--border);
  }
</style>
