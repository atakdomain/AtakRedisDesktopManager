// redis-cli sözdizimi (sdssplitargs) — arayüz tarafı: komut adı, ipucu, tehlike denetimi ve tırnaklama için.
// Kesin ayrıştırma arka uçtadır (src-tauri/src/console); kurallar aynıdır.

export interface Tokens {
  tokens: string[];
  /** Tırnak kapanmadı ya da kapanış tırnağından sonra boşluk yok */
  error: boolean;
  /** Satır boşlukla bitiyor (son argüman tamamlandı) */
  trailingSpace: boolean;
}

const SPACE = /[ \n\r\t\0]/;

function hexValue(ch: string): number {
  return parseInt(ch, 16);
}

function isHex(ch: string | undefined): boolean {
  return ch !== undefined && /^[0-9a-fA-F]$/.test(ch);
}

export function tokenize(line: string): Tokens {
  const tokens: string[] = [];
  let i = 0;
  const n = line.length;
  while (true) {
    while (i < n && SPACE.test(line[i])) i++;
    if (i >= n) return { tokens, error: false, trailingSpace: n > 0 && SPACE.test(line[n - 1]) };
    let current = "";
    let inDouble = false;
    let inSingle = false;
    let done = false;
    while (!done) {
      if (inDouble) {
        if (i >= n) return { tokens: [...tokens, current], error: true, trailingSpace: false };
        const ch = line[i];
        if (ch === "\\" && line[i + 1] === "x" && isHex(line[i + 2]) && isHex(line[i + 3])) {
          current += String.fromCharCode(hexValue(line[i + 2]) * 16 + hexValue(line[i + 3]));
          i += 3;
        } else if (ch === "\\" && i + 1 < n) {
          i++;
          const esc = line[i];
          current += esc === "n" ? "\n" : esc === "r" ? "\r" : esc === "t" ? "\t" : esc === "b" ? "\b" : esc === "a" ? "\x07" : esc;
        } else if (ch === '"') {
          if (i + 1 < n && !SPACE.test(line[i + 1])) return { tokens: [...tokens, current], error: true, trailingSpace: false };
          done = true;
        } else {
          current += ch;
        }
      } else if (inSingle) {
        if (i >= n) return { tokens: [...tokens, current], error: true, trailingSpace: false };
        const ch = line[i];
        if (ch === "\\" && line[i + 1] === "'") {
          i++;
          current += "'";
        } else if (ch === "'") {
          if (i + 1 < n && !SPACE.test(line[i + 1])) return { tokens: [...tokens, current], error: true, trailingSpace: false };
          done = true;
        } else {
          current += ch;
        }
      } else {
        if (i >= n) {
          done = true;
          break;
        }
        const ch = line[i];
        if (SPACE.test(ch)) done = true;
        else if (ch === '"') inDouble = true;
        else if (ch === "'") inSingle = true;
        else current += ch;
      }
      if (i < n) i++;
    }
    tokens.push(current);
  }
}

const NEEDS_QUOTES = /[\s"'\\\x00-\x1f\x7f]/;

/** redis-cli'nin geri okuyabileceği biçimde yazar; gerekmiyorsa tırnaksız bırakır. */
export function quoteArg(value: string): string {
  if (value.length > 0 && !NEEDS_QUOTES.test(value)) return value;
  const body = value.replace(/[\\"\x00-\x1f\x7f]/g, (ch) => {
    switch (ch) {
      case "\\":
        return "\\\\";
      case '"':
        return '\\"';
      case "\n":
        return "\\n";
      case "\r":
        return "\\r";
      case "\t":
        return "\\t";
      default:
        return `\\x${ch.charCodeAt(0).toString(16).padStart(2, "0")}`;
    }
  });
  return `"${body}"`;
}

/** Çok satırlı yapıştırma: boş satırlar atılır, her satır ayrı komut. */
export function splitLines(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}
