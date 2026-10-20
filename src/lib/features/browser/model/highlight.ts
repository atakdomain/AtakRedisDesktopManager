// Satır adını parçalara böler: arama eşleşmesi (vurgu) ve ikili anahtarlardaki `\xNN` kaçışları (soluk).

export interface Segment {
  text: string;
  hl: boolean;
  esc: boolean;
}

const ESCAPE = /\\x[0-9a-f]{2}/g;

/**
 * `text[from..]`'yi böler. `ranges` tam metin üzerindeki [başlangıç, bitiş) eşleşmeleridir;
 * görünen kısma kırpılır (ağaçta yalnızca son parça gösterilir).
 */
export function segments(text: string, ranges: readonly (readonly [number, number])[], from = 0, binary = false): Segment[] {
  const length = text.length - from;
  if (length <= 0) return [];
  if (ranges.length === 0 && !binary) return [{ text: from ? text.slice(from) : text, hl: false, esc: false }];
  const flags = new Uint8Array(length);
  for (const [start, end] of ranges) {
    for (let i = Math.max(start, from); i < Math.min(end, text.length); i++) flags[i - from] |= 1;
  }
  if (binary) {
    ESCAPE.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = ESCAPE.exec(text)) !== null) {
      for (let i = Math.max(m.index, from); i < m.index + 4; i++) flags[i - from] |= 2;
    }
  }
  const out: Segment[] = [];
  let start = 0;
  for (let i = 1; i <= length; i++) {
    if (i === length || flags[i] !== flags[start]) {
      out.push({ text: text.slice(from + start, from + i), hl: (flags[start] & 1) !== 0, esc: (flags[start] & 2) !== 0 });
      start = i;
    }
  }
  return out;
}
