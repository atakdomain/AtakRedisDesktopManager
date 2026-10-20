import type { RBytes } from "./types";

const encoder = new TextEncoder();
const strictDecoder = new TextDecoder("utf-8", { fatal: true });

export function isBinary(value: RBytes): value is { $b: string } {
  return typeof value !== "string";
}

export function toBytes(value: RBytes): Uint8Array {
  if (typeof value === "string") return encoder.encode(value);
  const raw = atob(value.$b);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

export function fromBytes(bytes: Uint8Array): RBytes {
  try {
    return strictDecoder.decode(bytes);
  } catch {
    let raw = "";
    for (let i = 0; i < bytes.length; i += 0x8000) {
      raw += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    }
    return { $b: btoa(raw) };
  }
}

/** Görünen ad: UTF-8 dışı baytlar redis-cli gibi `\xNN` olarak yazılır. */
export function label(value: RBytes): string {
  if (typeof value === "string") return value;
  let out = "";
  for (const b of toBytes(value)) {
    out += b >= 0x20 && b < 0x7f && b !== 0x5c ? String.fromCharCode(b) : `\\x${b.toString(16).padStart(2, "0")}`;
  }
  return out;
}

/** Map/Set anahtarı olarak kullanılabilen tekil kimlik. */
export function bytesId(value: RBytes): string {
  return typeof value === "string" ? value : `\u0000b:${value.$b}`;
}

export function bytesEqual(a: RBytes, b: RBytes): boolean {
  return bytesId(a) === bytesId(b);
}

export function byteLength(value: RBytes): number {
  return typeof value === "string" ? encoder.encode(value).length : toBytes(value).length;
}
