// Bir bağlantı üzerindeki işlemler: ray, ana sayfa kartları, durum ekranı ve komut paleti ortak kullanır.
import CopyPlus from "@lucide/svelte/icons/copy-plus";
import FolderInput from "@lucide/svelte/icons/folder-input";
import Link from "@lucide/svelte/icons/link";
import Pencil from "@lucide/svelte/icons/pencil";
import Plug from "@lucide/svelte/icons/plug";
import RefreshCw from "@lucide/svelte/icons/refresh-cw";
import Trash from "@lucide/svelte/icons/trash";
import Unplug from "@lucide/svelte/icons/unplug";
import type { ConnectionConfig } from "$lib/api/types";
import { t } from "$lib/i18n/index.svelte";
import { connections } from "$lib/state/connections.svelte";
import { confirm, prompt } from "$lib/state/dialogs.svelte";
import { openMenu, type MenuItem } from "$lib/state/menu.svelte";
import { toast, toastError } from "$lib/state/toasts.svelte";
import { ui } from "$lib/state/ui.svelte";
import { dropWorkspace } from "$lib/state/workspace.svelte";
import { copyText } from "$lib/util/clipboard";
import type { Anchor } from "$lib/util/position";
import { displayName, uniqueName } from "./connectionInfo";
import { touchRecent } from "./prefs.svelte";
import { formatRedisUrl } from "./redisUrl";
import { moveConnection } from "./reorder";

/** Bağlanır ve etkin yapar; son kullanılanlara yazar. */
export function connectTo(id: string, force = false): void {
  touchRecent(id);
  void connections.connect(id, force);
}

export function editConnection(c: ConnectionConfig): void {
  ui.connectionEditor = $state.snapshot(c);
}

export async function duplicateConnection(c: ConnectionConfig): Promise<void> {
  try {
    const name = uniqueName(
      t("connections.copyName", { name: displayName(c) }),
      connections.list.map((x) => displayName(x)),
    );
    const saved = await connections.save({ ...$state.snapshot(c), id: "", name });
    // Kopya, aslının hemen altına
    const moved = moveConnection(connections.list, saved.id, { kind: "after", id: c.id });
    if (moved) await connections.reorder(moved.ids);
    toast("success", t("connections.duplicated"), { action: { label: t("common.edit"), run: () => editConnection(saved) } });
  } catch (err) {
    toastError(err);
  }
}

/** Onaylanıp silinirse true */
export async function deleteConnection(c: ConnectionConfig): Promise<boolean> {
  const ok = await confirm({
    title: t("connections.deleteConfirm.title", { name: displayName(c) }),
    message: t("connections.deleteConfirm.message"),
    confirmLabel: t("connections.deleteConfirm.confirm"),
    danger: true,
  });
  if (!ok) return false;
  try {
    await connections.remove(c.id);
    dropWorkspace(c.id);
    return true;
  } catch (err) {
    toastError(err);
    return false;
  }
}

export async function copyConnectionUrl(c: ConnectionConfig): Promise<void> {
  try {
    await copyText(formatRedisUrl(c));
    toast("success", t("connections.urlCopied"), { message: t("connections.urlCopiedHint") });
  } catch (err) {
    toastError(err);
  }
}

async function setGroup(c: ConnectionConfig, group: string): Promise<void> {
  if (group === c.group) return;
  try {
    await connections.save({ ...$state.snapshot(c), group });
  } catch (err) {
    toastError(err);
  }
}

export function openGroupMenu(c: ConnectionConfig, anchor: Anchor): void {
  const items: MenuItem[] = [
    { label: t("connections.menu.noGroup"), checked: c.group === "", run: () => setGroup(c, "") },
    ...connections.groups.map((g): MenuItem => ({ label: g, checked: c.group === g, run: () => setGroup(c, g) })),
    { kind: "separator" },
    {
      label: t("connections.menu.newGroup"),
      run: async () => {
        const name = await prompt({
          title: t("connections.newGroup.title"),
          label: t("connections.newGroup.label"),
          placeholder: t("connections.newGroup.placeholder"),
          validate: (value) => (value.trim() ? null : t("common.required")),
        });
        if (name?.trim()) await setGroup(c, name.trim());
      },
    },
  ];
  openMenu(items, anchor, { minWidth: 200 });
}

/** Sağ tık menüsü. `anchor` alt menünün (gruba taşı) açılacağı yer. */
export function connectionMenu(c: ConnectionConfig, anchor: Anchor): MenuItem[] {
  const status = connections.status[c.id] ?? "idle";
  const live = status === "connected" || status === "connecting";
  return [
    live
      ? { label: t("connections.menu.disconnect"), icon: Unplug, run: () => connections.disconnect(c.id) }
      : { label: t("connections.menu.connect"), icon: Plug, shortcut: "Enter", run: () => connectTo(c.id) },
    { label: t("connections.menu.reconnect"), icon: RefreshCw, disabled: status === "idle", run: () => connectTo(c.id, true) },
    { kind: "separator" },
    { label: t("connections.menu.edit"), icon: Pencil, shortcut: "F2", run: () => editConnection(c) },
    { label: t("connections.menu.duplicate"), icon: CopyPlus, run: () => duplicateConnection(c) },
    { label: t("connections.menu.copyUrl"), icon: Link, run: () => copyConnectionUrl(c) },
    { label: t("connections.menu.moveToGroup"), icon: FolderInput, run: () => openGroupMenu(c, anchor) },
    { kind: "separator" },
    { label: t("connections.menu.delete"), icon: Trash, danger: true, shortcut: "Delete", run: () => deleteConnection(c) },
  ];
}
