import { ApiError } from "$lib/api";
import { t } from "$lib/i18n/index.svelte";
import { FormatError } from "./codec/formats";

/** Biçim ve API hatalarını tek satırlık yerelleştirilmiş metne çevirir. */
export function describeError(err: unknown): string {
  if (err instanceof FormatError) {
    let text = t(`editors.errors.${err.code}`);
    if (err.line !== undefined) text += ` — ${t("editors.errors.at", { line: err.line, column: err.column ?? 1 })}`;
    else if (["codec", "notMsgpack", "notPhp", "encode"].includes(err.code) && err.message !== err.code) text += ` — ${err.message}`;
    return text;
  }
  if (err instanceof ApiError) return `${t(`common.errors.${err.kind}`)}: ${err.message}`;
  return err instanceof Error ? err.message : String(err);
}
