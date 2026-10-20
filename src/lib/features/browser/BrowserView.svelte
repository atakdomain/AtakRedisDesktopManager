<script lang="ts">
  // Anahtar gezgini: başlık, arama, durum, sanal ağaç/liste, seçim çubuğu; komutlar ve diyaloglar.
  import CaseSensitive from "@lucide/svelte/icons/case-sensitive";
  import ChevronsDownUp from "@lucide/svelte/icons/chevrons-down-up";
  import ChevronsUpDown from "@lucide/svelte/icons/chevrons-up-down";
  import Download from "@lucide/svelte/icons/download";
  import Files from "@lucide/svelte/icons/files";
  import Layers from "@lucide/svelte/icons/layers";
  import ListChecks from "@lucide/svelte/icons/list-checks";
  import ListTree from "@lucide/svelte/icons/list-tree";
  import PencilLine from "@lucide/svelte/icons/pencil-line";
  import Plus from "@lucide/svelte/icons/plus";
  import RefreshCw from "@lucide/svelte/icons/refresh-cw";
  import Regex from "@lucide/svelte/icons/regex";
  import Search from "@lucide/svelte/icons/search";
  import Timer from "@lucide/svelte/icons/timer";
  import Trash from "@lucide/svelte/icons/trash";
  import Upload from "@lucide/svelte/icons/upload";
  import { onDestroy } from "svelte";
  import BulkDialog from "$lib/features/bulk/BulkDialog.svelte";
  import ImportDialog from "$lib/features/bulk/ImportDialog.svelte";
  import { bulkUi, openBulkTab, openImport } from "$lib/features/bulk/state.svelte";
  import NewKeyDialog from "$lib/features/editors/NewKeyDialog.svelte";
  import { t } from "$lib/i18n/index.svelte";
  import { useCommands } from "$lib/state/commands.svelte";
  import { openContextMenu } from "$lib/state/menu.svelte";
  import { settings } from "$lib/state/settings.svelte";
  import type { Workspace } from "$lib/state/workspace.svelte";
  import { bulkOnSelection, copyNames, deleteSelection, renameSelection } from "./actions";
  import BrowserHeader from "./BrowserHeader.svelte";
  import { controllerFor } from "./controller.svelte";
  import KeyList from "./list/KeyList.svelte";
  import { emptyMenu, folderMenu, keyMenu, type MenuHooks } from "./menus";
  import { rowKey, type TreeRow } from "./model/tree";
  import ScanStatus from "./ScanStatus.svelte";
  import SearchBar from "./search/SearchBar.svelte";
  import SelectionBar from "./SelectionBar.svelte";

  let { ws }: { ws: Workspace } = $props();

  // svelte-ignore state_referenced_locally
  const ctl = controllerFor(ws);
  let root = $state<HTMLElement>();
  let search = $state<SearchBar>();
  let newKeyPrefix = $state<string | null>(null);

  ctl.actions = {
    remove: () => void deleteSelection(ws),
    rename: (row) => renameSelection(ws, row.key),
    copyNames: () => void copyNames(ws.selectedKeys()),
  };

  onDestroy(() => ctl.dispose());

  // Az sonuçlu aramada klasörleri aç
  $effect(() => {
    void ctl.rows;
    ctl.autoExpand();
  });

  // Görünen satırların tür/TTL bilgisi (tembel, parça parça)
  $effect(() => {
    if (!settings.showKeyMeta) return;
    const rows = ctl.rows;
    const [start, end] = ctl.range;
    const missing: string[] = [];
    for (let i = Math.max(0, start - 5); i < Math.min(rows.length, end + 10); i++) {
      const row = rows[i];
      if (row.kind === "key" && !ws.metaOf(row.id)) missing.push(row.id);
    }
    if (missing.length) ws.requestMeta(missing);
  });

  const hooks: MenuHooks = {
    newKey: (prefix) => (newKeyPrefix = prefix),
    refresh,
  };

  function refresh(): void {
    void ws.search();
    void ws.loadDbs();
  }

  function rowMenu(e: MouseEvent, row: TreeRow): void {
    if (row.kind === "key") ctl.ensureSelected(row);
    else ctl.cursor = rowKey(row);
    openContextMenu(e, row.kind === "key" ? keyMenu(ctl, row) : folderMenu(ctl, row, hooks));
  }

  function relax(what: "case" | "mode" | "types" | "term"): void {
    if (what === "case") search?.toggleCase();
    else if (what === "mode") search?.setMode("contains");
    else if (what === "types") ctl.setFilter({ ...ws.filter, types: [] }, true);
    else ctl.setFilter({ ...ws.filter, types: [...ws.filter.types], term: "" }, true);
  }

  function navigate(where: "down" | "escape"): void {
    ctl.list?.focus();
    if (where === "down" && ctl.cursorIndex() < 0) ctl.moveTo(0);
  }

  /** Alt+C / Alt+R başka bir metin alanındayken (ör. değer düzenleyici) o alana bırakılır */
  function ownsShortcut(): boolean {
    const el = document.activeElement;
    if (!el || el === document.body || root?.contains(el)) return true;
    return !(el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || (el as HTMLElement).isContentEditable || el.closest(".cm-editor"));
  }

  const hasSelection = () => ws.selection.size > 0 || ws.allMatching;
  const writable = () => hasSelection() && !ws.readOnly;
  const keysGroup = () => t("browser.commands.group");
  const bulkGroup = () => t("bulk.commands.group");

  useCommands([
    { id: "browser.focus-search", title: () => t("browser.commands.focusSearch"), group: keysGroup, icon: Search, shortcut: "Mod+F", inInputs: true, run: () => search?.focus() },
    { id: "browser.refresh", title: () => t("browser.commands.refresh"), group: keysGroup, icon: RefreshCw, shortcut: "Mod+R", inInputs: true, run: refresh },
    { id: "browser.new-key", title: () => t("browser.commands.newKey"), group: keysGroup, icon: Plus, shortcut: "Mod+N", inInputs: true, when: () => !ws.readOnly, run: () => (newKeyPrefix = "") },
    { id: "browser.toggle-case", title: () => t("browser.commands.toggleCase"), group: keysGroup, icon: CaseSensitive, shortcut: "Alt+C", inInputs: true, when: ownsShortcut, run: () => search?.toggleCase() },
    { id: "browser.toggle-regex", title: () => t("browser.commands.toggleRegex"), group: keysGroup, icon: Regex, shortcut: "Alt+R", inInputs: true, when: ownsShortcut, run: () => search?.toggleRegex() },
    { id: "browser.toggle-view", title: () => t("browser.commands.toggleView"), group: keysGroup, icon: ListTree, run: () => (settings.treeView = !settings.treeView) },
    { id: "browser.select-all", title: () => t("browser.commands.selectAll"), group: keysGroup, icon: ListChecks, when: () => ws.keyCount > 0, run: () => ctl.selectAll() },
    { id: "browser.clear-selection", title: () => t("browser.commands.clearSelection"), group: keysGroup, when: hasSelection, run: () => ws.clearSelection() },
    { id: "browser.load-all", title: () => t("browser.commands.loadAll"), group: keysGroup, icon: Download, when: () => !ws.scan.done, run: () => void ws.loadAll() },
    { id: "browser.expand-all", title: () => t("browser.commands.expandAll"), group: keysGroup, icon: ChevronsUpDown, when: () => settings.treeView, run: () => ctl.expandAll() },
    { id: "browser.collapse-all", title: () => t("browser.commands.collapseAll"), group: keysGroup, icon: ChevronsDownUp, when: () => settings.treeView, run: () => ctl.collapseAll() },
    { id: "bulk.open", title: () => t("bulk.commands.open"), group: bulkGroup, icon: Layers, run: () => openBulkTab(ws) },
    { id: "bulk.import", title: () => t("bulk.commands.import"), group: bulkGroup, icon: Upload, when: () => !ws.readOnly, run: () => openImport(ws) },
    { id: "bulk.delete-selection", title: () => t("bulk.commands.deleteSelection"), group: bulkGroup, icon: Trash, when: writable, run: () => void deleteSelection(ws) },
    { id: "bulk.ttl-selection", title: () => t("bulk.commands.ttlSelection"), group: bulkGroup, icon: Timer, when: writable, run: () => bulkOnSelection(ws, "expire") },
    { id: "bulk.rename-selection", title: () => t("bulk.commands.renameSelection"), group: bulkGroup, icon: PencilLine, when: writable, run: () => renameSelection(ws) },
    { id: "bulk.copy-selection", title: () => t("bulk.commands.copySelection"), group: bulkGroup, icon: Files, when: hasSelection, run: () => bulkOnSelection(ws, "copy") },
    { id: "bulk.export-selection", title: () => t("bulk.commands.exportSelection"), group: bulkGroup, icon: Download, when: hasSelection, run: () => bulkOnSelection(ws, "export") },
  ]);
</script>

<div class="browser" bind:this={root}>
  <BrowserHeader {ws} {ctl} onrefresh={refresh} onnewkey={() => (newKeyPrefix = "")} />
  <SearchBar {ctl} bind:this={search} onnavigate={navigate} />
  <ScanStatus {ws} />
  <div class="body">
    <KeyList {ctl} onrowmenu={rowMenu} onemptymenu={(e) => openContextMenu(e, emptyMenu(ctl, hooks))} onnewkey={() => (newKeyPrefix = "")} onrelax={relax} />
    <SelectionBar {ctl} />
  </div>
</div>

{#if newKeyPrefix !== null}
  <NewKeyDialog {ws} prefix={newKeyPrefix} onclose={() => (newKeyPrefix = null)} />
{/if}
{#if bulkUi.request && bulkUi.request.ws === ws}
  {#key bulkUi.request}
    <BulkDialog request={bulkUi.request} onclose={() => (bulkUi.request = null)} />
  {/key}
{/if}
{#if bulkUi.importFor === ws}
  <ImportDialog {ws} onclose={() => (bulkUi.importFor = null)} />
{/if}

<style>
  .browser {
    display: flex;
    flex-direction: column;
    height: 100%;
    min-width: 0;
  }

  .body {
    position: relative;
    display: flex;
    flex-direction: column;
    flex: 1;
    min-height: 0;
    border-top: 1px solid var(--border-subtle);
  }
</style>
