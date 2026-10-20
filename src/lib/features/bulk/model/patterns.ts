// Klasör → sunucu süzgeci ve önek değiştirme deseni. Klasör işlemleri yüklenmemiş anahtarları da kapsar,
// bu yüzden desen birebir olmalı: glob kaçışlı, büyük/küçük harf duyarlı.
import type { KeyFilter } from "$lib/api/types";

/** Redis glob özel karakterleri: `* ? [ ] \` */
export function escapeGlob(text: string): string {
  return text.replace(/[\\*?[\]]/g, "\\$&");
}

export function escapeRegex(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Değiştirme şablonunda düz metin: `$` → `$$` */
export function escapeReplacement(text: string): string {
  return text.replace(/\$/g, "$$$$");
}

/** `path` klasörünün altındaki tüm anahtarlar: `path + ayırıcı` ile başlayanlar */
export function folderFilter(path: string, separator: string): KeyFilter {
  return { mode: "glob", term: `${escapeGlob(path + separator)}*`, caseSensitive: true, types: [] };
}

/** Önek değiştirme: `^eski` → `yeni`, düz metin olarak (regex/şablon karakterleri kaçışlı) */
export function prefixRename(oldPrefix: string, newPrefix: string): { find: string; replace: string; regex: true; caseSensitive: true } {
  return { find: `^${escapeRegex(oldPrefix)}`, replace: escapeReplacement(newPrefix), regex: true, caseSensitive: true };
}

/** Tarayıcı JS'si ile Rust regex'i arasındaki ortak alt küme için kaba doğrulama; hata metni ya da null */
export function regexError(source: string): string | null {
  if (!source) return null;
  try {
    // Rust'ın adlandırılmış grubu (?P<ad>…) JS'de (?<ad>…)
    new RegExp(source.replace(/\(\?P</g, "(?<"), "u");
    return null;
  } catch (err) {
    return err instanceof Error ? err.message.replace(/^Invalid regular expression: (\/.*\/[a-z]*: )?/s, "") : String(err);
  }
}
