// Onay isteyecek komutların tespiti. Konsol, sunucu ayarı düzenleme ve yavaş sorgu sıfırlama aynı kuralları kullanır.

export type DangerReason =
  | "flush"
  | "shutdown"
  | "debug"
  | "config"
  | "script"
  | "cluster"
  | "replication"
  | "client"
  | "save"
  | "swapdb"
  | "module"
  | "acl"
  | "keys";

/** KEYS bu kadar anahtarın üzerinde sunucuyu fark edilir süre kilitler */
export const KEYS_BIG_DB = 10_000;

const SIMPLE: Record<string, DangerReason> = {
  FLUSHALL: "flush",
  FLUSHDB: "flush",
  SHUTDOWN: "shutdown",
  DEBUG: "debug",
  REPLICAOF: "replication",
  SLAVEOF: "replication",
  FAILOVER: "replication",
  SAVE: "save",
  SWAPDB: "swapdb",
};

const SUB: Record<string, Record<string, DangerReason>> = {
  CONFIG: { SET: "config", RESETSTAT: "config", REWRITE: "config" },
  SCRIPT: { FLUSH: "script" },
  FUNCTION: { FLUSH: "script", DELETE: "script", RESTORE: "script" },
  CLUSTER: {
    RESET: "cluster",
    FAILOVER: "cluster",
    FORGET: "cluster",
    FLUSHSLOTS: "cluster",
    DELSLOTS: "cluster",
    DELSLOTSRANGE: "cluster",
    SETSLOT: "cluster",
    MEET: "cluster",
    REPLICATE: "cluster",
  },
  SENTINEL: { FAILOVER: "replication", RESET: "replication", REMOVE: "replication" },
  CLIENT: { KILL: "client", PAUSE: "client" },
  MODULE: { LOAD: "module", UNLOAD: "module" },
  ACL: { DELUSER: "acl" },
};

export interface DangerContext {
  /** Seçili veritabanındaki anahtar sayısı; bilinmiyorsa undefined */
  dbSize?: number;
}

export function dangerOf(tokens: readonly string[], ctx: DangerContext = {}): DangerReason | null {
  if (tokens.length === 0) return null;
  const name = tokens[0].toUpperCase();
  const simple = SIMPLE[name];
  if (simple) return simple;
  const sub = SUB[name];
  if (sub && tokens.length > 1) return sub[tokens[1].toUpperCase()] ?? null;
  if (name === "KEYS") {
    const pattern = tokens[1] ?? "";
    const wildcard = /[*?[]/.test(pattern);
    return wildcard && (ctx.dbSize ?? 0) > KEYS_BIG_DB ? "keys" : null;
  }
  return null;
}
