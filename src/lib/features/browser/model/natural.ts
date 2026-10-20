// Doğal sıralama: sayı dizileri sayısal karşılaştırılır (key:2 < key:10), harfler büyük/küçük ayrımsız,
// Türkçe harfler kendi temel harflerinin hemen ardına dizilir (c < ç < d, h < ı < i, o < ö < p …).
// Karşılaştırma başına bellek ayırmaz; 100k anahtarı sıralarken Intl.Collator'dan kat kat hızlıdır.

/** ASCII dışı karakterler için sıra ağırlığı; harita yoksa ASCII'nin ardına */
const TURKISH: Record<number, number> = {
  0xe7: 99 * 2 + 1, // ç
  0xc7: 99 * 2 + 1, // Ç
  0x11f: 103 * 2 + 1, // ğ
  0x11e: 103 * 2 + 1, // Ğ
  0x131: 104 * 2 + 1, // ı (h ile i arası)
  0x130: 105 * 2, // İ → i
  0xf6: 111 * 2 + 1, // ö
  0xd6: 111 * 2 + 1, // Ö
  0x15f: 115 * 2 + 1, // ş
  0x15e: 115 * 2 + 1, // Ş
  0xfc: 117 * 2 + 1, // ü
  0xdc: 117 * 2 + 1, // Ü
};

function weight(code: number): number {
  if (code < 128) return (code >= 65 && code <= 90 ? code + 32 : code) * 2;
  return TURKISH[code] ?? 1000 + code;
}

function isDigit(code: number): boolean {
  return code >= 48 && code <= 57;
}

/**
 * `a[aFrom..]` ile `b[bFrom..]`'yi karşılaştırır (ağaçta ortak önek atlanır).
 * Eşit ağırlıkta kalanlar için belirleyici bir son sıra: önce büyük harf, sonra baştaki sıfırlar.
 */
export function naturalCompare(a: string, b: string, aFrom = 0, bFrom = 0): number {
  const al = a.length;
  const bl = b.length;
  let i = aFrom;
  let j = bFrom;
  let tie = 0;
  while (i < al && j < bl) {
    const ca = a.charCodeAt(i);
    const cb = b.charCodeAt(j);
    if (isDigit(ca) && isDigit(cb)) {
      let sa = i;
      let sb = j;
      while (sa < al && a.charCodeAt(sa) === 48) sa++;
      while (sb < bl && b.charCodeAt(sb) === 48) sb++;
      let ea = sa;
      let eb = sb;
      while (ea < al && isDigit(a.charCodeAt(ea))) ea++;
      while (eb < bl && isDigit(b.charCodeAt(eb))) eb++;
      const lenA = ea - sa;
      const lenB = eb - sb;
      if (lenA !== lenB) return lenA - lenB;
      for (let k = 0; k < lenA; k++) {
        const d = a.charCodeAt(sa + k) - b.charCodeAt(sb + k);
        if (d !== 0) return d;
      }
      if (tie === 0) tie = ea - i - (eb - j);
      i = ea;
      j = eb;
      continue;
    }
    if (ca !== cb) {
      const d = weight(ca) - weight(cb);
      if (d !== 0) return d;
      if (tie === 0) tie = ca - cb;
    }
    i++;
    j++;
  }
  return al - i - (bl - j) || tie;
}
