<script lang="ts">
  // Gezgin başlığı: veritabanı seçici, yenile, yeni anahtar, ağaç/liste, diğer menüsü.
  import ChevronDown from "@lucide/svelte/icons/chevron-down";
  import ChevronsDownUp from "@lucide/svelte/icons/chevrons-down-up";
  import ChevronsUpDown from "@lucide/svelte/icons/chevrons-up-down";
  import Database from "@lucide/svelte/icons/database";
  import Download from "@lucide/svelte/icons/download";
  import Ellipsis from "@lucide/svelte/icons/ellipsis";
  import Layers from "@lucide/svelte/icons/layers";
  import List from "@lucide/svelte/icons/list";
  import ListTree from "@lucide/svelte/icons/list-tree";
  import Plus from "@lucide/svelte/icons/plus";
  import RefreshCw from "@lucide/svelte/icons/refresh-cw";
  import Upload from "@lucide/svelte/icons/upload";
  import { openBulkTab, openImport } from "$lib/features/bulk/state.svelte";
  import { fmtNumber, t } from "$lib/i18n/index.svelte";
  import { connections } from "$lib/state/connections.svelte";
  import { openMenu, type MenuItem } from "$lib/state/menu.svelte";
  import { settings } from "$lib/state/settings.svelte";
  import type { Workspace } from "$lib/state/workspace.svelte";
  import { tooltip } from "$lib/ui/tooltip.svelte";
  import type { BrowserController } from "./controller.svelte";

  let { ws, ctl, onrefresh, onnewkey }: { ws: Workspace; ctl: BrowserController; onrefresh: () => void; onnewkey: () => void } = $props();

  let dbButton = $state<HTMLButtonElement>();

  const cluster = $derived(connections.sessions[ws.connectionId]?.mode === "cluster");
  const current = $derived(ws.dbs.find((d) => d.index === ws.db));

  function dbMenu(showAll = false): void {
    if (!dbButton) return;
    void ws.loadDbs();
    const visible = showAll ? ws.dbs : ws.dbs.filter((d) => d.keys > 0 || d.index === ws.db);
    const items: MenuItem[] = [
      { kind: "header", label: t("browser.header.dbMenu") },
      ...visible.map((d) => ({
        label: `db${d.index}`,
        hint: d.keys > 0 ? fmtNumber(d.keys) : t("browser.header.dbEmpty"),
        checked: d.index === ws.db,
        run: () => void ws.setDb(d.index),
      })),
    ];
    if (!showAll && visible.length < ws.dbs.length) {
      items.push({ kind: "separator" }, { label: t("browser.header.showAllDbs", { count: ws.dbs.length }), run: () => dbMenu(true) });
    }
    openMenu(items, dbButton, { minWidth: 200 });
  }

  function moreMenu(e: MouseEvent): void {
    const items: MenuItem[] = [
      { label: t("browser.header.bulk"), icon: Layers, run: () => openBulkTab(ws) },
      { label: t("browser.header.importFile"), icon: Upload, disabled: ws.readOnly, run: () => openImport(ws) },
      { kind: "separator" },
      { label: t("browser.header.expandAll"), icon: ChevronsUpDown, disabled: !settings.treeView, run: () => ctl.expandAll() },
      { label: t("browser.header.collapseAll"), icon: ChevronsDownUp, disabled: !settings.treeView, run: () => ctl.collapseAll() },
      { label: t("browser.header.loadAll"), icon: Download, disabled: ws.scan.done, run: () => void ws.loadAll() },
      { kind: "separator" },
      { label: t("browser.header.showMeta"), checked: settings.showKeyMeta, run: () => (settings.showKeyMeta = !settings.showKeyMeta) },
    ];
    openMenu(items, e.currentTarget as HTMLElement, { align: "end", minWidth: 220 });
  }
</script>

<header class="head">
  <button
    class="db"
    bind:this={dbButton}
    disabled={cluster}
    onclick={() => dbMenu()}
    aria-haspopup="menu"
    aria-label={t("browser.header.dbMenu")}
    use:tooltip={cluster ? t("browser.header.clusterDb") : t("browser.header.dbMenu")}
  >
    <Database size={13} />
    <span class="name">db{ws.db}</span>
    {#if current}<span class="keys tabular">· {fmtNumber(current.keys)}</span>{/if}
    {#if !cluster}<ChevronDown size={12} />{/if}
  </button>
  <span class="grow"></span>
  <button class="btn ghost icon sm" aria-label={t("browser.header.refresh")} use:tooltip={{ text: t("browser.header.refresh"), shortcut: "Mod+R" }} onclick={onrefresh}>
    <RefreshCw size={14} class={ws.scan.running ? "browser-spin" : ""} />
  </button>
  <button
    class="btn ghost icon sm"
    disabled={ws.readOnly}
    aria-label={t("browser.header.newKey")}
    use:tooltip={{ text: ws.readOnly ? t("common.readOnlyBlocked") : t("browser.header.newKey"), shortcut: "Mod+N" }}
    onclick={onnewkey}><Plus size={15} /></button
  >
  <button
    class="btn ghost icon sm"
    aria-label={settings.treeView ? t("browser.header.listView") : t("browser.header.treeView")}
    use:tooltip={settings.treeView ? t("browser.header.listView") : t("browser.header.treeView")}
    onclick={() => (settings.treeView = !settings.treeView)}
  >
    {#if settings.treeView}<List size={15} />{:else}<ListTree size={15} />{/if}
  </button>
  <button class="btn ghost icon sm" aria-label={t("browser.header.more")} aria-haspopup="menu" use:tooltip={t("browser.header.more")} onclick={moreMenu}>
    <Ellipsis size={15} />
  </button>
</header>

<style>
  .head {
    display: flex;
    align-items: center;
    gap: 2px;
    height: 36px;
    flex: none;
    padding: 0 6px 0 6px;
    border-bottom: 1px solid var(--border);
  }

  .db {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    height: var(--h-control-sm);
    min-width: 0;
    padding: 0 6px 0 7px;
    border: 0;
    border-radius: var(--radius);
    background: none;
    color: var(--text);
    font-size: var(--fs);
    font-weight: 600;
    cursor: pointer;
  }

  .db:hover:not(:disabled) {
    background: var(--bg-hover);
  }

  .db:disabled {
    cursor: default;
  }

  .db :global(svg) {
    flex: none;
    color: var(--text-3);
  }

  .keys {
    color: var(--text-3);
    font-weight: 500;
  }

  :global(.browser-spin) {
    animation: browser-spin 0.9s linear infinite;
  }

  @keyframes browser-spin {
    to {
      transform: rotate(360deg);
    }
  }
</style>
