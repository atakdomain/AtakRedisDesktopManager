// PHP serialize() ↔ JSON (JNode). Dizgi uzunlukları bayt cinsindendir; ayrıştırma bayt düzeyinde yapılır.
// JSON'da karşılığı olmayan yapılar "@" önekli tek anahtarlı nesnelerle taşınır:
//   O:3:"Foo":…   → {"@class": "Foo", …özellikler}
//   C:3:"Foo":…   → {"@class": "Foo", "@data": "…"}
//   E:7:"Foo:Bar" → {"@enum": "Foo:Bar"}      r:2; / R:2; → {"@ref": 2} / {"@Ref": 2}
//   d:INF;        → {"@float": "INF"}          UTF-8 olmayan dizgi → {"@bin": base64}
import { decodeBase64, encodeBase64 } from "./base64";
import { isUtf8, utf8 } from "./escape";
import { isIntegerRaw, type JNode } from "./json";

export class PhpError extends Error {
  readonly offset: number;

  constructor(message: string, offset: number) {
    super(`${message} at byte ${offset}`);
    this.offset = offset;
  }
}

const decoder = new TextDecoder();
const CH = (s: string) => s.charCodeAt(0);

const INT_KEY = /^(?:0|-?[1-9]\d*)$/;
const INT64_MAX = 9223372036854775807n;
const INT64_MIN = -9223372036854775808n;

/** PHP dizi anahtarı tamsayıya çevrilir mi (PHP'nin kendi kuralı) */
function isIntKey(key: string): boolean {
  if (!INT_KEY.test(key)) return false;
  const n = BigInt(key);
  return n >= INT64_MIN && n <= INT64_MAX;
}

function floatNode(raw: string): JNode {
  const upper = raw.toUpperCase();
  if (upper === "INF" || upper === "-INF" || upper === "NAN") return { t: "obj", entries: [["@float", { t: "str", v: upper }]] };
  const value = Number(raw);
  if (!Number.isFinite(value)) throw new Error("bad float");
  // JSON'da kayan nokta olduğu belli olsun: 1 → 1.0
  if (/^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?$/.test(raw)) return { t: "num", raw: isIntegerRaw(raw) ? `${raw}.0` : raw };
  const text = String(value);
  return { t: "num", raw: isIntegerRaw(text) ? `${text}.0` : text };
}

function bytesNode(bytes: Uint8Array): JNode {
  return isUtf8(bytes) ? { t: "str", v: decoder.decode(bytes) } : { t: "obj", entries: [["@bin", { t: "str", v: encodeBase64(bytes) }]] };
}

export function phpToJson(bytes: Uint8Array): JNode {
  let pos = 0;

  const fail = (message: string): never => {
    throw new PhpError(message, pos);
  };

  const expect = (ch: string) => {
    if (bytes[pos] !== CH(ch)) fail(`expected '${ch}'`);
    pos++;
  };

  /** `term` karakterine dek ASCII metin */
  const until = (term: string): string => {
    const stop = CH(term);
    const start = pos;
    while (pos < bytes.length && bytes[pos] !== stop) pos++;
    if (pos >= bytes.length) fail(`expected '${term}'`);
    const text = decoder.decode(bytes.subarray(start, pos));
    pos++;
    return text;
  };

  const integer = (term: string): string => {
    const text = until(term);
    if (!/^[+-]?\d+$/.test(text)) fail("bad integer");
    return text.replace(/^\+/, "");
  };

  const count = (term: string): number => {
    const n = Number(integer(term));
    if (n < 0) fail("bad length");
    return n;
  };

  /** `len:"…"` — uzunluk bayt cinsinden */
  const sized = (): Uint8Array => {
    const len = count(":");
    expect('"');
    if (pos + len > bytes.length) fail("string past end");
    const out = bytes.subarray(pos, pos + len);
    pos += len;
    expect('"');
    return out;
  };

  const members = (n: number, into: [string, JNode][], keys: JNode[]) => {
    expect("{");
    for (let i = 0; i < n; i++) {
      const key = value();
      if (key.t !== "num" && key.t !== "str") fail("bad array key");
      keys.push(key);
      into.push([key.t === "num" ? key.raw : (key as { v: string }).v, value()]);
    }
    expect("}");
  };

  const value = (): JNode => {
    if (pos >= bytes.length) fail("unexpected end");
    const tag = String.fromCharCode(bytes[pos]);
    pos++;
    switch (tag) {
      case "N":
        expect(";");
        return { t: "null" };
      case "b": {
        expect(":");
        const v = integer(";");
        if (v !== "0" && v !== "1") fail("bad boolean");
        return { t: "bool", v: v === "1" };
      }
      case "i":
        expect(":");
        return { t: "num", raw: integer(";") };
      case "d": {
        expect(":");
        const raw = until(";");
        try {
          return floatNode(raw);
        } catch {
          return fail("bad float");
        }
      }
      case "s": {
        expect(":");
        const out = sized();
        expect(";");
        return bytesNode(out);
      }
      case "a": {
        expect(":");
        const n = count(":");
        const entries: [string, JNode][] = [];
        const keys: JNode[] = [];
        members(n, entries, keys);
        const isList = keys.every((k, i) => k.t === "num" && k.raw === String(i));
        return isList ? { t: "arr", items: entries.map((e) => e[1]) } : { t: "obj", entries };
      }
      case "O": {
        expect(":");
        const className = decoder.decode(sized());
        expect(":");
        const n = count(":");
        const entries: [string, JNode][] = [["@class", { t: "str", v: className }]];
        members(n, entries, []);
        return { t: "obj", entries };
      }
      case "C": {
        expect(":");
        const className = decoder.decode(sized());
        expect(":");
        const len = count(":");
        expect("{");
        if (pos + len > bytes.length) fail("data past end");
        const data = bytes.subarray(pos, pos + len);
        pos += len;
        expect("}");
        return { t: "obj", entries: [["@class", { t: "str", v: className }], ["@data", bytesNode(data)]] };
      }
      case "E": {
        expect(":");
        const name = decoder.decode(sized());
        expect(";");
        return { t: "obj", entries: [["@enum", { t: "str", v: name }]] };
      }
      case "r":
      case "R":
        expect(":");
        return { t: "obj", entries: [[tag === "r" ? "@ref" : "@Ref", { t: "num", raw: integer(";") }]] };
      default:
        pos--;
        return fail("unknown type");
    }
  };

  const root = value();
  if (pos !== bytes.length) fail("trailing data");
  return root;
}

/** Önden hızlı bakış + tam ayrıştırma: yalnızca bileşik ya da dizgi değerler otomatik algılanır */
export function looksLikePhp(bytes: Uint8Array): boolean {
  const head = decoder.decode(bytes.subarray(0, 16));
  if (!/^(?:a:\d+:\{|O:\d+:"|C:\d+:"|s:\d+:"|E:\d+:")/.test(head)) return false;
  try {
    phpToJson(bytes);
    return true;
  } catch {
    return false;
  }
}

class Writer {
  private chunks: Uint8Array[] = [];
  private size = 0;

  text(s: string): this {
    return this.raw(utf8(s));
  }

  raw(bytes: Uint8Array): this {
    this.chunks.push(bytes);
    this.size += bytes.length;
    return this;
  }

  /** `s:len:"…";` */
  str(bytes: Uint8Array): this {
    return this.text(`s:${bytes.length}:"`).raw(bytes).text('";');
  }

  done(): Uint8Array {
    const out = new Uint8Array(this.size);
    let offset = 0;
    for (const chunk of this.chunks) {
      out.set(chunk, offset);
      offset += chunk.length;
    }
    return out;
  }
}

function single(node: JNode, name: string): JNode | undefined {
  return node.t === "obj" && node.entries.length === 1 && node.entries[0][0] === name ? node.entries[0][1] : undefined;
}

function binOf(node: JNode): Uint8Array {
  if (node.t !== "str") throw new PhpError("@bin needs a base64 string", 0);
  const decoded = decodeBase64(node.v);
  if (!decoded) throw new PhpError("@bin is not valid base64", 0);
  return decoded.bytes;
}

export function jsonToPhp(node: JNode): Uint8Array {
  const w = new Writer();

  const key = (name: string) => {
    if (isIntKey(name)) w.text(`i:${name};`);
    else w.str(utf8(name));
  };

  const write = (n: JNode) => {
    switch (n.t) {
      case "null":
        w.text("N;");
        return;
      case "bool":
        w.text(`b:${n.v ? 1 : 0};`);
        return;
      case "num":
        w.text(isIntegerRaw(n.raw) ? `i:${n.raw};` : `d:${n.raw};`);
        return;
      case "str":
        w.str(utf8(n.v));
        return;
      case "arr":
        w.text(`a:${n.items.length}:{`);
        n.items.forEach((item, i) => {
          w.text(`i:${i};`);
          write(item);
        });
        w.text("}");
        return;
      case "obj": {
        const bin = single(n, "@bin");
        if (bin) return void w.str(binOf(bin));
        const float = single(n, "@float");
        if (float?.t === "str") return void w.text(`d:${float.v};`);
        const enumName = single(n, "@enum");
        if (enumName?.t === "str") {
          const bytes = utf8(enumName.v);
          return void w.text(`E:${bytes.length}:"`).raw(bytes).text('";');
        }
        for (const ref of ["@ref", "@Ref"] as const) {
          const target = single(n, ref);
          if (target?.t === "num") return void w.text(`${ref === "@ref" ? "r" : "R"}:${target.raw};`);
        }
        const [first, second] = n.entries;
        if (first?.[0] === "@class" && first[1].t === "str") {
          const className = utf8(first[1].v);
          if (n.entries.length === 2 && second[0] === "@data") {
            const data = second[1].t === "str" ? utf8(second[1].v) : binOf(single(second[1], "@bin") ?? second[1]);
            w.text(`C:${className.length}:"`).raw(className).text(`":${data.length}:{`).raw(data).text("}");
            return;
          }
          const props = n.entries.slice(1);
          w.text(`O:${className.length}:"`).raw(className).text(`":${props.length}:{`);
          for (const [name, item] of props) {
            key(name);
            write(item);
          }
          w.text("}");
          return;
        }
        w.text(`a:${n.entries.length}:{`);
        for (const [name, item] of n.entries) {
          key(name);
          write(item);
        }
        w.text("}");
        return;
      }
    }
  };

  write(node);
  return w.done();
}
