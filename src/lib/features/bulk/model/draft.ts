// Toplu işlem taslağı: hızlı diyaloglar ve Toplu işlem sekmesi aynı form durumunu paylaşır.
// `buildAction` taslağı arka uca gidecek BulkAction'a çevirir ya da ilk hatayı döndürür.
import type { BulkAction, ExportFormat } from "$lib/api/types";
import { prefixRename, regexError } from "./patterns";

export type ActionKind = BulkAction["kind"];
export type TtlUnit = "s" | "m" | "h" | "d";
export type TtlMode = "relative" | "persist" | "absolute";
export type RenameMode = "prefix" | "replace";

export const ACTION_KINDS: readonly ActionKind[] = ["delete", "expire", "rename", "copy", "export"];

export interface BulkDraft {
  action: ActionKind;
  /** Silmeden önce dışa aktar */
  backup: boolean;
  ttlMode: TtlMode;
  ttlAmount: number;
  ttlUnit: TtlUnit;
  /** `<input type="datetime-local">` değeri */
  ttlAt: string;
  onlyWithoutTtl: boolean;
  renameMode: RenameMode;
  oldPrefix: string;
  newPrefix: string;
  find: string;
  replace: string;
  regex: boolean;
  caseSensitive: boolean;
  overwrite: boolean;
  /** Boş: aynı bağlantı */
  targetConnectionId: string;
  targetDb: number;
  replaceExisting: boolean;
  moveKeys: boolean;
  format: ExportFormat;
  path: string;
}

export function newDraft(action: ActionKind, patch: Partial<BulkDraft> = {}): BulkDraft {
  return {
    action,
    backup: false,
    ttlMode: "relative",
    ttlAmount: 1,
    ttlUnit: "h",
    ttlAt: "",
    onlyWithoutTtl: false,
    renameMode: "replace",
    oldPrefix: "",
    newPrefix: "",
    find: "",
    replace: "",
    regex: false,
    caseSensitive: true,
    overwrite: false,
    targetConnectionId: "",
    targetDb: 0,
    replaceExisting: false,
    moveKeys: false,
    format: "dump",
    path: "",
    ...patch,
  };
}

export const UNIT_MS: Record<TtlUnit, number> = { s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000 };

export type DraftError = "ttlAmount" | "ttlDate" | "ttlPast" | "findEmpty" | "regexInvalid" | "prefixSame" | "copySame";

export type DraftResult = { ok: true; action: BulkAction } | { ok: false; error: DraftError; detail?: string };

export interface DraftContext {
  connectionId: string;
  db: number;
  now: number;
  /** Dışa aktarma yolu henüz seçilmediyse kuru çalıştırmada kullanılacak yer tutucu */
  previewPath?: string;
}

/** `datetime-local` değeri → Unix ms (yerel saat); geçersizse NaN */
export function parseLocalDateTime(value: string): number {
  return value ? new Date(value).getTime() : Number.NaN;
}

export function ttlMs(draft: Pick<BulkDraft, "ttlMode" | "ttlAmount" | "ttlUnit" | "ttlAt">, now: number): number | DraftError {
  if (draft.ttlMode === "persist") return 0;
  if (draft.ttlMode === "relative") {
    const amount = Number(draft.ttlAmount);
    if (!Number.isFinite(amount) || amount <= 0) return "ttlAmount";
    return Math.round(amount * UNIT_MS[draft.ttlUnit]);
  }
  const at = parseLocalDateTime(draft.ttlAt);
  if (!Number.isFinite(at)) return "ttlDate";
  if (at <= now) return "ttlPast";
  return at - now;
}

export function buildAction(draft: BulkDraft, ctx: DraftContext): DraftResult {
  switch (draft.action) {
    case "delete":
      return { ok: true, action: { kind: "delete" } };
    case "expire": {
      const ms = ttlMs(draft, ctx.now);
      if (typeof ms === "string") return { ok: false, error: ms };
      return { ok: true, action: { kind: "expire", ttlMs: ms, onlyWithoutTtl: ms > 0 && draft.onlyWithoutTtl } };
    }
    case "rename": {
      if (draft.renameMode === "prefix") {
        if (!draft.oldPrefix) return { ok: false, error: "findEmpty" };
        if (draft.oldPrefix === draft.newPrefix) return { ok: false, error: "prefixSame" };
        return { ok: true, action: { kind: "rename", ...prefixRename(draft.oldPrefix, draft.newPrefix), overwrite: draft.overwrite } };
      }
      if (!draft.find) return { ok: false, error: "findEmpty" };
      if (draft.regex) {
        const detail = regexError(draft.find);
        if (detail) return { ok: false, error: "regexInvalid", detail };
      }
      return {
        ok: true,
        action: { kind: "rename", find: draft.find, replace: draft.replace, regex: draft.regex, caseSensitive: draft.caseSensitive, overwrite: draft.overwrite },
      };
    }
    case "copy": {
      const target = draft.targetConnectionId || ctx.connectionId;
      if (target === ctx.connectionId && draft.targetDb === ctx.db) return { ok: false, error: "copySame" };
      return {
        ok: true,
        action: { kind: "copy", targetConnectionId: target === ctx.connectionId ? "" : target, targetDb: draft.targetDb, replace: draft.replaceExisting, moveKeys: draft.moveKeys },
      };
    }
    case "export":
      return { ok: true, action: { kind: "export", path: draft.path || ctx.previewPath || "", format: draft.format } };
  }
}

/** İş kaynağa yazar mı (salt okunur bağlantıda kapalı) */
export function writesSource(action: BulkAction): boolean {
  if (action.kind === "export") return false;
  if (action.kind === "copy") return action.moveKeys;
  return true;
}

/** Canlı ortamda yazılı onay istenecek işlemler: geri alınamayan ya da veriyi kaybettirebilenler */
export function isDestructive(action: BulkAction): boolean {
  switch (action.kind) {
    case "delete":
    case "rename":
      return true;
    case "expire":
      return action.ttlMs > 0;
    case "copy":
      return action.moveKeys || action.replace;
    case "export":
      return false;
  }
}

/** Önizlemenin hâlâ geçerli olup olmadığını anlamak için kararlı imza */
export function specSignature(value: unknown): string {
  return JSON.stringify(value);
}
