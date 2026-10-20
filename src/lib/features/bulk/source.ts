// Toplu işin kaynağı: açık anahtar listesi (seçim) ya da sunucuda taranacak süzgeç (klasör, arama, "tüm eşleşenler").
// `id` önizlemenin hâlâ aynı kaynağa ait olup olmadığını anlamak içindir; kaynak her değiştiğinde yenisi üretilir.
import { label } from "$lib/api/bytes";
import type { BulkSource, KeyFilter, RBytes } from "$lib/api/types";
import { t } from "$lib/i18n/index.svelte";
import { uid } from "$lib/util/id";

export type SourceSpec =
  | { id: string; kind: "keys"; keys: RBytes[] }
  /** `folder`: klasörden geldiyse yol (ayırıcısız) — yeniden adlandırma ön ayarı ve başlık için */
  | { id: string; kind: "filter"; filter: KeyFilter; folder?: string };

export function keysSource(keys: RBytes[]): SourceSpec {
  return { id: uid(), kind: "keys", keys };
}

export function filterSource(filter: KeyFilter, folder?: string): SourceSpec {
  return { id: uid(), kind: "filter", filter: { ...filter, types: [...filter.types] }, folder };
}

export function toBulkSource(source: SourceSpec): BulkSource {
  return source.kind === "keys" ? { kind: "keys", keys: source.keys } : { kind: "filter", filter: source.filter };
}

export function filterLabel(filter: KeyFilter): string {
  if (!filter.term && filter.types.length === 0) return t("bulk.source.filterAll");
  let text = filter.term ? t("bulk.source.filterLabel", { mode: t(`browser.search.modes.${filter.mode}`), term: filter.term }) : t("bulk.source.filterAll");
  if (filter.caseSensitive && filter.term) text += " · Aa";
  if (filter.types.length) text += ` · ${filter.types.join(", ")}`;
  return text;
}

/** Kısa insan dili: iş başlığı ve diyalog alt başlığı */
export function sourceLabel(source: SourceSpec): string {
  if (source.kind === "keys") {
    return source.keys.length === 1 ? label(source.keys[0]) : t("bulk.source.keys", { count: source.keys.length });
  }
  if (source.folder !== undefined) return t("bulk.source.folderLabel", { folder: source.folder });
  return filterLabel(source.filter);
}
