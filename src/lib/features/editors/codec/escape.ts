// Bayt ↔ düzenlenebilir metin. Geçerli UTF-8 dizileri olduğu gibi kalır; geçersiz baytlar ve denetim
// karakterleri `\xNN`, ters bölü `\\` olur. Dönüşüm kayıpsızdır: unescapeText(escapeBytes(b)) === b.

const encoder = new TextEncoder();
const decoder = new TextDecoder();
const strict = new TextDecoder("utf-8", { fatal: true });

export function isUtf8(bytes: Uint8Array): boolean {
  try {
    strict.decode(bytes);
    return true;
  } catch {
    return false;
  }
}

export function utf8(text: string): Uint8Array {
  return encoder.encode(text);
}

export function fromUtf8(bytes: Uint8Array): string {
  return decoder.decode(bytes);
}

const cont = (b: Uint8Array, i: number) => i < b.length && (b[i] & 0xc0) === 0x80;
const within = (b: Uint8Array, i: number, lo: number, hi: number) => i < b.length && b[i] >= lo && b[i] <= hi;

/** `i`'de başlayan geçerli UTF-8 dizisinin uzunluğu; geçersizse 0 */
function sequenceLength(b: Uint8Array, i: number): number {
  const c = b[i];
  if (c < 0x80) return 1;
  if (c >= 0xc2 && c <= 0xdf) return cont(b, i + 1) ? 2 : 0;
  if (c === 0xe0) return within(b, i + 1, 0xa0, 0xbf) && cont(b, i + 2) ? 3 : 0;
  if (c === 0xed) return within(b, i + 1, 0x80, 0x9f) && cont(b, i + 2) ? 3 : 0;
  if (c >= 0xe1 && c <= 0xef) return cont(b, i + 1) && cont(b, i + 2) ? 3 : 0;
  if (c === 0xf0) return within(b, i + 1, 0x90, 0xbf) && cont(b, i + 2) && cont(b, i + 3) ? 4 : 0;
  if (c >= 0xf1 && c <= 0xf3) return cont(b, i + 1) && cont(b, i + 2) && cont(b, i + 3) ? 4 : 0;
  if (c === 0xf4) return within(b, i + 1, 0x80, 0x8f) && cont(b, i + 2) && cont(b, i + 3) ? 4 : 0;
  return 0;
}

const hex2 = (n: number) => `\\x${n.toString(16).padStart(2, "0")}`;

/** Sekme, satır sonu dışındaki C0 denetimleri ve DEL de kaçışlanır (görünür olsun diye) */
const needsEscape = (c: number) => c === 0x5c || (c < 0x20 && c !== 0x09 && c !== 0x0a && c !== 0x0d) || c === 0x7f;

export function escapeBytes(bytes: Uint8Array): string {
  const parts: string[] = [];
  let runStart = 0;
  let i = 0;
  const flush = (end: number) => {
    if (end > runStart) parts.push(decoder.decode(bytes.subarray(runStart, end)));
  };
  while (i < bytes.length) {
    const c = bytes[i];
    if (c < 0x80 && !needsEscape(c)) {
      i++;
      continue;
    }
    const len = c < 0x80 ? 0 : sequenceLength(bytes, i);
    if (len > 0) {
      i += len;
      continue;
    }
    flush(i);
    parts.push(c === 0x5c ? "\\\\" : hex2(c));
    i++;
    runStart = i;
  }
  flush(i);
  return parts.join("");
}

const ESCAPE = /\\(\\|x[0-9a-fA-F]{2})/g;

export function unescapeText(text: string): Uint8Array {
  const chunks: Uint8Array[] = [];
  let last = 0;
  let total = 0;
  const push = (chunk: Uint8Array) => {
    chunks.push(chunk);
    total += chunk.length;
  };
  for (const m of text.matchAll(ESCAPE)) {
    if (m.index > last) push(encoder.encode(text.slice(last, m.index)));
    push(Uint8Array.of(m[1] === "\\" ? 0x5c : parseInt(m[1].slice(1), 16)));
    last = m.index + m[0].length;
  }
  if (last === 0) return encoder.encode(text);
  if (last < text.length) push(encoder.encode(text.slice(last)));
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.length;
  }
  return out;
}

/** Baytların çoğu yazdırılabilir ASCII mi (ikili değeri metin olarak göstermeye değer mi) */
export function mostlyText(bytes: Uint8Array): boolean {
  if (bytes.length === 0) return true;
  const sample = bytes.length > 4096 ? bytes.subarray(0, 4096) : bytes;
  let printable = 0;
  for (const c of sample) if ((c >= 0x20 && c < 0x7f) || c === 0x09 || c === 0x0a || c === 0x0d || c >= 0xa0) printable++;
  return printable / sample.length >= 0.9;
}
