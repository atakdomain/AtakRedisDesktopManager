// Değer biçimleri: ham baytları düzenleyicide gösterilecek metne çevirir ve geri yazar.
// Arayüzden bağımsızdır; sıkıştırma `Codec` ile (arka uç) yapılır, testlerde sahte verilir.
import type { CodecFormat } from "$lib/api/types";
import { decodeBase64, encodeBase64, type Base64Style } from "./base64";
import { escapeBytes, fromUtf8, isUtf8, mostlyText, unescapeText, utf8 } from "./escape";
import { parseHex, toHexLines, HexError } from "./hex";
import { checkJson, formatJson, JsonSyntaxError, looksLikeJsonContainer, minifyJson, parseJson, writeJson } from "./json";
import { looksLikeMsgpack, msgpackToJson, jsonToMsgpack } from "./msgpack";
import { jsonToPhp, looksLikePhp, phpToJson } from "./php";

export type ValueFormat = "auto" | "text" | "json" | "hex" | "base64" | CodecFormat | "msgpack" | "php";
export type ResolvedFormat = Exclude<ValueFormat, "auto">;

export const FORMATS: ValueFormat[] = ["auto", "text", "json", "hex", "base64", "gzip", "deflate", "zlib", "brotli", "msgpack", "php"];
export const COMPRESSED: readonly ResolvedFormat[] = ["gzip", "deflate", "zlib", "brotli"];

export type Language = "json" | "text" | "hex";

export interface Codec {
  decode(data: Uint8Array, format: CodecFormat): Promise<Uint8Array>;
  encode(data: Uint8Array, format: CodecFormat): Promise<Uint8Array>;
}

export type FormatErrorCode = "notJson" | "notBase64" | "notMsgpack" | "notPhp" | "codec" | "hexChar" | "hexOdd" | "jsonSyntax" | "encode";

export class FormatError extends Error {
  readonly code: FormatErrorCode;
  readonly line?: number;
  readonly column?: number;

  constructor(code: FormatErrorCode, detail = "", pos?: { line: number; column: number }) {
    super(detail || code);
    this.code = code;
    this.line = pos?.line;
    this.column = pos?.column;
  }
}

export interface Decoded {
  format: ResolvedFormat;
  /** "Otomatik" ile bulundu */
  detected: boolean;
  text: string;
  lang: Language;
  /** Metinde `\xNN` kaçışları var; kaydederken baytlara çözülür */
  escaped: boolean;
  /** İçerik JSON ise orijinali tek satır mıydı — "kaydederken küçült" varsayılanı */
  compact: boolean;
  /** Base64 alfabesi / dolgusu (geri yazarken aynısı) */
  b64?: Base64Style;
  /** Çözülmüş içeriğin bayt boyutu (base64 / sıkıştırma için anlamlı) */
  innerSize: number;
}

export function detectFormat(bytes: Uint8Array): ResolvedFormat {
  if (bytes.length === 0) return "text";
  if (bytes.length >= 3 && bytes[0] === 0x1f && bytes[1] === 0x8b && bytes[2] === 0x08) return "gzip";
  if (looksLikePhp(bytes)) return "php";
  if (!isUtf8(bytes)) {
    if (bytes.length >= 2 && bytes[0] === 0x78 && ((bytes[0] << 8) | bytes[1]) % 31 === 0) return "zlib";
    if (looksLikeMsgpack(bytes)) return "msgpack";
    return mostlyText(bytes) ? "text" : "hex";
  }
  const text = fromUtf8(bytes);
  if (looksLikeJsonContainer(text) && checkJson(text) === null) return "json";
  return "text";
}

interface Presented {
  text: string;
  lang: Language;
  escaped: boolean;
  compact: boolean;
}

/** Çözülmüş iç içerik: JSON ise güzel, UTF-8 ise metin, değilse kaçışlı metin */
function present(bytes: Uint8Array, allowJson: boolean): Presented {
  if (!isUtf8(bytes)) return { text: escapeBytes(bytes), lang: "text", escaped: true, compact: false };
  const text = fromUtf8(bytes);
  if (allowJson && looksLikeJsonContainer(text) && checkJson(text) === null) return { text: formatJson(text), lang: "json", escaped: false, compact: !text.includes("\n") };
  return { text, lang: "text", escaped: false, compact: false };
}

function jsonError(err: JsonSyntaxError, code: FormatErrorCode): FormatError {
  return new FormatError(code, err.message, { line: err.line, column: err.column });
}

export async function decodeValue(bytes: Uint8Array, format: ValueFormat, codec: Codec): Promise<Decoded> {
  const detected = format === "auto";
  const resolved = detected ? detectFormat(bytes) : format;
  try {
    return await decodeAs(bytes, resolved, detected, codec);
  } catch (err) {
    if (!detected) throw err;
    // Algılama yanıldıysa (bozuk sıkıştırma vb.) güvenli gösterime düş
    return decodeAs(bytes, isUtf8(bytes) || mostlyText(bytes) ? "text" : "hex", true, codec);
  }
}

async function decodeAs(bytes: Uint8Array, format: ResolvedFormat, detected: boolean, codec: Codec): Promise<Decoded> {
  const base = { format, detected, innerSize: bytes.length };
  switch (format) {
    case "text": {
      const escaped = !isUtf8(bytes);
      return { ...base, text: escaped ? escapeBytes(bytes) : fromUtf8(bytes), lang: "text", escaped, compact: false };
    }
    case "json": {
      if (!isUtf8(bytes)) throw new FormatError("notJson");
      const text = fromUtf8(bytes);
      const err = checkJson(text);
      if (err) throw jsonError(err, "notJson");
      return { ...base, text: formatJson(text), lang: "json", escaped: false, compact: !text.includes("\n") };
    }
    case "hex":
      return { ...base, text: toHexLines(bytes), lang: "hex", escaped: false, compact: false };
    case "base64": {
      const decoded = isUtf8(bytes) ? decodeBase64(fromUtf8(bytes)) : null;
      if (!decoded) throw new FormatError("notBase64");
      return { ...base, ...present(decoded.bytes, true), b64: decoded.style, innerSize: decoded.bytes.length };
    }
    case "gzip":
    case "deflate":
    case "zlib":
    case "brotli": {
      let inner: Uint8Array;
      try {
        inner = await codec.decode(bytes, format);
      } catch (err) {
        throw new FormatError("codec", err instanceof Error ? err.message : String(err));
      }
      return { ...base, ...present(inner, true), innerSize: inner.length };
    }
    case "msgpack":
      try {
        return { ...base, text: writeJson(msgpackToJson(bytes)), lang: "json", escaped: false, compact: false };
      } catch (err) {
        throw new FormatError("notMsgpack", err instanceof Error ? err.message : String(err));
      }
    case "php":
      try {
        return { ...base, text: writeJson(phpToJson(bytes)), lang: "json", escaped: false, compact: false };
      } catch (err) {
        throw new FormatError("notPhp", err instanceof Error ? err.message : String(err));
      }
  }
}

function parseJsonNode(text: string) {
  try {
    return parseJson(text);
  } catch (err) {
    if (err instanceof JsonSyntaxError) throw jsonError(err, "jsonSyntax");
    throw err;
  }
}

/** İç içeriğin baytları: JSON doğrulanır (isteğe bağlı küçültülür), kaçışlı metin çözülür */
export function innerBytes(text: string, decoded: Pick<Decoded, "lang" | "escaped">, minify: boolean): Uint8Array {
  if (decoded.lang === "json") {
    const err = checkJson(text);
    if (err) throw jsonError(err, "jsonSyntax");
    return utf8(minify ? minifyJson(text) : text);
  }
  return decoded.escaped ? unescapeText(text) : utf8(text);
}

/** Düzenleyici metnini, çözüldüğü biçimde baytlara geri çevirir. */
export async function encodeValue(text: string, decoded: Decoded, codec: Codec, opts: { minify: boolean }): Promise<Uint8Array> {
  switch (decoded.format) {
    case "text":
    case "json":
      return innerBytes(text, decoded, opts.minify);
    case "hex":
      try {
        return parseHex(text);
      } catch (err) {
        if (err instanceof HexError) throw new FormatError(err.code === "odd" ? "hexOdd" : "hexChar", err.message, lineColumn(text, err.offset));
        throw err;
      }
    case "base64":
      return utf8(encodeBase64(innerBytes(text, decoded, opts.minify), decoded.b64));
    case "gzip":
    case "deflate":
    case "zlib":
    case "brotli": {
      const inner = innerBytes(text, decoded, opts.minify);
      try {
        return await codec.encode(inner, decoded.format);
      } catch (err) {
        throw new FormatError("codec", err instanceof Error ? err.message : String(err));
      }
    }
    case "msgpack":
      try {
        return jsonToMsgpack(parseJsonNode(text));
      } catch (err) {
        if (err instanceof FormatError) throw err;
        throw new FormatError("encode", err instanceof Error ? err.message : String(err));
      }
    case "php":
      try {
        return jsonToPhp(parseJsonNode(text));
      } catch (err) {
        if (err instanceof FormatError) throw err;
        throw new FormatError("encode", err instanceof Error ? err.message : String(err));
      }
  }
}

function lineColumn(text: string, offset: number): { line: number; column: number } {
  const before = text.slice(0, offset);
  const line = before.split("\n").length;
  return { line, column: offset - before.lastIndexOf("\n") };
}
