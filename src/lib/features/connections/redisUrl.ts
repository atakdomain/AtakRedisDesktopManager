// redis:// ve rediss:// adreslerini ayrıştırır / üretir.
// Hoşgörülü: parolada kodlanmamış @ : / # olabilir; şemasız "host:port" de kabul edilir.
import type { ConnectionConfig } from "$lib/api/types";
import { hostPort } from "./connectionInfo";

export interface ParsedRedisUrl {
  host: string;
  port: number;
  username: string;
  password: string;
  /** Adreste yoksa null */
  db: number | null;
  tls: boolean;
}

const DEFAULT_PORT = 6379;

function decode(text: string): string {
  try {
    return decodeURIComponent(text);
  } catch {
    return text;
  }
}

function parsePort(text: string): number | null {
  if (!/^\d{1,5}$/.test(text)) return null;
  const port = Number(text);
  return port >= 1 && port <= 65535 ? port : null;
}

/** "host", "host:port", "[::1]:port" → null geçersizse */
function parseHostPort(text: string): { host: string; port: number } | null {
  if (text.startsWith("[")) {
    const end = text.indexOf("]");
    if (end < 0) return null;
    const host = text.slice(1, end);
    const rest = text.slice(end + 1);
    if (!host) return null;
    if (!rest) return { host, port: DEFAULT_PORT };
    if (!rest.startsWith(":")) return null;
    const port = parsePort(rest.slice(1));
    return port === null ? null : { host, port };
  }
  const colons = text.split(":").length - 1;
  // Köşeli parantezsiz IPv6: port yazılamaz
  if (colons > 1) return /^[0-9a-f:.]+$/i.test(text) ? { host: text, port: DEFAULT_PORT } : null;
  const [host, portText] = colons === 1 ? text.split(":") : [text, ""];
  if (!host || /[\s/@?#]/.test(host)) return null;
  if (colons === 0) return { host, port: DEFAULT_PORT };
  const port = parsePort(portText);
  return port === null ? null : { host, port };
}

function parseDb(text: string): number | null | undefined {
  if (text === "") return null;
  if (!/^\d{1,4}$/.test(text)) return undefined;
  return Number(text);
}

export function parseRedisUrl(input: string): ParsedRedisUrl | null {
  const text = input.trim();
  if (!text) return null;

  const scheme = /^([a-z][a-z0-9+.-]*):\/\//i.exec(text);
  if (!scheme) {
    // Şemasız: yalnızca "host" ya da "host:port"
    const hp = parseHostPort(text);
    return hp && /^[\w.\-[\]:]+$/.test(text) ? { ...hp, username: "", password: "", db: null, tls: false } : null;
  }
  const name = scheme[1].toLowerCase();
  if (name !== "redis" && name !== "rediss") return null;
  let rest = text.slice(scheme[0].length);

  // Kullanıcı bilgisi son @'ye kadar (parolada @ olabilir)
  let username = "";
  let password = "";
  const at = rest.lastIndexOf("@");
  if (at >= 0) {
    const userinfo = rest.slice(0, at);
    rest = rest.slice(at + 1);
    const colon = userinfo.indexOf(":");
    if (colon >= 0) {
      username = decode(userinfo.slice(0, colon));
      password = decode(userinfo.slice(colon + 1));
    } else {
      // redis-py / node-redis gibi: iki noktasız kullanıcı bilgisi kullanıcı adıdır
      username = decode(userinfo);
    }
  }

  const end = rest.search(/[/?#]/);
  const authority = end >= 0 ? rest.slice(0, end) : rest;
  const tail = end >= 0 ? rest.slice(end) : "";
  const hp = parseHostPort(authority);
  if (!hp) return null;

  let db: number | null = null;
  const pathMatch = /^\/([^?#]*)/.exec(tail);
  if (pathMatch) {
    const parsed = parseDb(pathMatch[1]);
    if (parsed === undefined) return null;
    db = parsed;
  }
  const query = /\?([^#]*)/.exec(tail);
  if (query) {
    const params = new URLSearchParams(query[1]);
    const dbParam = params.get("db");
    if (dbParam !== null) {
      const parsed = parseDb(dbParam);
      if (parsed === undefined) return null;
      db = parsed;
    }
    if (!password && params.get("password")) password = params.get("password")!;
    if (!username && params.get("username")) username = params.get("username")!;
  }

  return { ...hp, username, password, db, tls: name === "rediss" };
}

function encodeUser(text: string): string {
  return encodeURIComponent(text);
}

/** Paylaşılabilir adres — parola ASLA yazılmaz. db 0 ise yol eklenmez. */
export function formatRedisUrl(c: Pick<ConnectionConfig, "host" | "port" | "username" | "db" | "tls">): string {
  const scheme = c.tls.enabled ? "rediss" : "redis";
  const user = c.username ? `${encodeUser(c.username)}@` : "";
  const db = c.db > 0 ? `/${c.db}` : "";
  return `${scheme}://${user}${hostPort(c.host, c.port)}${db}`;
}

/** Ayrıştırılan adresi forma uygular; adreste olmayan alanlar (db) korunur. */
export function applyRedisUrl(config: ConnectionConfig, parsed: ParsedRedisUrl): void {
  config.host = parsed.host;
  config.port = parsed.port;
  config.username = parsed.username;
  config.password = parsed.password;
  if (parsed.db !== null) config.db = parsed.db;
  config.tls.enabled = parsed.tls;
}
