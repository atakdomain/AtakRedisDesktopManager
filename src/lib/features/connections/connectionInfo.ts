// Bağlantı görünümüyle ilgili saf yardımcılar: ad, adres, renk, görsel sıra.
import type { ConnectionConfig, EnvTag } from "$lib/api/types";
import { foldCase } from "$lib/util/match";

export const ENV_TAGS: EnvTag[] = ["none", "local", "dev", "test", "staging", "production"];

/** Bağlantıya elle verilebilen renkler (`#rrggbb`); iki temada da okunur tonlar */
export const SWATCHES = ["#e5484d", "#f76b15", "#e2a336", "#30a46c", "#12a594", "#3e63dd", "#8e4ec6", "#d6409f", "#8b8d98"];

/** IPv6 adresi köşeli parantezle yazılır */
export function hostPort(host: string, port: number): string {
  const h = host.includes(":") && !host.startsWith("[") ? `[${host}]` : host;
  return `${h}:${port}`;
}

export function address(c: Pick<ConnectionConfig, "host" | "port">): string {
  return hostPort(c.host, c.port);
}

export function displayName(c: Pick<ConnectionConfig, "name" | "host" | "port">): string {
  return c.name.trim() || address(c);
}

export function envColor(env: EnvTag): string | null {
  return env === "none" ? null : `var(--env-${env})`;
}

/** Şerit/nokta rengi: elle seçilen renk, yoksa ortam etiketinin rengi */
export function accentColor(c: Pick<ConnectionConfig, "color" | "env">): string | null {
  return c.color || envColor(c.env);
}

/** İki harflik kısaltma (daraltılmış ray) */
export function initials(c: Pick<ConnectionConfig, "name" | "host" | "port">): string {
  const words = displayName(c)
    .split(/[\s\-_.:/]+/)
    .filter(Boolean);
  if (words.length === 0) return "?";
  const letters = words.length === 1 ? [...words[0]].slice(0, 2) : [[...words[0]][0], [...words[1]][0]];
  return letters.join("").toLocaleUpperCase("tr");
}

/** Rayın görsel sırası: önce grupsuzlar, sonra gruplar ad sırasıyla; her biri kendi içinde `order`'a göre. */
export function visualOrder<T extends Pick<ConnectionConfig, "group" | "order">>(list: readonly T[]): T[] {
  const byOrder = [...list].sort((a, b) => a.order - b.order);
  const groups = [...new Set(byOrder.map((c) => c.group).filter(Boolean))].sort((a, b) => a.localeCompare(b));
  return [...byOrder.filter((c) => !c.group), ...groups.flatMap((g) => byOrder.filter((c) => c.group === g))];
}

/** Türkçe duyarlı (İ/ı) ad, adres ve grup araması */
export function matchesQuery(c: ConnectionConfig, query: string): boolean {
  const q = foldCase(query.trim());
  if (!q) return true;
  return [c.name, address(c), c.group, c.ssh.enabled ? c.ssh.host : ""].some((text) => text && foldCase(text).includes(q));
}

/** `taken` içinde olmayan ad: "Ad (2)", "Ad (3)" … */
export function uniqueName(base: string, taken: Iterable<string>): string {
  const names = new Set([...taken].map((n) => foldCase(n.trim())));
  if (!names.has(foldCase(base.trim()))) return base;
  for (let i = 2; ; i++) {
    const candidate = `${base} (${i})`;
    if (!names.has(foldCase(candidate))) return candidate;
  }
}
