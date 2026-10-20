import { fromBytes, isBinary, label } from "$lib/api/bytes";
import type { RBytes } from "$lib/api/types";
import { unescapeText } from "./codec/escape";

/**
 * Düzenlenen ad metnini baytlara çevirir. Özgün ad ikiliyse metin `label()` biçimindedir (\xNN kaçışlı)
 * ve kaçışlar çözülür; düz metin adlar olduğu gibi kalır (ters bölü dahil).
 */
export function parseName(text: string, original: RBytes | null): RBytes {
  return original !== null && isBinary(original) ? fromBytes(unescapeText(text)) : text;
}

export function nameText(value: RBytes): string {
  return label(value);
}
