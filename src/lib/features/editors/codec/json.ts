// Kayıpsız JSON: sayılar ham metinleriyle tutulur (büyük tamsayı, 1.0 ↔ 1 ayrımı), anahtar sırası korunur.
// Güzelleştirme / küçültme belirteç düzeyinde yapılır; dizgi kaçışları ve sayı yazımı değişmez.

export type JNode =
  | { t: "null" }
  | { t: "bool"; v: boolean }
  | { t: "num"; raw: string }
  | { t: "str"; v: string }
  | { t: "arr"; items: JNode[] }
  | { t: "obj"; entries: [string, JNode][] };

export type JsonErrorCode = "unexpectedEnd" | "unexpectedChar" | "badString" | "badNumber" | "trailing";

export class JsonSyntaxError extends Error {
  readonly code: JsonErrorCode;
  readonly offset: number;
  readonly line: number;
  readonly column: number;

  constructor(code: JsonErrorCode, text: string, offset: number) {
    let line = 1;
    let lineStart = 0;
    for (let i = 0; i < offset && i < text.length; i++) {
      if (text.charCodeAt(i) === 10) {
        line++;
        lineStart = i + 1;
      }
    }
    super(`${code} at ${line}:${offset - lineStart + 1}`);
    this.code = code;
    this.offset = offset;
    this.line = line;
    this.column = offset - lineStart + 1;
  }
}

const NUMBER = /-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/y;

export function isIntegerRaw(raw: string): boolean {
  return !/[.eE]/.test(raw);
}

export function parseJson(text: string): JNode {
  let pos = 0;

  const fail = (code: JsonErrorCode, at = pos): never => {
    throw new JsonSyntaxError(at >= text.length && code === "unexpectedChar" ? "unexpectedEnd" : code, text, at);
  };

  const skip = () => {
    while (pos < text.length) {
      const c = text.charCodeAt(pos);
      if (c === 32 || c === 10 || c === 13 || c === 9) pos++;
      else break;
    }
  };

  const string = (): string => {
    const start = pos;
    pos++;
    let simple = true;
    while (pos < text.length) {
      const c = text.charCodeAt(pos);
      if (c === 34) break;
      if (c < 0x20) fail("badString");
      if (c === 92) {
        simple = false;
        const next = text[pos + 1];
        if (next === "u") {
          if (!/^[0-9a-fA-F]{4}$/.test(text.slice(pos + 2, pos + 6))) fail("badString", pos);
          pos += 6;
          continue;
        }
        if (next === undefined || !'"\\/bfnrt'.includes(next)) fail("badString", pos);
        pos += 2;
        continue;
      }
      pos++;
    }
    if (pos >= text.length) fail("unexpectedEnd", start);
    pos++;
    const literal = text.slice(start, pos);
    return simple ? literal.slice(1, -1) : (JSON.parse(literal) as string);
  };

  const value = (): JNode => {
    skip();
    if (pos >= text.length) fail("unexpectedEnd");
    const c = text[pos];
    if (c === "{") {
      pos++;
      const entries: [string, JNode][] = [];
      skip();
      if (text[pos] === "}") {
        pos++;
        return { t: "obj", entries };
      }
      for (;;) {
        skip();
        if (text[pos] !== '"') fail("unexpectedChar");
        const name = string();
        skip();
        if (text[pos] !== ":") fail("unexpectedChar");
        pos++;
        entries.push([name, value()]);
        skip();
        if (text[pos] === ",") {
          pos++;
          continue;
        }
        if (text[pos] === "}") {
          pos++;
          return { t: "obj", entries };
        }
        fail("unexpectedChar");
      }
    }
    if (c === "[") {
      pos++;
      const items: JNode[] = [];
      skip();
      if (text[pos] === "]") {
        pos++;
        return { t: "arr", items };
      }
      for (;;) {
        items.push(value());
        skip();
        if (text[pos] === ",") {
          pos++;
          continue;
        }
        if (text[pos] === "]") {
          pos++;
          return { t: "arr", items };
        }
        fail("unexpectedChar");
      }
    }
    if (c === '"') return { t: "str", v: string() };
    if (text.startsWith("true", pos)) {
      pos += 4;
      return { t: "bool", v: true };
    }
    if (text.startsWith("false", pos)) {
      pos += 5;
      return { t: "bool", v: false };
    }
    if (text.startsWith("null", pos)) {
      pos += 4;
      return { t: "null" };
    }
    if (c === "-" || (c >= "0" && c <= "9")) {
      NUMBER.lastIndex = pos;
      const m = NUMBER.exec(text);
      if (!m) fail("badNumber");
      pos += m![0].length;
      if (pos < text.length && /[0-9.eE+-]/.test(text[pos])) fail("badNumber");
      return { t: "num", raw: m![0] };
    }
    return fail("unexpectedChar");
  };

  const root = value();
  skip();
  if (pos < text.length) fail("trailing");
  return root;
}

/** Geçerliyse null; değilse konumlu hata. Doğrulama hızlı yerel JSON.parse ile, konum kendi ayrıştırıcımızla. */
export function checkJson(text: string): JsonSyntaxError | null {
  try {
    JSON.parse(text);
    return null;
  } catch {
    try {
      parseJson(text);
      return new JsonSyntaxError("unexpectedChar", text, 0);
    } catch (err) {
      if (err instanceof JsonSyntaxError) return err;
      throw err;
    }
  }
}

export function writeJson(node: JNode, indent = 2): string {
  const out: string[] = [];
  const nl = (depth: number) => (indent ? "\n" + " ".repeat(indent * depth) : "");
  const sep = indent ? ": " : ":";
  const write = (n: JNode, depth: number) => {
    switch (n.t) {
      case "null":
        out.push("null");
        break;
      case "bool":
        out.push(n.v ? "true" : "false");
        break;
      case "num":
        out.push(n.raw);
        break;
      case "str":
        out.push(JSON.stringify(n.v));
        break;
      case "arr":
        if (n.items.length === 0) {
          out.push("[]");
          break;
        }
        out.push("[");
        n.items.forEach((item, i) => {
          out.push((i ? "," : "") + nl(depth + 1));
          write(item, depth + 1);
        });
        out.push(nl(depth) + "]");
        break;
      case "obj":
        if (n.entries.length === 0) {
          out.push("{}");
          break;
        }
        out.push("{");
        n.entries.forEach(([name, item], i) => {
          out.push((i ? "," : "") + nl(depth + 1) + JSON.stringify(name) + sep);
          write(item, depth + 1);
        });
        out.push(nl(depth) + "}");
        break;
    }
  };
  write(node, 0);
  return out.join("");
}

/** Geçerli JSON'u yeniden girintiler; dizgi ve sayı yazımına dokunmaz. */
export function formatJson(text: string, indent = 2): string {
  const out: string[] = [];
  let depth = 0;
  let i = 0;
  const n = text.length;
  const pad = (d: number) => "\n" + " ".repeat(indent * d);
  while (i < n) {
    const c = text[i];
    if (c === " " || c === "\n" || c === "\r" || c === "\t") {
      i++;
    } else if (c === '"') {
      const start = i++;
      while (i < n && text[i] !== '"') i += text[i] === "\\" ? 2 : 1;
      i++;
      out.push(text.slice(start, i));
    } else if (c === "{" || c === "[") {
      let j = i + 1;
      while (j < n && /\s/.test(text[j])) j++;
      if (text[j] === (c === "{" ? "}" : "]")) {
        out.push(c === "{" ? "{}" : "[]");
        i = j + 1;
      } else {
        depth++;
        out.push(c + pad(depth));
        i++;
      }
    } else if (c === "}" || c === "]") {
      depth--;
      out.push(pad(depth) + c);
      i++;
    } else if (c === ",") {
      out.push("," + pad(depth));
      i++;
    } else if (c === ":") {
      out.push(": ");
      i++;
    } else {
      const start = i;
      while (i < n && !/[\s,:{}[\]"]/.test(text[i])) i++;
      out.push(text.slice(start, i));
    }
  }
  return out.join("");
}

/** Dizgi dışındaki boşlukları atar. */
export function minifyJson(text: string): string {
  const out: string[] = [];
  let i = 0;
  let runStart = 0;
  const n = text.length;
  while (i < n) {
    const c = text.charCodeAt(i);
    if (c === 34) {
      i++;
      while (i < n && text.charCodeAt(i) !== 34) i += text.charCodeAt(i) === 92 ? 2 : 1;
      i++;
    } else if (c === 32 || c === 10 || c === 13 || c === 9) {
      if (i > runStart) out.push(text.slice(runStart, i));
      while (i < n && /[ \n\r\t]/.test(text[i])) i++;
      runStart = i;
    } else i++;
  }
  if (n > runStart) out.push(text.slice(runStart, n));
  return out.join("");
}

/** Nesne ya da dizi gibi başlıyor mu (otomatik algılama için ucuz ön eleme) */
export function looksLikeJsonContainer(text: string): boolean {
  const m = /^\s*([{[])/.exec(text.slice(0, 64));
  if (!m) return false;
  const end = text.trimEnd().at(-1);
  return (m[1] === "{" && end === "}") || (m[1] === "[" && end === "]");
}
