// CLIENT LIST metni → satır başına alan haritası.

export interface ClientInfo {
  id: number;
  addr: string;
  name: string;
  /** saniye */
  age: number;
  /** saniye */
  idle: number;
  db: number;
  cmd: string;
  flags: string;
  user: string;
  /** Tüm alanlar (sürüme göre değişir) */
  fields: Record<string, string>;
}

export function parseClientLine(line: string): Record<string, string> {
  const fields: Record<string, string> = {};
  for (const part of line.trim().split(/\s+/)) {
    const eq = part.indexOf("=");
    if (eq > 0) fields[part.slice(0, eq)] = part.slice(eq + 1);
  }
  return fields;
}

export function parseClientList(text: string): ClientInfo[] {
  const out: ClientInfo[] = [];
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) continue;
    const f = parseClientLine(line);
    if (!("id" in f)) continue;
    out.push({
      id: Number(f.id),
      addr: f.addr ?? "",
      name: f.name ?? "",
      age: Number(f.age ?? 0),
      idle: Number(f.idle ?? 0),
      db: Number(f.db ?? 0),
      cmd: f.cmd ?? "",
      flags: f.flags ?? "",
      user: f.user ?? "",
      fields: f,
    });
  }
  return out;
}
