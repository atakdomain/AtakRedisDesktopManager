// Kaydet / aç diyalogları. Tauri dışında (tarayıcı önizlemesi) kaydetmede varsayılan yol, açmada yol istemi kullanılır.
import { inTauri } from "$lib/api";
import type { ExportFormat } from "$lib/api/types";
import { t } from "$lib/i18n/index.svelte";
import { prompt } from "$lib/state/dialogs.svelte";

const EXTENSION: Record<ExportFormat, string> = { dump: "jsonl", json: "json" };

function stamp(date: Date): string {
  const two = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}${two(date.getMonth() + 1)}${two(date.getDate())}-${two(date.getHours())}${two(date.getMinutes())}`;
}

/** `canli-onbellek-db0-20261020-1640.jsonl` gibi dosya adı */
export function exportFileName(connectionName: string, db: number, format: ExportFormat, now = new Date()): string {
  const slug =
    connectionName
      .toLocaleLowerCase("tr")
      .normalize("NFKD")
      .replace(/[̀-ͯ]/g, "")
      .replace(/ı/g, "i")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "redis";
  return `${slug}-db${db}-${stamp(now)}.${EXTENSION[format]}`;
}

export async function pickSavePath(title: string, fileName: string, format: ExportFormat): Promise<string | null> {
  if (!inTauri) return fileName;
  const { save } = await import("@tauri-apps/plugin-dialog");
  return save({ title, defaultPath: fileName, filters: [{ name: t("bulk.import.filterName"), extensions: [EXTENSION[format]] }] });
}

export async function pickOpenPath(title: string): Promise<string | null> {
  if (!inTauri) return prompt({ title, label: t("bulk.import.browserPath"), value: "redis-export.jsonl", mono: true });
  const { open } = await import("@tauri-apps/plugin-dialog");
  const picked = await open({ title, multiple: false, directory: false, filters: [{ name: t("bulk.import.filterName"), extensions: ["jsonl", "json"] }] });
  return typeof picked === "string" ? picked : null;
}
