// Bağlam menüleri: anahtar, klasör, çoklu seçim ve boş alan.
import ChevronsDownUp from "@lucide/svelte/icons/chevrons-down-up";
import ChevronsUpDown from "@lucide/svelte/icons/chevrons-up-down";
import Copy from "@lucide/svelte/icons/copy";
import CopyPlus from "@lucide/svelte/icons/copy-plus";
import Download from "@lucide/svelte/icons/download";
import Eye from "@lucide/svelte/icons/eye";
import Files from "@lucide/svelte/icons/files";
import FolderPen from "@lucide/svelte/icons/folder-pen";
import Layers from "@lucide/svelte/icons/layers";
import ListChecks from "@lucide/svelte/icons/list-checks";
import PencilLine from "@lucide/svelte/icons/pencil-line";
import Plus from "@lucide/svelte/icons/plus";
import RefreshCw from "@lucide/svelte/icons/refresh-cw";
import SquareTerminal from "@lucide/svelte/icons/square-terminal";
import Timer from "@lucide/svelte/icons/timer";
import Trash from "@lucide/svelte/icons/trash";
import { keysSource } from "$lib/features/bulk/source";
import { openBulkDialog, openBulkTab } from "$lib/features/bulk/state.svelte";
import { t } from "$lib/i18n/index.svelte";
import type { MenuItem } from "$lib/state/menu.svelte";
import { settings } from "$lib/state/settings.svelte";
import { copyText } from "$lib/util/clipboard";
import { bulkOnFolder, bulkOnSelection, copyCommand, copyNames, deleteOne, deleteSelection, duplicateOne, openFolderInBulk, renameOne } from "./actions";
import type { BrowserController } from "./controller.svelte";
import type { FolderNode, KeyNode } from "./model/tree";

export interface MenuHooks {
  newKey: (prefix: string) => void;
  refresh: () => void;
}

export function keyMenu(ctl: BrowserController, row: KeyNode): MenuItem[] {
  const ws = ctl.ws;
  if (ws.allMatching || (ws.selection.size > 1 && ws.selection.has(row.id))) return selectionMenu(ctl);
  const ro = ws.readOnly;
  return [
    { label: t("browser.menu.open"), icon: Eye, run: () => ws.openKey(row.key, true) },
    { label: t("browser.menu.openPinned"), shortcut: "Enter", run: () => ws.openKey(row.key, false) },
    { kind: "separator" },
    { label: t("browser.menu.copyName"), icon: Copy, shortcut: "Mod+C", run: () => copyNames([row.key]) },
    { label: t("browser.menu.copyCommand"), icon: SquareTerminal, run: () => copyCommand(ws, row.key) },
    { kind: "separator" },
    { label: t("browser.menu.rename"), icon: PencilLine, shortcut: "F2", disabled: ro, run: () => renameOne(ws, row.key) },
    { label: t("browser.menu.ttl"), icon: Timer, disabled: ro, run: () => openBulkDialog({ ws, action: "expire", source: keysSource([row.key]) }) },
    { label: t("browser.menu.duplicate"), icon: CopyPlus, disabled: ro, run: () => duplicateOne(ws, row.key) },
    { kind: "separator" },
    { label: t("browser.menu.delete"), icon: Trash, shortcut: "Delete", danger: true, disabled: ro, run: () => deleteOne(ws, row.key) },
  ];
}

export function selectionMenu(ctl: BrowserController): MenuItem[] {
  const ws = ctl.ws;
  const ro = ws.readOnly;
  const header = ws.allMatching ? t("browser.selection.allMatching") : t("browser.menu.selectedHeader", { count: ws.selection.size });
  return [
    { kind: "header", label: header },
    { label: t("browser.menu.copyNames"), icon: Copy, shortcut: "Mod+C", disabled: ws.allMatching, run: () => copyNames(ws.selectedKeys()) },
    { label: t("browser.menu.ttlSelected"), icon: Timer, disabled: ro, run: () => bulkOnSelection(ws, "expire") },
    { label: t("browser.menu.renameSelected"), icon: PencilLine, disabled: ro, run: () => bulkOnSelection(ws, "rename") },
    { label: t("browser.menu.copySelected"), icon: Files, run: () => bulkOnSelection(ws, "copy") },
    { label: t("browser.menu.exportSelected"), icon: Download, run: () => bulkOnSelection(ws, "export") },
    { label: t("browser.selection.openBulk"), icon: Layers, run: () => openBulkTab(ws, { source: "selection" }) },
    { kind: "separator" },
    { label: t("browser.menu.deleteSelected"), icon: Trash, shortcut: "Delete", danger: true, disabled: ro, run: () => deleteSelection(ws) },
    { kind: "separator" },
    { label: t("browser.selection.clear"), shortcut: "Escape", run: () => ws.clearSelection() },
  ];
}

export function folderMenu(ctl: BrowserController, folder: FolderNode, hooks: MenuHooks): MenuItem[] {
  const ws = ctl.ws;
  const ro = ws.readOnly;
  const open = ctl.isExpanded(folder);
  const all = ctl.folderCheck(folder) === "all";
  const prefix = folder.path + ws.separator;
  return [
    { label: open ? t("browser.menu.collapse") : t("browser.menu.expand"), run: () => ctl.toggleFolder(folder) },
    { label: t("browser.menu.expandAllBelow"), icon: ChevronsUpDown, disabled: folder.folders.length === 0, run: () => ctl.expandBelow(folder) },
    { label: all ? t("browser.menu.deselectFolder") : t("browser.menu.selectFolder"), icon: ListChecks, run: () => ctl.selectFolder(folder, !all) },
    { kind: "separator" },
    { label: t("browser.menu.newKeyHere"), icon: Plus, disabled: ro, run: () => hooks.newKey(prefix) },
    { label: t("browser.menu.copyPath"), icon: Copy, run: () => copyText(prefix) },
    { kind: "separator" },
    { label: t("browser.menu.ttlFolder"), icon: Timer, disabled: ro, run: () => bulkOnFolder(ctl, folder, "expire") },
    { label: t("browser.menu.renameFolder"), icon: FolderPen, disabled: ro || folder.binary, run: () => bulkOnFolder(ctl, folder, "rename") },
    { label: t("browser.menu.copyFolder"), icon: Files, run: () => bulkOnFolder(ctl, folder, "copy") },
    { label: t("browser.menu.exportFolder"), icon: Download, run: () => bulkOnFolder(ctl, folder, "export") },
    { label: t("browser.menu.openBulk"), icon: Layers, run: () => openFolderInBulk(ctl, folder) },
    { kind: "separator" },
    { label: t("browser.menu.deleteFolder"), icon: Trash, danger: true, disabled: ro, run: () => bulkOnFolder(ctl, folder, "delete") },
  ];
}

export function emptyMenu(ctl: BrowserController, hooks: MenuHooks): MenuItem[] {
  const ws = ctl.ws;
  return [
    { label: t("browser.header.newKey"), icon: Plus, shortcut: "Mod+N", disabled: ws.readOnly, run: () => hooks.newKey("") },
    { label: t("browser.header.refresh"), icon: RefreshCw, shortcut: "Mod+R", run: hooks.refresh },
    { kind: "separator" },
    { label: t("browser.menu.selectAll"), icon: ListChecks, shortcut: "Mod+A", disabled: ws.keyCount === 0, run: () => ctl.selectAll() },
    { label: t("browser.header.expandAll"), icon: ChevronsUpDown, disabled: !settings.treeView, run: () => ctl.expandAll() },
    { label: t("browser.header.collapseAll"), icon: ChevronsDownUp, disabled: !settings.treeView, run: () => ctl.collapseAll() },
    { kind: "separator" },
    { label: t("browser.header.bulk"), icon: Layers, run: () => openBulkTab(ws) },
  ];
}
