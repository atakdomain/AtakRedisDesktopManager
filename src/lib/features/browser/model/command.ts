// "Komut olarak kopyala": anahtarın türüne göre okuma komutu, redis-cli tırnaklamasıyla.
import { toBytes } from "$lib/api/bytes";
import type { KeyType, RBytes } from "$lib/api/types";

const PLAIN = /^[^\s"'\\\x00-\x1f\x7f]+$/u;

function escapeChar(code: number): string {
  if (code === 0x22) return '\\"';
  if (code === 0x5c) return "\\\\";
  if (code === 0x0a) return "\\n";
  if (code === 0x0d) return "\\r";
  if (code === 0x09) return "\\t";
  return `\\x${code.toString(16).padStart(2, "0")}`;
}

/** redis-cli argümanı: gerekirse çift tırnak içinde, kontrol karakterleri ve ikili baytlar `\xNN` */
export function quoteArg(value: RBytes): string {
  if (typeof value === "string") {
    if (PLAIN.test(value)) return value;
    let out = "";
    for (const ch of value) {
      const code = ch.charCodeAt(0);
      out += code < 0x20 || code === 0x7f || code === 0x22 || code === 0x5c ? escapeChar(code) : ch;
    }
    return `"${out}"`;
  }
  let out = "";
  for (const b of toBytes(value)) out += b >= 0x20 && b < 0x7f && b !== 0x22 && b !== 0x5c ? String.fromCharCode(b) : escapeChar(b);
  return `"${out}"`;
}

const READ: Record<string, (key: string) => string> = {
  string: (k) => `GET ${k}`,
  hash: (k) => `HGETALL ${k}`,
  list: (k) => `LRANGE ${k} 0 -1`,
  set: (k) => `SMEMBERS ${k}`,
  zset: (k) => `ZRANGE ${k} 0 -1 WITHSCORES`,
  stream: (k) => `XRANGE ${k} - +`,
  "ReJSON-RL": (k) => `JSON.GET ${k}`,
};

/** Türe uygun okuma komutu; tür bilinmiyorsa `TYPE` */
export function readCommand(type: KeyType | undefined, key: RBytes): string {
  const arg = quoteArg(key);
  const build = type ? READ[type] : undefined;
  return build ? build(arg) : `TYPE ${arg}`;
}
