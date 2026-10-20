// Mesaj içeriği görüntüleme: JSON biçimlendirme/renklendirme ve hex dökümü.

export type JsonTok = { k: "key" | "str" | "num" | "lit" | "punct"; s: string };

/** Ayrıştırılabiliyorsa 2 boşluklu JSON, değilse null. Yalnızca nesne/dizi kabul edilir. */
export function prettyJson(text: string): string | null {
  const trimmed = text.trim();
  if (!(trimmed.startsWith("{") || trimmed.startsWith("["))) return null;
  try {
    return JSON.stringify(JSON.parse(trimmed), null, 2);
  } catch {
    return null;
  }
}

const JSON_TOKEN = /("(?:\\.|[^"\\])*")(\s*:)?|\b(true|false|null)\b|(-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)/g;

/** Biçimlendirilmiş JSON'u renk parçalarına böler (birleşimi girdiyle aynıdır). */
export function jsonTokens(pretty: string): JsonTok[] {
  const out: JsonTok[] = [];
  let last = 0;
  for (const m of pretty.matchAll(JSON_TOKEN)) {
    const index = m.index ?? 0;
    if (index > last) out.push({ k: "punct", s: pretty.slice(last, index) });
    if (m[1] !== undefined) {
      out.push({ k: m[2] ? "key" : "str", s: m[1] });
      if (m[2]) out.push({ k: "punct", s: m[2] });
    } else if (m[3] !== undefined) out.push({ k: "lit", s: m[3] });
    else out.push({ k: "num", s: m[4] });
    last = index + m[0].length;
  }
  if (last < pretty.length) out.push({ k: "punct", s: pretty.slice(last) });
  return out;
}

/** `00000000  48 65 6c 6c 6f …  |Hello…|` biçiminde döküm; `max` bayttan sonrası kesilir. */
export function hexDump(bytes: Uint8Array, max = 64 * 1024): string {
  const n = Math.min(bytes.length, max);
  const lines: string[] = [];
  for (let off = 0; off < n; off += 16) {
    let hex = "";
    let ascii = "";
    for (let i = 0; i < 16; i++) {
      if (off + i < n) {
        const b = bytes[off + i];
        hex += b.toString(16).padStart(2, "0") + " ";
        ascii += b >= 0x20 && b < 0x7f ? String.fromCharCode(b) : ".";
      } else hex += "   ";
      if (i === 7) hex += " ";
    }
    lines.push(`${off.toString(16).padStart(8, "0")}  ${hex} |${ascii}|`);
  }
  return lines.join("\n");
}
