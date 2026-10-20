// Gezgin eylemleri: tek anahtar işlemleri doğrudan API ile, çoklu/klasör işlemleri toplu işlem diyaloğuyla.
import { api, ApiError } from "$lib/api";
import { bytesId, isBinary, label } from "$lib/api/bytes";
import type { RBytes } from "$lib/api/types";
import { renamePreset } from "$lib/features/bulk/flow.svelte";
import type { ActionKind } from "$lib/features/bulk/model/draft";
import { folderFilter } from "$lib/features/bulk/model/patterns";
import { filterSource, keysSource, type SourceSpec } from "$lib/features/bulk/source";
import { openBulkDialog, openBulkTab } from "$lib/features/bulk/state.svelte";
import { t } from "$lib/i18n/index.svelte";
import { connections } from "$lib/state/connections.svelte";
import { confirm, prompt } from "$lib/state/dialogs.svelte";
import { toast, toastError } from "$lib/state/toasts.svelte";
import type { Workspace } from "$lib/state/workspace.svelte";
import { copyText } from "$lib/util/clipboard";
import type { BrowserController } from "./controller.svelte";
import { readCommand } from "./model/command";
import { commonFolder, parseLabel } from "./model/names";
import type { FolderNode } from "./model/tree";

function production(ws: Workspace): string | undefined {
  const conn = connections.byId(ws.connectionId);
  return conn?.env === "production" ? conn.name : undefined;
}

// ───────────── kaynaklar ─────────────

/** Seçim → toplu iş kaynağı. "Tüm eşleşenler" seçiliyse gezginin süzgeci (sunucu tarafı) */
export function selectionSource(ws: Workspace): SourceSpec | null {
  if (ws.allMatching) return filterSource(ws.filter);
  const keys = ws.selectedKeys();
  return keys.length ? keysSource(keys) : null;
}

/**
 * Klasör → kaynak: sunucuda `yol + ayırıcı` önekiyle (yüklenmemişler dahil, büyük/küçük harf duyarlı).
 * Altında ikili ad varsa desen birebir kurulamaz; yalnızca yüklenen anahtarlar kullanılır.
 */
export function folderSource(ctl: BrowserController, folder: FolderNode): SourceSpec {
  if (folder.binary) return keysSource(ctl.model.keysUnder(folder).map((k) => k.key));
  return filterSource(folderFilter(folder.path, ctl.ws.separator), folder.path);
}

// ───────────── toplu işlem diyaloğu ─────────────

export function bulkOnSelection(ws: Workspace, action: ActionKind): void {
  const source = selectionSource(ws);
  if (!source) return;
  const draft = action === "rename" && source.kind === "keys" ? renamePreset(commonFolder(source.keys.map(label), ws.separator) || undefined, ws.separator) : {};
  openBulkDialog({ ws, action, source, draft });
}

export function bulkOnFolder(ctl: BrowserController, folder: FolderNode, action: ActionKind): void {
  const draft = action === "rename" ? renamePreset(folder.path, ctl.ws.separator) : {};
  openBulkDialog({ ws: ctl.ws, action, source: folderSource(ctl, folder), draft });
}

export function openFolderInBulk(ctl: BrowserController, folder: FolderNode): void {
  openBulkTab(ctl.ws, { source: "folder", folder: folder.path });
}

// ───────────── tek anahtar ─────────────

export async function copyNames(keys: readonly RBytes[]): Promise<void> {
  if (keys.length === 0) return;
  try {
    await copyText(keys.map(label).join("\n"));
    toast("success", keys.length === 1 ? t("browser.actions.copied") : t("browser.actions.copiedNames", { count: keys.length }), { timeout: 1600 });
  } catch (err) {
    toastError(err);
  }
}

export async function copyCommand(ws: Workspace, key: RBytes): Promise<void> {
  try {
    const id = bytesId(key);
    let type = ws.metaOf(id)?.type;
    if (!type) {
      const [meta] = await api.keys.meta(ws.connectionId, ws.db, [key]);
      ws.setMeta(id, meta);
      type = meta.type;
    }
    await copyText(readCommand(type, key));
    toast("success", t("browser.actions.copiedCommand"), { message: readCommand(type, key), timeout: 2000 });
  } catch (err) {
    toastError(err);
  }
}

/** Seçimi siler: tek anahtarda kısa onay, çokta/klasörde önizlemeli toplu silme */
export async function deleteSelection(ws: Workspace): Promise<void> {
  if (ws.readOnly) return;
  if (!ws.allMatching && ws.selection.size === 1) {
    const [key] = ws.selectedKeys();
    if (key !== undefined) await deleteOne(ws, key);
    return;
  }
  bulkOnSelection(ws, "delete");
}

/** Tek anahtar: kırmızı onay yeter; canlı ortamda ad yazdırma toplu silmeye bırakılır */
export async function deleteOne(ws: Workspace, key: RBytes): Promise<void> {
  const ok = await confirm({
    title: t("browser.actions.deleteTitle"),
    message: t("browser.actions.deleteMessage"),
    details: [label(key)],
    danger: true,
    confirmLabel: t("common.delete"),
  });
  if (!ok) return;
  try {
    await api.keys.remove(ws.connectionId, ws.db, [key]);
    ws.removeKeys([bytesId(key)]);
    void ws.loadDbs();
    toast("success", t("browser.actions.deleted"), { message: label(key), timeout: 2000 });
  } catch (err) {
    ws.handleError(err);
  }
}

function nameValidator(original: string) {
  return (value: string) => {
    if (!value) return t("browser.actions.nameRequired");
    if (value === original) return t("browser.actions.nameSame");
    return null;
  };
}

export async function renameOne(ws: Workspace, key: RBytes): Promise<void> {
  if (ws.readOnly) return;
  const binary = isBinary(key);
  const original = label(key);
  const value = await prompt({
    title: t("browser.actions.renameTitle"),
    message: binary ? t("browser.actions.renameBinary") : undefined,
    label: t("browser.actions.renameLabel"),
    value: original,
    mono: true,
    confirmLabel: t("common.rename"),
    validate: nameValidator(original),
  });
  if (value === null) return;
  const target = parseLabel(value, binary);
  try {
    await api.keys.rename(ws.connectionId, ws.db, key, target, false);
  } catch (err) {
    if (!(err instanceof ApiError && err.kind === "exists")) {
      ws.handleError(err);
      return;
    }
    const overwrite = await confirm({
      title: t("browser.actions.renameExistsTitle"),
      message: t("browser.actions.renameExists", { key: value }),
      danger: true,
      requireText: production(ws),
      confirmLabel: t("browser.actions.overwrite"),
    });
    if (!overwrite) return;
    try {
      await api.keys.rename(ws.connectionId, ws.db, key, target, true);
    } catch (again) {
      ws.handleError(again);
      return;
    }
  }
  ws.renameKey(key, target);
  toast("success", t("browser.actions.renamed"), { message: label(target), timeout: 2000 });
}

/** Seçimde birden çok anahtar varsa toplu yeniden adlandırma, tek anahtarda doğrudan */
export function renameSelection(ws: Workspace, fallback?: RBytes): void {
  if (ws.readOnly) return;
  if (!ws.allMatching && ws.selection.size > 1) {
    bulkOnSelection(ws, "rename");
    return;
  }
  const key = ws.allMatching ? undefined : (ws.selectedKeys()[0] ?? fallback);
  if (ws.allMatching) bulkOnSelection(ws, "rename");
  else if (key !== undefined) void renameOne(ws, key);
}

/** Aynı veritabanında yeni ada kopya (TTL korunur) */
export async function duplicateOne(ws: Workspace, key: RBytes): Promise<void> {
  if (ws.readOnly) return;
  const binary = isBinary(key);
  const original = label(key);
  const value = await prompt({
    title: t("browser.actions.duplicateTitle"),
    message: binary ? t("browser.actions.renameBinary") : undefined,
    label: t("browser.actions.duplicateLabel"),
    value: `${original}${ws.separator}${t("browser.actions.copySuffix")}`,
    mono: true,
    confirmLabel: t("common.duplicate"),
    validate: (v) => nameValidator(original)(v) ?? (ws.keyById(bytesId(parseLabel(v, binary))) ? t("browser.actions.nameLoaded") : null),
  });
  if (value === null) return;
  const target = parseLabel(value, binary);
  try {
    await api.keys.copy(ws.connectionId, ws.db, key, target, false);
    const meta = ws.metaOf(bytesId(key));
    ws.addKey(target, meta);
    void ws.loadDbs();
    toast("success", t("browser.actions.duplicated"), { message: value, timeout: 2000 });
  } catch (err) {
    if (err instanceof ApiError && err.kind === "exists") toast("warning", t("browser.actions.duplicateExists"), { message: value });
    else toastError(err, t("browser.actions.duplicateFailed"));
  }
}
