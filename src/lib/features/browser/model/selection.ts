// Görünür sıraya göre seçim yardımcıları (Shift+tık, Shift+ok).
import type { TreeRow } from "./tree";

export function indexOfKey(rows: readonly TreeRow[], id: string): number {
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    if (row.kind === "key" && row.id === id) return i;
  }
  return -1;
}

/** `from` ile `to` arasındaki (iki uç dahil, yön fark etmez) anahtar kimlikleri, görünür sırayla */
export function rangeIds(rows: readonly TreeRow[], from: number, to: number): string[] {
  const lo = Math.max(0, Math.min(from, to));
  const hi = Math.min(rows.length - 1, Math.max(from, to));
  const out: string[] = [];
  for (let i = lo; i <= hi; i++) {
    const row = rows[i];
    if (row.kind === "key") out.push(row.id);
  }
  return out;
}

/**
 * Shift ile seçim: çapa görünür bir satırsa çapadan hedefe kadar; değilse yalnızca hedef.
 * `base` verilirse (Ctrl+Shift) aralık mevcut seçime eklenir.
 */
export function rangeSelection(rows: readonly TreeRow[], anchorId: string | null, target: number, base?: ReadonlySet<string>): Set<string> {
  const from = anchorId === null ? -1 : indexOfKey(rows, anchorId);
  const ids = rangeIds(rows, from < 0 ? target : from, target);
  const out = new Set(base);
  for (const id of ids) out.add(id);
  return out;
}

/** Onay kutusu durumu: tümü / bir kısmı / hiçbiri */
export function checkState(selected: number, total: number): "all" | "some" | "none" {
  if (selected <= 0) return "none";
  return selected >= total ? "all" : "some";
}
