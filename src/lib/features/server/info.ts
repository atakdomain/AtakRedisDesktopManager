// INFO metni → bölümler + özet (pano kartları için).

export interface InfoSection {
  name: string;
  entries: [string, string][];
}

export interface Info {
  sections: InfoSection[];
  map: Map<string, string>;
}

export function parseInfo(text: string): Info {
  const sections: InfoSection[] = [];
  const map = new Map<string, string>();
  let current: InfoSection | null = null;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    if (line.startsWith("#")) {
      current = { name: line.replace(/^#+\s*/, ""), entries: [] };
      sections.push(current);
      continue;
    }
    if (!current) {
      current = { name: "", entries: [] };
      sections.push(current);
    }
    const colon = line.indexOf(":");
    const key = colon < 0 ? line : line.slice(0, colon);
    const value = colon < 0 ? "" : line.slice(colon + 1);
    current.entries.push([key, value]);
    map.set(key, value);
  }
  return { sections, map };
}

/** "keys=10,expires=2,avg_ttl=0" → { keys: "10", … } */
export function parseKv(value: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of value.split(",")) {
    const eq = part.indexOf("=");
    if (eq > 0) out[part.slice(0, eq)] = part.slice(eq + 1);
  }
  return out;
}

export interface KeyspaceRow {
  db: number;
  keys: number;
  expires: number;
  /** ms */
  avgTtl: number;
}

export function keyspace(info: Info): KeyspaceRow[] {
  const rows: KeyspaceRow[] = [];
  for (const [key, value] of info.map) {
    const m = /^db(\d+)$/.exec(key);
    if (!m) continue;
    const kv = parseKv(value);
    rows.push({ db: Number(m[1]), keys: Number(kv.keys ?? 0), expires: Number(kv.expires ?? 0), avgTtl: Number(kv.avg_ttl ?? 0) });
  }
  return rows.sort((a, b) => a.db - b.db);
}

export interface InfoSummary {
  version: string;
  mode: string;
  role: string;
  os: string;
  uptimeSec: number | null;
  usedMemory: number | null;
  usedMemoryPeak: number | null;
  usedMemoryRss: number | null;
  /** 0 = sınırsız */
  maxMemory: number | null;
  systemMemory: number | null;
  fragmentation: number | null;
  evictionPolicy: string;
  clients: number | null;
  blockedClients: number | null;
  maxClients: number | null;
  opsPerSec: number | null;
  inputKbps: number | null;
  outputKbps: number | null;
  totalCommands: number | null;
  hits: number | null;
  misses: number | null;
  /** 0–1; hiç erişim yoksa null */
  hitRatio: number | null;
  expiredKeys: number | null;
  evictedKeys: number | null;
  connectedReplicas: number | null;
  masterHost: string;
  masterLinkStatus: string;
  replOffset: number | null;
  rdbLastSave: number | null;
  rdbChanges: number | null;
  rdbLastStatus: string;
  aofEnabled: boolean | null;
}

export function summarize(info: Info): InfoSummary {
  const str = (key: string) => info.map.get(key) ?? "";
  const num = (key: string): number | null => {
    const raw = info.map.get(key);
    if (raw === undefined || raw === "") return null;
    const n = Number(raw);
    return Number.isFinite(n) ? n : null;
  };
  const hits = num("keyspace_hits");
  const misses = num("keyspace_misses");
  const total = (hits ?? 0) + (misses ?? 0);
  const host = str("master_host");
  return {
    version: str("redis_version") || str("valkey_version"),
    mode: str("redis_mode") || str("server_mode"),
    role: str("role"),
    os: str("os"),
    uptimeSec: num("uptime_in_seconds"),
    usedMemory: num("used_memory"),
    usedMemoryPeak: num("used_memory_peak"),
    usedMemoryRss: num("used_memory_rss"),
    maxMemory: num("maxmemory"),
    systemMemory: num("total_system_memory"),
    fragmentation: num("mem_fragmentation_ratio"),
    evictionPolicy: str("maxmemory_policy"),
    clients: num("connected_clients"),
    blockedClients: num("blocked_clients"),
    maxClients: num("maxclients"),
    opsPerSec: num("instantaneous_ops_per_sec"),
    inputKbps: num("instantaneous_input_kbps"),
    outputKbps: num("instantaneous_output_kbps"),
    totalCommands: num("total_commands_processed"),
    hits,
    misses,
    hitRatio: total > 0 ? (hits ?? 0) / total : null,
    expiredKeys: num("expired_keys"),
    evictedKeys: num("evicted_keys"),
    connectedReplicas: num("connected_slaves"),
    masterHost: host ? `${host}:${str("master_port")}` : "",
    masterLinkStatus: str("master_link_status"),
    replOffset: num("master_repl_offset"),
    rdbLastSave: num("rdb_last_save_time"),
    rdbChanges: num("rdb_changes_since_last_save"),
    rdbLastStatus: str("rdb_last_bgsave_status"),
    aofEnabled: info.map.has("aof_enabled") ? str("aof_enabled") === "1" : null,
  };
}
