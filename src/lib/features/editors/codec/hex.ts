// Onaltılık gösterim: düzenleyicide satır başına 16 bayt ("89 50 4e 47 …"), kopyalamak için klasik hexdump.

export const BYTES_PER_LINE = 16;

const HEX = Array.from({ length: 256 }, (_, i) => i.toString(16).padStart(2, "0"));

export class HexError extends Error {
  /** "char": geçersiz karakter · "odd": tek sayıda hane */
  readonly code: "char" | "odd";
  /** Metin içindeki konum (char) */
  readonly offset: number;

  constructor(code: "char" | "odd", offset: number) {
    super(code === "char" ? `invalid hex character at ${offset}` : "odd number of hex digits");
    this.code = code;
    this.offset = offset;
  }
}

export function toHexLines(bytes: Uint8Array, perLine = BYTES_PER_LINE): string {
  const lines: string[] = [];
  for (let i = 0; i < bytes.length; i += perLine) {
    const end = Math.min(bytes.length, i + perLine);
    const parts = new Array<string>(end - i);
    for (let j = i; j < end; j++) parts[j - i] = HEX[bytes[j]];
    lines.push(parts.join(" "));
  }
  return lines.join("\n");
}

/** Boşluklar serbest; yalnızca 0-9a-f haneleri kabul edilir. */
export function parseHex(text: string): Uint8Array {
  const out = new Uint8Array(text.length >> 1);
  let count = 0;
  let high = -1;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    let v: number;
    if (c >= 48 && c <= 57) v = c - 48;
    else if (c >= 97 && c <= 102) v = c - 87;
    else if (c >= 65 && c <= 70) v = c - 55;
    else if (c === 32 || c === 10 || c === 13 || c === 9) continue;
    else throw new HexError("char", i);
    if (high < 0) high = v;
    else {
      out[count++] = (high << 4) | v;
      high = -1;
    }
  }
  if (high >= 0) throw new HexError("odd", text.length);
  return out.subarray(0, count);
}

export function asciiOf(bytes: ArrayLike<number>): string {
  let out = "";
  for (let i = 0; i < bytes.length; i++) {
    const c = bytes[i];
    out += c >= 0x20 && c < 0x7f ? String.fromCharCode(c) : ".";
  }
  return out;
}

/** Düzenleyicideki bir hex satırının ASCII karşılığı (geçersiz haneler atlanır) */
export function asciiOfHexLine(line: string): string {
  const bytes: number[] = [];
  for (const m of line.matchAll(/[0-9a-fA-F]{2}/g)) bytes.push(parseInt(m[0], 16));
  return asciiOf(bytes);
}

/** `00000000  89 50 4e 47 0d 0a 1a 0a  00 00 00 0d 49 48 44 52  |.PNG........IHDR|` */
export function hexdump(bytes: Uint8Array): string {
  const lines: string[] = [];
  for (let i = 0; i < bytes.length; i += BYTES_PER_LINE) {
    const row = bytes.subarray(i, i + BYTES_PER_LINE);
    let hex = "";
    for (let j = 0; j < BYTES_PER_LINE; j++) {
      hex += j < row.length ? HEX[row[j]] : "  ";
      hex += j === 7 ? "  " : " ";
    }
    lines.push(`${i.toString(16).padStart(8, "0")}  ${hex} |${asciiOf(row)}|`);
  }
  return lines.join("\n");
}
