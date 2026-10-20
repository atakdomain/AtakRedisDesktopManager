// RValue → redis-cli (TTY) çıktısı. Yapı redis-cli'nin cliFormatReplyTTY'si ile birebir:
// numaralı diziler, iç içe girinti, `1#` map, `1~` set, `(integer)`, `(nil)`, `(empty array)` …
// Tek fark: geçerli UTF-8 metindeki ASCII dışı harfler `\xNN` yerine okunur hâliyle yazılır
// (ikili değerler ve denetim karakterleri redis-cli gibi kaçışlanır).
import { toBytes } from "$lib/api/bytes";
import type { RBytes, RValue } from "$lib/api/types";

export type SegKind = "str" | "status" | "int" | "dbl" | "nil" | "err" | "bool" | "big" | "verbatim" | "empty" | "idx" | "sep";

export interface Seg {
  k: SegKind;
  s: string;
}

/** Bir çıktı satırı: `p` girinti + sıra işaretleri ("   2) "), `segs` değer parçaları */
export interface FLine {
  p: string;
  segs: Seg[];
}

const ESCAPES: Record<string, string> = { "\\": "\\\\", '"': '\\"', "\n": "\\n", "\r": "\\r", "\t": "\\t", "\x07": "\\a", "\b": "\\b" };

function hex2(code: number): string {
  return `\\x${code.toString(16).padStart(2, "0")}`;
}

/** redis-cli sdscatrepr: tırnaklı, kaçışlı gösterim */
export function repr(value: RBytes): string {
  if (typeof value === "string") {
    return `"${value.replace(/[\\"\x00-\x1f\x7f]/g, (ch) => ESCAPES[ch] ?? hex2(ch.charCodeAt(0)))}"`;
  }
  let out = '"';
  for (const b of toBytes(value)) {
    const ch = String.fromCharCode(b);
    if (ESCAPES[ch]) out += ESCAPES[ch];
    else if (b >= 0x20 && b < 0x7f) out += ch;
    else out += hex2(b);
  }
  return `${out}"`;
}

function fmtDouble(v: number): string {
  if (Number.isNaN(v)) return "nan";
  if (v === Infinity) return "inf";
  if (v === -Infinity) return "-inf";
  return String(v);
}

function scalar(v: Exclude<RValue, { t: "arr" | "map" | "set" }>): Seg[] {
  switch (v.t) {
    case "nil":
      return [{ k: "nil", s: "(nil)" }];
    case "int":
      return [{ k: "int", s: `(integer) ${v.v}` }];
    case "str":
      return [{ k: "str", s: repr(v.v) }];
    case "status":
      return [{ k: "status", s: v.v }];
    case "err":
      return [{ k: "err", s: `(error) ${v.v}` }];
    case "dbl":
      return [{ k: "dbl", s: `(double) ${fmtDouble(v.v)}` }];
    case "bool":
      return [{ k: "bool", s: v.v ? "(true)" : "(false)" }];
    case "big":
      return [{ k: "big", s: `(big number) ${v.v}` }];
    case "verbatim":
      return [{ k: "verbatim", s: v.v }];
  }
}

const EMPTY = { arr: "(empty array)", map: "(empty hash)", set: "(empty set)" } as const;
const NUMSEP = { arr: ")", map: "#", set: "~" } as const;

function format(v: RValue, prefix: string): FLine[] {
  if (v.t === "verbatim") {
    // Doğrudan metin (ör. RESP3 INFO): her satır ayrı
    return v.v
      .replace(/\r\n/g, "\n")
      .replace(/\n$/, "")
      .split("\n")
      .map((s, i) => ({ p: i === 0 ? "" : prefix, segs: [{ k: "verbatim", s }] }));
  }
  if (v.t !== "arr" && v.t !== "map" && v.t !== "set") return [{ p: "", segs: scalar(v) }];

  const count = v.v.length;
  if (count === 0) return [{ p: "", segs: [{ k: "empty", s: EMPTY[v.t] }] }];

  const idxlen = String(count).length;
  const childPrefix = prefix + " ".repeat(idxlen + 2);
  const sep = NUMSEP[v.t];
  const out: FLine[] = [];
  for (let i = 0; i < count; i++) {
    const marker = `${String(i + 1).padStart(idxlen)}${sep} `;
    const lead = (i === 0 ? "" : prefix) + marker;
    const item = v.t === "map" ? v.v[i][0] : v.v[i];
    const lines = format(item, childPrefix);
    lines[0] = { p: lead + lines[0].p, segs: lines[0].segs };
    if (v.t === "map") {
      const value = format(v.v[i][1], childPrefix);
      const last = lines[lines.length - 1];
      const head: Seg[] = [{ k: "sep", s: " => " }];
      if (value[0].p) head.push({ k: "idx", s: value[0].p });
      lines[lines.length - 1] = { p: last.p, segs: [...last.segs, ...head, ...value[0].segs] };
      for (let j = 1; j < value.length; j++) lines.push(value[j]);
    }
    for (const line of lines) out.push(line);
  }
  return out;
}

export function formatReply(value: RValue): FLine[] {
  return format(value, "");
}

/**
 * redis-cli bu komutların yanıtını ham basar (tırnaksız, gerçek satır sonlarıyla):
 * INFO, LOLWUT, CLIENT LIST/INFO, CLUSTER NODES/INFO, MEMORY DOCTOR/MALLOC-STATS, LATENCY DOCTOR/GRAPH, DEBUG HTSTATS…
 */
export function isRawCommand(tokens: readonly string[]): boolean {
  const cmd = (tokens[0] ?? "").toLowerCase();
  const sub = (tokens[1] ?? "").toLowerCase();
  const argc = tokens.length;
  if (cmd === "info" || cmd === "lolwut") return true;
  if (cmd === "debug") return argc >= 2 && (sub === "htstats" || sub === "htstats-key" || sub === "client-eviction");
  if (cmd === "memory") return argc >= 2 && (sub === "malloc-stats" || sub === "doctor");
  if (cmd === "cluster") return argc === 2 && (sub === "nodes" || sub === "info");
  if (cmd === "client") return argc >= 2 && (sub === "list" || sub === "info");
  if (cmd === "latency") return (argc === 3 && sub === "graph") || (argc === 2 && sub === "doctor");
  return false;
}

function raw(v: RValue): string {
  switch (v.t) {
    case "nil":
      return "";
    case "err":
      return `(error) ${v.v}`;
    case "str":
      return typeof v.v === "string" ? v.v : repr(v.v).slice(1, -1);
    case "status":
    case "verbatim":
    case "big":
      return v.v;
    case "int":
      return String(v.v);
    case "dbl":
      return fmtDouble(v.v);
    case "bool":
      return v.v ? "(true)" : "(false)";
    case "arr":
    case "set":
      return v.v.map(raw).join("\n");
    case "map":
      return v.v.map(([k, x]) => `${raw(k)} ${raw(x)}`).join("\n");
  }
}

/** redis-cli cliFormatReplyRaw: diziler satır satır, metinler olduğu gibi */
export function formatRaw(value: RValue): FLine[] {
  const text = raw(value).replace(/\r\n/g, "\n").replace(/\n$/, "");
  return textLines(text, value.t === "err" ? "err" : "verbatim");
}

export function lineText(line: FLine): string {
  let out = line.p;
  for (const seg of line.segs) out += seg.s;
  return out;
}

export function linesText(lines: readonly FLine[]): string {
  return lines.map(lineText).join("\n");
}

/** Düz metinden çıktı satırları (yardım, bilgi notları) */
export function textLines(text: string, kind: SegKind = "status"): FLine[] {
  return text.split("\n").map((s) => ({ p: "", segs: [{ k: kind, s }] }));
}
