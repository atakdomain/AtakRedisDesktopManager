// MessagePack ↔ JSON (JNode). Tamsayı / kayan nokta ayrımı ve 64 bit tamsayılar korunur.
// JSON'da karşılığı olmayanlar: bin → {"@bin": base64}, ext → {"@ext": tür, "@data": base64},
// dizgi olmayan anahtarlı map → {"@map": [[anahtar, değer], …]}, NaN/Infinity → {"@float": "NaN"}.
import { decodeBase64, encodeBase64 } from "./base64";
import { utf8 } from "./escape";
import { isIntegerRaw, type JNode } from "./json";

export class MsgpackError extends Error {
  readonly offset: number;

  constructor(message: string, offset: number) {
    super(`${message} at byte ${offset}`);
    this.offset = offset;
  }
}

const decoder = new TextDecoder("utf-8", { fatal: true });

function floatRaw(value: number): JNode {
  if (!Number.isFinite(value)) return { t: "obj", entries: [["@float", { t: "str", v: Number.isNaN(value) ? "NaN" : value > 0 ? "Infinity" : "-Infinity" }]] };
  const text = String(value);
  return { t: "num", raw: isIntegerRaw(text) ? `${text}.0` : text };
}

export function msgpackToJson(bytes: Uint8Array): JNode {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let pos = 0;

  const need = (n: number) => {
    if (pos + n > bytes.length) throw new MsgpackError("unexpected end", pos);
  };
  const u8 = () => (need(1), bytes[pos++]);
  const u16 = () => (need(2), (pos += 2), view.getUint16(pos - 2));
  const u32 = () => (need(4), (pos += 4), view.getUint32(pos - 4));
  const take = (n: number) => {
    need(n);
    pos += n;
    return bytes.subarray(pos - n, pos);
  };

  const str = (n: number): JNode => {
    const raw = take(n);
    try {
      return { t: "str", v: decoder.decode(raw) };
    } catch {
      return { t: "obj", entries: [["@bin", { t: "str", v: encodeBase64(raw) }]] };
    }
  };
  const bin = (n: number): JNode => ({ t: "obj", entries: [["@bin", { t: "str", v: encodeBase64(take(n)) }]] });
  const ext = (n: number): JNode => {
    need(1);
    const type = view.getInt8(pos++);
    return { t: "obj", entries: [["@ext", { t: "num", raw: String(type) }], ["@data", { t: "str", v: encodeBase64(take(n)) }]] };
  };
  const array = (n: number): JNode => {
    const items: JNode[] = [];
    for (let i = 0; i < n; i++) items.push(value());
    return { t: "arr", items };
  };
  const map = (n: number): JNode => {
    const pairs: [JNode, JNode][] = [];
    for (let i = 0; i < n; i++) pairs.push([value(), value()]);
    if (pairs.every(([k]) => k.t === "str")) return { t: "obj", entries: pairs.map(([k, v]): [string, JNode] => [(k as { v: string }).v, v]) };
    return { t: "obj", entries: [["@map", { t: "arr", items: pairs.map(([k, v]) => ({ t: "arr", items: [k, v] }) as JNode) }]] };
  };
  const int = (v: number | bigint): JNode => ({ t: "num", raw: String(v) });

  const value = (): JNode => {
    const start = pos;
    const c = u8();
    if (c <= 0x7f) return int(c);
    if (c >= 0xe0) return int(c - 0x100);
    if (c <= 0x8f) return map(c & 0x0f);
    if (c <= 0x9f) return array(c & 0x0f);
    if (c <= 0xbf) return str(c & 0x1f);
    switch (c) {
      case 0xc0:
        return { t: "null" };
      case 0xc2:
        return { t: "bool", v: false };
      case 0xc3:
        return { t: "bool", v: true };
      case 0xc4:
        return bin(u8());
      case 0xc5:
        return bin(u16());
      case 0xc6:
        return bin(u32());
      case 0xc7:
        return ext(u8());
      case 0xc8:
        return ext(u16());
      case 0xc9:
        return ext(u32());
      case 0xca:
        need(4);
        pos += 4;
        return floatRaw(view.getFloat32(pos - 4));
      case 0xcb:
        need(8);
        pos += 8;
        return floatRaw(view.getFloat64(pos - 8));
      case 0xcc:
        return int(u8());
      case 0xcd:
        return int(u16());
      case 0xce:
        return int(u32());
      case 0xcf:
        need(8);
        pos += 8;
        return int(view.getBigUint64(pos - 8));
      case 0xd0:
        need(1);
        return int(view.getInt8(pos++));
      case 0xd1:
        need(2);
        pos += 2;
        return int(view.getInt16(pos - 2));
      case 0xd2:
        need(4);
        pos += 4;
        return int(view.getInt32(pos - 4));
      case 0xd3:
        need(8);
        pos += 8;
        return int(view.getBigInt64(pos - 8));
      case 0xd4:
        return ext(1);
      case 0xd5:
        return ext(2);
      case 0xd6:
        return ext(4);
      case 0xd7:
        return ext(8);
      case 0xd8:
        return ext(16);
      case 0xd9:
        return str(u8());
      case 0xda:
        return str(u16());
      case 0xdb:
        return str(u32());
      case 0xdc:
        return array(u16());
      case 0xdd:
        return array(u32());
      case 0xde:
        return map(u16());
      case 0xdf:
        return map(u32());
      default:
        throw new MsgpackError("invalid type byte", start);
    }
  };

  const root = value();
  if (pos !== bytes.length) throw new MsgpackError("trailing data", pos);
  return root;
}

/** Map ya da dizi ile başlıyor ve baştan sona eksiksiz çözülüyor mu */
export function looksLikeMsgpack(bytes: Uint8Array): boolean {
  if (bytes.length < 2) return false;
  const c = bytes[0];
  if (!((c >= 0x80 && c <= 0x9f) || (c >= 0xdc && c <= 0xdf))) return false;
  try {
    msgpackToJson(bytes);
    return true;
  } catch {
    return false;
  }
}

class Writer {
  private buf = new Uint8Array(256);
  private view = new DataView(this.buf.buffer);
  private pos = 0;

  private ensure(n: number) {
    if (this.pos + n <= this.buf.length) return;
    let size = this.buf.length * 2;
    while (size < this.pos + n) size *= 2;
    const next = new Uint8Array(size);
    next.set(this.buf.subarray(0, this.pos));
    this.buf = next;
    this.view = new DataView(next.buffer);
  }

  u8(...values: number[]) {
    this.ensure(values.length);
    for (const v of values) this.buf[this.pos++] = v;
  }

  u16(v: number) {
    this.ensure(2);
    this.view.setUint16(this.pos, v);
    this.pos += 2;
  }

  u32(v: number) {
    this.ensure(4);
    this.view.setUint32(this.pos, v);
    this.pos += 4;
  }

  big(v: bigint, signed: boolean) {
    this.ensure(8);
    if (signed) this.view.setBigInt64(this.pos, v);
    else this.view.setBigUint64(this.pos, v);
    this.pos += 8;
  }

  f64(v: number) {
    this.ensure(8);
    this.view.setFloat64(this.pos, v);
    this.pos += 8;
  }

  bytes(b: Uint8Array) {
    this.ensure(b.length);
    this.buf.set(b, this.pos);
    this.pos += b.length;
  }

  done(): Uint8Array {
    return this.buf.slice(0, this.pos);
  }
}

const FIXEXT = new Map([
  [1, 0xd4],
  [2, 0xd5],
  [4, 0xd6],
  [8, 0xd7],
  [16, 0xd8],
]);

function single(node: JNode, name: string): JNode | undefined {
  return node.t === "obj" && node.entries.length === 1 && node.entries[0][0] === name ? node.entries[0][1] : undefined;
}

function base64Of(node: JNode, what: string): Uint8Array {
  const decoded = node.t === "str" ? decodeBase64(node.v) : null;
  if (!decoded) throw new MsgpackError(`${what} must be a base64 string`, 0);
  return decoded.bytes;
}

export function jsonToMsgpack(node: JNode): Uint8Array {
  const w = new Writer();

  const integer = (raw: string) => {
    const n = BigInt(raw);
    if (n >= 0n) {
      if (n <= 0x7fn) w.u8(Number(n));
      else if (n <= 0xffn) w.u8(0xcc, Number(n));
      else if (n <= 0xffffn) (w.u8(0xcd), w.u16(Number(n)));
      else if (n <= 0xffffffffn) (w.u8(0xce), w.u32(Number(n)));
      else if (n <= 0xffffffffffffffffn) (w.u8(0xcf), w.big(n, false));
      else throw new MsgpackError(`integer out of range: ${raw}`, 0);
    } else {
      if (n >= -32n) w.u8(Number(n) + 0x100);
      else if (n >= -0x80n) w.u8(0xd0, Number(n) & 0xff);
      else if (n >= -0x8000n) (w.u8(0xd1), w.u16(Number(n) & 0xffff));
      else if (n >= -0x80000000n) (w.u8(0xd2), w.u32(Number(n) >>> 0));
      else if (n >= -0x8000000000000000n) (w.u8(0xd3), w.big(n, true));
      else throw new MsgpackError(`integer out of range: ${raw}`, 0);
    }
  };

  const header = (n: number, fix: number, fixMax: number, small: number | null, b16: number, b32: number) => {
    if (n <= fixMax) w.u8(fix | n);
    else if (small !== null && n <= 0xff) w.u8(small, n);
    else if (n <= 0xffff) (w.u8(b16), w.u16(n));
    else (w.u8(b32), w.u32(n));
  };

  const string = (s: string) => {
    const b = utf8(s);
    header(b.length, 0xa0, 31, 0xd9, 0xda, 0xdb);
    w.bytes(b);
  };

  const write = (n: JNode) => {
    switch (n.t) {
      case "null":
        return w.u8(0xc0);
      case "bool":
        return w.u8(n.v ? 0xc3 : 0xc2);
      case "num":
        if (isIntegerRaw(n.raw)) return integer(n.raw);
        w.u8(0xcb);
        return w.f64(Number(n.raw));
      case "str":
        return string(n.v);
      case "arr":
        header(n.items.length, 0x90, 15, null, 0xdc, 0xdd);
        return n.items.forEach(write);
      case "obj": {
        const bin = single(n, "@bin");
        if (bin) {
          const b = base64Of(bin, "@bin");
          if (b.length <= 0xff) w.u8(0xc4, b.length);
          else if (b.length <= 0xffff) (w.u8(0xc5), w.u16(b.length));
          else (w.u8(0xc6), w.u32(b.length));
          return w.bytes(b);
        }
        const float = single(n, "@float");
        if (float?.t === "str") {
          w.u8(0xcb);
          return w.f64(Number(float.v));
        }
        const pairs = single(n, "@map");
        if (pairs?.t === "arr") {
          header(pairs.items.length, 0x80, 15, null, 0xde, 0xdf);
          for (const pair of pairs.items) {
            if (pair.t !== "arr" || pair.items.length !== 2) throw new MsgpackError("@map entries must be [key, value]", 0);
            write(pair.items[0]);
            write(pair.items[1]);
          }
          return;
        }
        const [first, second] = n.entries;
        if (n.entries.length === 2 && first[0] === "@ext" && first[1].t === "num" && second[0] === "@data") {
          const type = Number(first[1].raw);
          const data = base64Of(second[1], "@data");
          const fixed = FIXEXT.get(data.length);
          if (fixed) w.u8(fixed);
          else if (data.length <= 0xff) w.u8(0xc7, data.length);
          else if (data.length <= 0xffff) (w.u8(0xc8), w.u16(data.length));
          else (w.u8(0xc9), w.u32(data.length));
          w.u8(type & 0xff);
          return w.bytes(data);
        }
        header(n.entries.length, 0x80, 15, null, 0xde, 0xdf);
        for (const [name, item] of n.entries) {
          string(name);
          write(item);
        }
        return;
      }
    }
  };

  write(node);
  return w.done();
}
