// Anahtar adı yardımcıları: düzenlenen görünen addan baytlara dönüş, ortak klasör öneki.
import { fromBytes } from "$lib/api/bytes";
import type { RBytes } from "$lib/api/types";

const encoder = new TextEncoder();

/**
 * Görünen ad → anahtar. Özgün anahtar ikiliyse `\xNN` kaçışları bayta çevrilir (redis-cli gibi);
 * metin anahtarlarda ters eğik çizgi olduğu gibi kalır.
 */
export function parseLabel(text: string, binary: boolean): RBytes {
  if (!binary) return text;
  const bytes: number[] = [];
  for (let i = 0; i < text.length; ) {
    if (text[i] === "\\" && text[i + 1] === "x" && /^[0-9a-fA-F]{2}$/.test(text.slice(i + 2, i + 4))) {
      bytes.push(parseInt(text.slice(i + 2, i + 4), 16));
      i += 4;
      continue;
    }
    const ch = String.fromCodePoint(text.codePointAt(i)!);
    for (const b of encoder.encode(ch)) bytes.push(b);
    i += ch.length;
  }
  return fromBytes(new Uint8Array(bytes));
}

/** Adların hepsinin paylaştığı en uzun klasör yolu (ayırıcı hariç); yoksa boş */
export function commonFolder(labels: readonly string[], separator: string): string {
  if (labels.length === 0 || !separator) return "";
  let prefix = labels[0];
  for (const text of labels) {
    let i = 0;
    const max = Math.min(prefix.length, text.length);
    while (i < max && prefix.charCodeAt(i) === text.charCodeAt(i)) i++;
    prefix = prefix.slice(0, i);
    if (!prefix) return "";
  }
  // Tek anahtarda adın kendisi de "ortak"; klasör, son ayırıcıya kadar olan kısımdır
  const cut = prefix.lastIndexOf(separator);
  return cut > 0 ? prefix.slice(0, cut) : "";
}
