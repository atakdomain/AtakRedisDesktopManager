// Önizleme (kuru çalıştırma) sonuçları için saf yardımcılar: not sayıları, eski → yeni ad farkı, hız ve kalan süre.
import type { BulkNote, BulkSampleItem } from "$lib/api/types";

export type NoteCounts = Record<BulkNote, number>;

export function noteCounts(samples: readonly BulkSampleItem[]): NoteCounts {
  const counts: NoteCounts = { "": 0, exists: 0, duplicate: 0, unchanged: 0, hasTtl: 0, binary: 0 };
  for (const item of samples) counts[item.note] = (counts[item.note] ?? 0) + 1;
  return counts;
}

export interface NameDiff {
  prefix: string;
  removed: string;
  added: string;
  suffix: string;
}

const WORD = /[\p{L}\p{N}_]/u;

function isWord(ch: string | undefined): boolean {
  return ch !== undefined && WORD.test(ch);
}

/**
 * Ortak baş ve son atılır; ortadaki değişen kısım iki tarafta ayrı vurgulanır.
 * Sınırlar sözcük ortasına düşerse sözcük başına/sonuna genişletilir (`user` → `member`, `us` → `memb` değil).
 */
export function nameDiff(before: string, after: string): NameDiff {
  const max = Math.min(before.length, after.length);
  let start = 0;
  while (start < max && before.charCodeAt(start) === after.charCodeAt(start)) start++;
  // Vekil çiftini ortadan bölme
  if (start > 0 && isHighSurrogate(before.charCodeAt(start - 1))) start--;
  let end = 0;
  while (end < max - start && before.charCodeAt(before.length - 1 - end) === after.charCodeAt(after.length - 1 - end)) end++;
  if (end > 0 && isLowSurrogate(before.charCodeAt(before.length - end))) end--;
  while (start > 0 && isWord(before[start - 1]) && (isWord(before[start]) || isWord(after[start]))) start--;
  while (end > 0 && isWord(before[before.length - end]) && (isWord(before[before.length - end - 1]) || isWord(after[after.length - end - 1]))) end--;
  return {
    prefix: before.slice(0, start),
    removed: before.slice(start, before.length - end),
    added: after.slice(start, after.length - end),
    suffix: before.slice(before.length - end),
  };
}

function isHighSurrogate(code: number): boolean {
  return code >= 0xd800 && code <= 0xdbff;
}

function isLowSurrogate(code: number): boolean {
  return code >= 0xdc00 && code <= 0xdfff;
}

export interface ProgressLike {
  processed: number;
  total: number | null;
}

export interface ProgressStats {
  /** 0–1; toplam bilinmiyorsa null */
  ratio: number | null;
  /** anahtar/sn */
  rate: number;
  /** ms; hesaplanamıyorsa null */
  etaMs: number | null;
}

export function progressStats(progress: ProgressLike, elapsedMs: number): ProgressStats {
  const { processed, total } = progress;
  const rate = elapsedMs > 0 ? (processed * 1000) / elapsedMs : 0;
  const ratio = total ? Math.min(1, processed / total) : total === 0 ? 1 : null;
  const etaMs = total && rate > 0 && processed > 0 && elapsedMs >= 500 ? ((total - processed) / rate) * 1000 : null;
  return { ratio, rate, etaMs: etaMs === null ? null : Math.max(0, etaMs) };
}
