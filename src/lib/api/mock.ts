// Tarayıcıda (`bun run dev`, Tauri dışı) arayüzü denemek için bellek içi sahte arka uç.
// Gerçek davranışın kaba bir benzeri; üretim paketine girmez.
import { bytesId, fromBytes, label, toBytes } from "./bytes";
import type { Transport } from "./index";
import type {
  ArdmScan,
  BulkAction,
  BulkEvent,
  BulkSpec,
  ConnectionConfig,
  HashEntry,
  ImportCandidate,
  KeyFilter,
  KeyType,
  RBytes,
  RValue,
  StreamEntry,
  ZEntry,
} from "./types";
import { compileMatcher } from "$lib/util/match";
import { tokenize } from "$lib/features/console/parse";

type Value = RBytes | HashEntry[] | RBytes[] | ZEntry[] | StreamEntry[];

interface Entry {
  key: RBytes;
  type: KeyType;
  /** Unix ms; -1 süresiz */
  expireAt: number;
  value: Value;
}

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

function fail(kind: string, message: string): never {
  throw { kind, message };
}

// ───────────── veri ─────────────

const dbs = new Map<string, Map<string, Entry>>();

function db(cid: string, index: number): Map<string, Entry> {
  const id = `${cid}/${index}`;
  let store = dbs.get(id);
  if (!store) {
    store = seed(index === 0 ? (cid === "c-prod" ? 40000 : 2400) : index === 1 ? 120 : 0);
    dbs.set(id, store);
  }
  return store;
}

function put(store: Map<string, Entry>, key: RBytes, type: KeyType, value: Value, ttlSec = -1) {
  store.set(bytesId(key), { key, type, value, expireAt: ttlSec > 0 ? Date.now() + ttlSec * 1000 : -1 });
}

function seed(count: number): Map<string, Entry> {
  const store = new Map<string, Entry>();
  if (count === 0) return store;
  const cities = ["İstanbul", "Ankara", "İzmir", "Bursa", "Antalya", "Iğdır"];
  for (let i = 1; i <= count; i++) {
    const r = i % 9;
    if (r === 0) put(store, `user:${i}`, "hash", [
      { field: "name", value: `Kullanıcı ${i}` },
      { field: "email", value: `user${i}@example.com` },
      { field: "city", value: cities[i % cities.length] },
      { field: "createdAt", value: String(1700000000 + i) },
    ]);
    else if (r === 1) put(store, `session:${(i * 2654435761).toString(16)}`, "string", JSON.stringify({ userId: i, ip: "10.0.0." + (i % 255) }), 600 + i);
    else if (r === 2) put(store, `cache:product:${i}`, "string", JSON.stringify({ id: i, title: `Ürün ${i}`, price: (i * 3.7).toFixed(2), tags: ["a", "b"] }), 86400);
    else if (r === 3) put(store, `Cache:Product:${i}:Meta`, "string", `meta-${i}`);
    else if (r === 4) put(store, `queue:emails:${i % 20}`, "list", Array.from({ length: 30 }, (_, n) => `mail-${i}-${n}`));
    else if (r === 5) put(store, `tags:post:${i}`, "set", ["redis", "tauri", "svelte", `t${i % 13}`]);
    else if (r === 6) put(store, `leaderboard:season:${i % 7}`, "zset", Array.from({ length: 25 }, (_, n) => ({ member: `player:${n}`, score: (n * 37) % 1000 })));
    else if (r === 7) put(store, `kullanıcı:${cities[i % cities.length]}:${i}`, "string", `${cities[i % cities.length]} sakini`);
    else put(store, `events:${i % 5}`, "stream", Array.from({ length: 12 }, (_, n) => ({ id: `${1700000000000 + n}-0`, fields: [{ field: "type", value: "click" }, { field: "n", value: String(n) }] })));
  }
  put(store, "KULLANICI:ISTANBUL:özel", "string", "büyük harfli Türkçe anahtar");
  put(store, { $b: btoa(String.fromCharCode(0xff, 0x00, 0x41, 0x42)) }, "string", { $b: btoa(String.fromCharCode(0x89, 0x50, 0x4e, 0x47, 0, 1, 2)) });
  put(store, "config:feature-flags", "ReJSON-RL", JSON.stringify({ newCheckout: true, beta: ["tr", "de"] }));
  return store;
}

function live(store: Map<string, Entry>, id: string): Entry | undefined {
  const e = store.get(id);
  if (e && e.expireAt !== -1 && e.expireAt < Date.now()) {
    store.delete(id);
    return undefined;
  }
  return e;
}

function need(cid: string, dbIndex: number, key: RBytes): Entry {
  return live(db(cid, dbIndex), bytesId(key)) ?? fail("notFound", "key not found");
}

function ttlOf(e: Entry | undefined): number {
  if (!e) return -2;
  return e.expireAt === -1 ? -1 : Math.max(0, e.expireAt - Date.now());
}

let connections: ConnectionConfig[] = [
  conn("c-local", "Yerel geliştirme", "127.0.0.1", 6379, { env: "local", group: "" }),
  conn("c-stage", "Hazırlık cluster", "10.20.0.11", 7000, { env: "staging", group: "Atak", mode: "cluster" }),
  conn("c-prod", "Canlı önbellek", "redis.prod.internal", 6379, { env: "production", group: "Atak", readOnly: false, ssh: true }),
].map((c, order) => ({ ...c, order }));

function conn(id: string, name: string, host: string, port: number, extra: { env: ConnectionConfig["env"]; group: string; mode?: ConnectionConfig["mode"]; readOnly?: boolean; ssh?: boolean }): ConnectionConfig {
  return {
    id,
    name,
    group: extra.group,
    color: "",
    env: extra.env,
    mode: extra.mode ?? "standalone",
    host,
    port,
    username: "",
    password: "",
    db: 0,
    separator: ":",
    readOnly: extra.readOnly ?? false,
    timeoutSec: 10,
    sentinel: { masterName: "mymaster", sentinelUsername: "", sentinelPassword: "" },
    tls: { enabled: false, caPath: "", certPath: "", keyPath: "", skipVerify: false, serverName: "" },
    ssh: { enabled: extra.ssh ?? false, host: extra.ssh ? "bastion.example.com" : "", port: 22, username: "deploy", auth: "privateKey", password: "", privateKeyPath: "~/.ssh/id_ed25519", passphrase: "", timeoutSec: 30 },
    order: 0,
    importedFrom: "",
  };
}

const cancelled = new Set<string>();

// ───────────── konsol / pub-sub yardımcıları ─────────────

const MOCK_WRITES = new Set(["SET", "DEL", "FLUSHDB", "FLUSHALL", "HSET", "LPUSH", "RPUSH", "SADD", "ZADD", "EXPIRE", "RENAME", "INCR"]);
const mockSubs = new Map<string, { connectionId: string; channels: string[]; patterns: string[]; emit: (e: unknown) => void }>();
const mockMonitors = new Map<string, (line: string) => void>();

function mockPublish(connectionId: string, channel: string, payload: string): number {
  let delivered = 0;
  for (const sub of mockSubs.values()) {
    if (sub.connectionId !== connectionId) continue;
    if (sub.channels.includes(channel)) {
      sub.emit({ channel, pattern: "", payload, atMs: Date.now() });
      delivered++;
    }
    for (const pattern of sub.patterns) {
      if (!compileMatcher({ mode: "glob", term: pattern, caseSensitive: true }).test(channel)) continue;
      sub.emit({ channel, pattern, payload, atMs: Date.now() });
      delivered++;
    }
  }
  return delivered;
}

const mockConfig = [
  ["maxmemory", "2147483648"],
  ["maxmemory-policy", "allkeys-lru"],
  ["maxclients", "10000"],
  ["databases", "16"],
  ["timeout", "0"],
  ["tcp-keepalive", "300"],
  ["save", "3600 1 300 100 60 10000"],
  ["appendonly", "no"],
  ["appendfsync", "everysec"],
  ["slowlog-log-slower-than", "10000"],
  ["slowlog-max-len", "128"],
  ["notify-keyspace-events", ""],
  ["hz", "10"],
  ["lazyfree-lazy-eviction", "no"],
  ["requirepass", ""],
  ["bind", "127.0.0.1 -::1"],
].map(([name, value]) => ({ name, value }));

function fakeClients(): string {
  const cmds = ["get", "hgetall", "client|list", "ping", "subscribe", "blpop", "set", "xreadgroup"];
  return Array.from({ length: 24 }, (_, i) => {
    const name = i % 3 === 0 ? `worker-${i}` : i % 5 === 0 ? "web" : "";
    return `id=${i + 3} addr=10.0.${i % 4}.${10 + i}:${51000 + i * 7} laddr=127.0.0.1:6379 fd=${8 + i} name=${name} age=${(i + 1) * 431} idle=${i % 7 === 0 ? 0 : i * 13} flags=${i % 6 === 4 ? "P" : "N"} db=${i % 3} sub=0 psub=0 multi=-1 cmd=${cmds[i % cmds.length]} user=default`;
  }).join("\n");
}

function page<T>(items: T[], cursor: string, count: number, filter: KeyFilter, text: (x: T) => string) {
  const matcher = compileMatcher(filter);
  const matched = filter.term ? items.filter((x) => matcher.test(text(x))) : items;
  const start = Number(cursor || 0);
  const next = start + count;
  return { items: matched.slice(start, next), cursor: next >= matched.length ? "" : String(next), total: items.length };
}

function textOf(v: RBytes) {
  return label(v);
}

// ───────────── komutlar ─────────────

type Handler = (args: Record<string, any>, emit?: (e: unknown) => void) => unknown;

const handlers: Record<string, Handler> = {
  app_info: () => ({ version: "0.1.0-dev", platform: "windows", configDir: "(tarayıcı)", secureStorage: false }),
  store_get: ({ name }) => {
    const raw = localStorage.getItem(`mock:${name}`);
    return raw ? JSON.parse(raw) : null;
  },
  store_set: ({ name, value }) => void localStorage.setItem(`mock:${name}`, JSON.stringify(value)),

  connections_list: () => connections,
  connection_save: ({ config }) => {
    const saved = { ...config, id: config.id || `c-${Math.random().toString(36).slice(2, 8)}` };
    const i = connections.findIndex((c) => c.id === saved.id);
    if (i >= 0) connections[i] = saved;
    else connections.push({ ...saved, order: connections.length });
    return saved;
  },
  connections_save_many: ({ configs }) => configs.map((c: ConnectionConfig) => handlers.connection_save({ config: c })),
  connection_delete: ({ id }) => void (connections = connections.filter((c) => c.id !== id)),
  connections_reorder: ({ ids }) => void connections.sort((a, b) => ids.indexOf(a.id) - ids.indexOf(b.id)),
  connection_test: async ({ config }) => {
    await delay(500);
    if (config.host.includes("fail")) fail("connection", `connect ECONNREFUSED ${config.host}:${config.port}`);
    return { latencyMs: 3.4, serverVersion: "7.2.4", redisMode: config.mode, role: "master" };
  },

  session_open: async ({ connectionId }) => {
    await delay(350);
    const c = connections.find((x) => x.id === connectionId) ?? fail("notFound", "connection not found");
    if (c.host.includes("fail")) fail("auth", "WRONGPASS invalid username-password pair or user is disabled.");
    return {
      connectionId,
      serverVersion: "7.2.4",
      mode: c.mode,
      dbCount: c.mode === "cluster" ? 1 : 16,
      nodes: c.mode === "cluster" ? [1, 2, 3].map((n) => ({ addr: `10.20.0.1${n}:7000`, role: "master", slots: `${(n - 1) * 5461}-${n * 5461 - 1}` })) : [{ addr: `${c.host}:${c.port}`, role: "master", slots: "" }],
      modules: ["ReJSON"],
      readOnly: c.readOnly,
    };
  },
  session_close: () => undefined,
  db_list: ({ connectionId }) => {
    const c = connections.find((x) => x.id === connectionId);
    const count = c?.mode === "cluster" ? 1 : 16;
    return Array.from({ length: count }, (_, index) => {
      const size = index < 2 ? db(connectionId, index).size : (dbs.get(`${connectionId}/${index}`)?.size ?? 0);
      return { index, keys: size, expires: Math.floor(size / 4) };
    });
  },

  keys_scan: async ({ connectionId, db: dbIndex, filter, cursor, limit, scanId }, emit) => {
    const store = db(connectionId, dbIndex);
    const all = [...store.values()];
    const matcher = compileMatcher(filter);
    let index = Number(cursor || 0);
    let matched = 0;
    let scanned = 0;
    while (index < all.length && matched < limit) {
      if (cancelled.has(scanId)) fail("cancelled", "cancelled");
      const chunk = all.slice(index, index + 1000);
      index += chunk.length;
      scanned += chunk.length;
      const keys = chunk
        .filter((e) => (filter.types.length === 0 || filter.types.includes(e.type)) && matcher.test(textOf(e.key)))
        .map((e) => e.key);
      matched += keys.length;
      emit?.({ keys, scanned });
      await delay(8);
    }
    const done = index >= all.length;
    return { cursor: done ? "" : String(index), done, matched, scanned };
  },
  scan_cancel: ({ scanId }) => void cancelled.add(scanId),
  keys_meta: ({ connectionId, db: dbIndex, keys }) => {
    const store = db(connectionId, dbIndex);
    return keys.map((k: RBytes) => {
      const e = live(store, bytesId(k));
      return { type: e?.type ?? "none", ttl: ttlOf(e) };
    });
  },
  key_info: ({ connectionId, db: dbIndex, key }) => {
    const e = need(connectionId, dbIndex, key);
    const length = Array.isArray(e.value) ? e.value.length : toBytes(e.value as RBytes).length;
    return { type: e.type, ttl: ttlOf(e), length, memory: 64 + length * 12, encoding: e.type === "string" ? "embstr" : "listpack" };
  },
  key_create: ({ connectionId, db: dbIndex, spec }) => {
    const store = db(connectionId, dbIndex);
    if (live(store, bytesId(spec.key))) fail("exists", "key already exists");
    const value: Value =
      spec.type === "hash" ? [{ field: spec.field, value: spec.value }] : spec.type === "list" || spec.type === "set" ? [spec.value] : spec.type === "zset" ? [{ member: spec.value, score: spec.score }] : spec.type === "stream" ? [{ id: `${Date.now()}-0`, fields: spec.entries }] : spec.value;
    put(store, spec.key, spec.type, value, spec.ttlMs > 0 ? spec.ttlMs / 1000 : -1);
  },
  key_delete: ({ connectionId, db: dbIndex, keys }) => keys.filter((k: RBytes) => db(connectionId, dbIndex).delete(bytesId(k))).length,
  key_rename: ({ connectionId, db: dbIndex, key, newKey, overwrite }) => {
    const store = db(connectionId, dbIndex);
    const e = need(connectionId, dbIndex, key);
    if (!overwrite && live(store, bytesId(newKey))) fail("exists", "target key already exists");
    store.delete(bytesId(key));
    store.set(bytesId(newKey), { ...e, key: newKey });
  },
  key_copy: ({ connectionId, db: dbIndex, key, newKey, overwrite }) => {
    const store = db(connectionId, dbIndex);
    const e = need(connectionId, dbIndex, key);
    if (!overwrite && live(store, bytesId(newKey))) fail("exists", "target key already exists");
    store.set(bytesId(newKey), { ...structuredClone(e), key: newKey });
  },
  key_expire: ({ connectionId, db: dbIndex, key, ttlMs }) => {
    const e = need(connectionId, dbIndex, key);
    e.expireAt = ttlMs > 0 ? Date.now() + ttlMs : -1;
  },

  string_get: ({ connectionId, db: dbIndex, key }) => {
    const e = need(connectionId, dbIndex, key);
    return { value: e.value, size: toBytes(e.value as RBytes).length };
  },
  string_set: ({ connectionId, db: dbIndex, key, value }) => void (need(connectionId, dbIndex, key).value = value),
  hash_scan: ({ connectionId, db: dbIndex, key, cursor, filter, count }) => page(need(connectionId, dbIndex, key).value as HashEntry[], cursor, count, filter, (x) => textOf(x.field)),
  hash_set: ({ connectionId, db: dbIndex, key, field, value, oldField }) => {
    const items = need(connectionId, dbIndex, key).value as HashEntry[];
    const target = oldField ?? field;
    const i = items.findIndex((x) => bytesId(x.field) === bytesId(target));
    if (i >= 0) items[i] = { field, value };
    else items.push({ field, value });
  },
  hash_delete: ({ connectionId, db: dbIndex, key, fields }) => {
    const e = need(connectionId, dbIndex, key);
    const ids = new Set(fields.map(bytesId));
    const before = (e.value as HashEntry[]).length;
    e.value = (e.value as HashEntry[]).filter((x) => !ids.has(bytesId(x.field)));
    return before - (e.value as HashEntry[]).length;
  },
  list_range: ({ connectionId, db: dbIndex, key, start, count }) => {
    const items = need(connectionId, dbIndex, key).value as RBytes[];
    return { total: items.length, start, items: items.slice(start, start + count) };
  },
  list_set: ({ connectionId, db: dbIndex, key, index, value }) => void ((need(connectionId, dbIndex, key).value as RBytes[])[index] = value),
  list_push: ({ connectionId, db: dbIndex, key, values, tail }) => {
    const items = need(connectionId, dbIndex, key).value as RBytes[];
    if (tail) items.push(...values);
    else for (const v of values) items.unshift(v); // LPUSH a b → [b, a, …]
    return items.length;
  },
  list_delete: ({ connectionId, db: dbIndex, key, indexes }) => {
    const e = need(connectionId, dbIndex, key);
    const drop = new Set(indexes);
    e.value = (e.value as RBytes[]).filter((_, i) => !drop.has(i));
    return drop.size;
  },
  set_scan: ({ connectionId, db: dbIndex, key, cursor, filter, count }) => page(need(connectionId, dbIndex, key).value as RBytes[], cursor, count, filter, textOf),
  set_add: ({ connectionId, db: dbIndex, key, members }) => {
    const items = need(connectionId, dbIndex, key).value as RBytes[];
    const ids = new Set(items.map(bytesId));
    const added = members.filter((m: RBytes) => !ids.has(bytesId(m)));
    items.push(...added);
    return added.length;
  },
  set_delete: ({ connectionId, db: dbIndex, key, members }) => {
    const e = need(connectionId, dbIndex, key);
    const ids = new Set(members.map(bytesId));
    const before = (e.value as RBytes[]).length;
    e.value = (e.value as RBytes[]).filter((m) => !ids.has(bytesId(m)));
    return before - (e.value as RBytes[]).length;
  },
  set_replace: ({ connectionId, db: dbIndex, key, oldMember, newMember }) => {
    const items = need(connectionId, dbIndex, key).value as RBytes[];
    const i = items.findIndex((m) => bytesId(m) === bytesId(oldMember));
    if (i >= 0) items[i] = newMember;
  },
  zset_range: ({ connectionId, db: dbIndex, key, start, count, desc }) => {
    const items = [...(need(connectionId, dbIndex, key).value as ZEntry[])].sort((a, b) => (desc ? b.score - a.score : a.score - b.score));
    return { cursor: "", total: items.length, items: items.slice(start, start + count) };
  },
  zset_scan: ({ connectionId, db: dbIndex, key, cursor, filter, count }) => page(need(connectionId, dbIndex, key).value as ZEntry[], cursor, count, filter, (x) => textOf(x.member)),
  zset_add: ({ connectionId, db: dbIndex, key, member, score, oldMember }) => {
    const e = need(connectionId, dbIndex, key);
    const items = (e.value as ZEntry[]).filter((x) => bytesId(x.member) !== bytesId(oldMember ?? member));
    items.push({ member, score });
    e.value = items;
  },
  zset_delete: ({ connectionId, db: dbIndex, key, members }) => {
    const e = need(connectionId, dbIndex, key);
    const ids = new Set(members.map(bytesId));
    e.value = (e.value as ZEntry[]).filter((x) => !ids.has(bytesId(x.member)));
    return ids.size;
  },
  stream_range: ({ connectionId, db: dbIndex, key, count, desc }) => {
    const items = need(connectionId, dbIndex, key).value as StreamEntry[];
    const ordered = desc ? [...items].reverse() : items;
    return { total: items.length, items: ordered.slice(0, count) };
  },
  stream_add: ({ connectionId, db: dbIndex, key, fields }) => {
    const id = `${Date.now()}-0`;
    (need(connectionId, dbIndex, key).value as StreamEntry[]).push({ id, fields });
    return id;
  },
  stream_delete: ({ connectionId, db: dbIndex, key, ids }) => {
    const e = need(connectionId, dbIndex, key);
    e.value = (e.value as StreamEntry[]).filter((x) => !ids.includes(x.id));
    return ids.length;
  },
  stream_groups: () => [{ name: "workers", consumers: 2, pending: 3, lastDeliveredId: "1700000000005-0" }],
  json_get: ({ connectionId, db: dbIndex, key }) => need(connectionId, dbIndex, key).value as string,
  json_set: ({ connectionId, db: dbIndex, key, value }) => void (need(connectionId, dbIndex, key).value = value),

  console_exec: async ({ connectionId, db: dbIndex, line }) => {
    const started = performance.now();
    const { tokens, error } = tokenize(line);
    if (error) fail("invalid", "Invalid argument(s)");
    const [cmd = "", ...args] = tokens;
    const upper = cmd.toUpperCase();
    const store = db(connectionId, dbIndex);
    if (connections.find((c) => c.id === connectionId)?.readOnly && MOCK_WRITES.has(upper)) fail("readOnly", `${upper}: bağlantı salt okunur`);
    for (const emit of mockMonitors.values()) emit(`${(Date.now() / 1000).toFixed(6)} [${dbIndex} 127.0.0.1:50001] ${tokens.map((x) => JSON.stringify(x)).join(" ")}`);
    const str = (v: RBytes): RValue => ({ t: "str", v });
    const entry = () => live(store, bytesId(args[0] ?? ""));
    const wrongType: RValue = { t: "err", v: "WRONGTYPE Operation against a key holding the wrong kind of value" };
    let value: RValue;
    switch (upper) {
      case "PING":
        value = args[0] !== undefined ? str(args[0]) : { t: "status", v: "PONG" };
        break;
      case "ECHO":
        value = str(args[0] ?? "");
        break;
      case "DBSIZE":
        value = { t: "int", v: store.size };
        break;
      case "GET": {
        const e = entry();
        value = !e ? { t: "nil" } : e.type === "string" ? str(e.value as RBytes) : wrongType;
        break;
      }
      case "SET":
        put(store, args[0], "string", args[1] ?? "");
        value = { t: "status", v: "OK" };
        break;
      case "DEL":
        value = { t: "int", v: args.filter((k) => store.delete(bytesId(k))).length };
        break;
      case "EXISTS":
        value = { t: "int", v: args.filter((k) => live(store, bytesId(k))).length };
        break;
      case "TYPE":
        value = { t: "status", v: entry()?.type ?? "none" };
        break;
      case "TTL": {
        const ms = ttlOf(entry());
        value = { t: "int", v: ms < 0 ? ms : Math.ceil(ms / 1000) };
        break;
      }
      case "KEYS": {
        const matcher = compileMatcher({ mode: "glob", term: args[0] ?? "*", caseSensitive: true });
        value = { t: "arr", v: [...store.values()].filter((e) => matcher.test(textOf(e.key))).map((e) => str(e.key)) };
        break;
      }
      case "SCAN": {
        const all = [...store.values()];
        const from = Number(args[0]) || 0;
        const next = from + 10 >= all.length ? 0 : from + 10;
        value = { t: "arr", v: [str(String(next)), { t: "arr", v: all.slice(from, from + 10).map((e) => str(e.key)) }] };
        break;
      }
      case "SELECT":
        return { value: { t: "status", v: "OK" }, db: Number(args[0]) || 0, elapsedMs: 0.1 };
      case "HGETALL": {
        const e = entry();
        value = e && e.type !== "hash" ? wrongType : { t: "arr", v: ((e?.value as HashEntry[]) ?? []).flatMap((x) => [str(x.field), str(x.value)]) };
        break;
      }
      case "LRANGE":
      case "SMEMBERS": {
        const e = entry();
        value = { t: "arr", v: ((e?.value as RBytes[]) ?? []).slice(0, 200).map(str) };
        break;
      }
      case "ZRANGE": {
        const items = (entry()?.value as ZEntry[]) ?? [];
        const scores = args.some((a) => a.toUpperCase() === "WITHSCORES");
        value = { t: "arr", v: items.flatMap((z) => (scores ? [str(z.member), str(String(z.score))] : [str(z.member)])) };
        break;
      }
      case "ZSCORE": {
        const z = ((entry()?.value as ZEntry[]) ?? []).find((x) => textOf(x.member) === args[1]);
        value = z ? { t: "dbl", v: z.score } : { t: "nil" };
        break;
      }
      case "XRANGE": {
        const items = (entry()?.value as StreamEntry[]) ?? [];
        value = { t: "arr", v: items.map((x) => ({ t: "arr", v: [str(x.id), { t: "arr", v: x.fields.flatMap((f) => [str(f.field), str(f.value)]) }] }) as RValue) };
        break;
      }
      case "HELLO":
        value = {
          t: "map",
          v: [
            [str("server"), str("redis")],
            [str("version"), str("7.2.4")],
            [str("proto"), { t: "int", v: 3 }],
            [str("mode"), str("standalone")],
            [str("modules"), { t: "arr", v: [{ t: "map", v: [[str("name"), str("ReJSON")], [str("ver"), { t: "int", v: 20609 }]] }] }],
          ],
        };
        break;
      case "SMISMEMBER":
        value = { t: "arr", v: args.slice(1).map((_, i) => ({ t: "bool", v: i % 2 === 0 }) as RValue) };
        break;
      case "INFO":
        value = str(fakeInfo());
        break;
      case "CLIENT":
        value = (args[0] ?? "").toUpperCase() === "LIST" ? str(fakeClients()) : { t: "status", v: "OK" };
        break;
      case "CONFIG": {
        const matcher = compileMatcher({ mode: "glob", term: args[1] ?? "*", caseSensitive: false });
        value = { t: "arr", v: mockConfig.filter((c) => matcher.test(c.name)).flatMap((c) => [str(c.name), str(c.value)]) };
        break;
      }
      case "FLUSHDB":
        store.clear();
        value = { t: "status", v: "OK" };
        break;
      case "PUBLISH":
        value = { t: "int", v: mockPublish(connectionId, args[0] ?? "", args[1] ?? "") };
        break;
      case "DEBUG":
        if ((args[0] ?? "").toUpperCase() === "SLEEP") await delay(Number(args[1] ?? 0) * 1000);
        value = { t: "status", v: "OK" };
        break;
      default:
        value = { t: "err", v: `ERR unknown command '${cmd}', with args beginning with: (sahte arka uç)` };
    }
    await delay(5);
    return { value, db: dbIndex, elapsedMs: performance.now() - started };
  },
  pubsub_subscribe: async ({ connectionId, subId, channels, patterns }, emit) => {
    mockSubs.set(subId, { connectionId, channels, patterns, emit: emit! });
    let n = 0;
    const words = ["tr", "eu", "web", "mobile"];
    try {
      while (!cancelled.has(subId) && n < 1000) {
        await delay(1200);
        if (cancelled.has(subId)) break;
        const targets: [string, string][] = [
          ...channels.map((c: string): [string, string] => [c, ""]),
          ...patterns.map((p: string): [string, string] => [p.replace(/[*?]/g, words[n % words.length]).replace(/\[[^\]]*\]/g, "x"), p]),
        ];
        const [channel, pattern] = targets[n % Math.max(1, targets.length)] ?? ["news", ""];
        const payload = n % 5 === 4 ? `düz metin mesajı #${n}` : JSON.stringify({ n, at: new Date().toISOString(), user: { id: n * 7, city: "İstanbul" }, tags: ["a", "b"] });
        emit?.({ channel, pattern, payload, atMs: Date.now() });
        n++;
      }
    } finally {
      mockSubs.delete(subId);
    }
  },
  monitor_start: async ({ subId }, emit) => {
    mockMonitors.set(subId, (line) => emit?.(line));
    try {
      while (!cancelled.has(subId)) {
        await delay(900);
        if (cancelled.has(subId)) break;
        emit?.(`${(Date.now() / 1000).toFixed(6)} [0 127.0.0.1:52144] "GET" "user:${Math.floor(Math.random() * 999)}"`);
      }
    } finally {
      mockMonitors.delete(subId);
    }
  },
  subscription_stop: ({ subId }) => void cancelled.add(subId),

  server_info: () => fakeInfo(),
  server_slowlog: ({ count }) =>
    Array.from({ length: Math.min(count ?? 128, 40) }, (_, i) => ({
      id: 120 - i,
      timestamp: Math.floor(Date.now() / 1000) - i * 977,
      durationUs: [420, 2_300, 15_000, 87_000, 240_000, 1_250_000][i % 6] + i * 37,
      args:
        i % 4 === 0
          ? ["KEYS", `cache:*:${i}`]
          : i % 4 === 1
            ? ["HGETALL", `user:${i * 9}`]
            : i % 4 === 2
              ? ["EVAL", "local n = 0 for i = 1, 100000 do n = n + i end return n -- uzun bir betik metni ipucunda tam görünür", "0"]
              : ["ZRANGEBYSCORE", "leaderboard:season:3", "-inf", "+inf", "WITHSCORES"],
      client: i % 3 ? "10.0.0.5:51234" : "127.0.0.1:52144",
      clientName: i % 2 ? "worker" : "",
    })),
  server_slowlog_reset: () => undefined,
  server_clients: () => fakeClients(),
  server_config: ({ pattern }) => {
    const matcher = compileMatcher({ mode: "glob", term: pattern || "*", caseSensitive: false });
    return mockConfig.filter((c) => matcher.test(c.name));
  },
  server_config_set: ({ name, value }) => {
    const item = mockConfig.find((c) => c.name === name) ?? fail("redis", `ERR Unknown option or number of arguments for CONFIG SET - '${name}'`);
    item.value = value;
  },

  bulk_start: async ({ spec, jobId }, emit) => runBulk(spec, jobId, emit!),
  bulk_import: async ({ jobId }, emit) => {
    const started = Date.now();
    for (let i = 1; i <= 10; i++) {
      if (cancelled.has(jobId)) break;
      await delay(150);
      emit!({ kind: "progress", scanned: 0, matched: 0, processed: i * 100, succeeded: i * 100, failed: 0, skipped: 0, total: 1000 } satisfies BulkEvent);
    }
    const summary = { scanned: 0, matched: 1000, succeeded: 1000, failed: 0, skipped: 0, elapsedMs: Date.now() - started, cancelled: cancelled.has(jobId), dryRun: false, outputPath: "" };
    emit!({ kind: "done", summary });
    return summary;
  },
  bulk_cancel: ({ jobId }) => void cancelled.add(jobId),

  ardm_detect: async (): Promise<ArdmScan> => {
    await delay(400);
    return { source: "C:\\Users\\demo\\AppData\\Roaming\\another-redis-desktop-manager\\Local Storage\\leveldb", candidates: ardmSample(), error: "" };
  },
  ardm_read_file: async () => ardmSample(),

  // Tarayıcının CompressionStream API'si; brotli desteklenmediğinden olduğu gibi döner
  codec_decode: ({ data, format }) => mockCodec(data, format, false),
  codec_encode: ({ data, format }) => mockCodec(data, format, true),
};

const STREAM_FORMATS: Record<string, CompressionFormat> = { gzip: "gzip", deflate: "deflate-raw", zlib: "deflate" };

async function mockCodec(data: RBytes, format: string, encode: boolean): Promise<RBytes> {
  const kind = STREAM_FORMATS[format];
  if (!kind) return data;
  try {
    const stream = new Blob([toBytes(data) as BlobPart]).stream().pipeThrough(encode ? new CompressionStream(kind) : new DecompressionStream(kind));
    return fromBytes(new Uint8Array(await new Response(stream).arrayBuffer()));
  } catch (err) {
    return fail("invalid", `cannot ${encode ? "encode" : "decode"}: ${err instanceof Error ? err.message : String(err)}`);
  }
}

function ardmSample(): ImportCandidate[] {
  const make = (name: string, host: string, port: number, patch: Partial<ConnectionConfig> = {}) => ({ ...conn("", name, host, port, { env: "none", group: "" }), importedFrom: "ardm", ...patch });
  return [
    { config: make("Local", "127.0.0.1", 6379), warnings: [], duplicateOf: "" },
    { config: make("Prod cache", "10.0.1.20", 6379, { password: "••••", ssh: { ...conn("", "", "", 0, { env: "none", group: "", ssh: true }).ssh, privateKeyPath: "C:\\keys\\prod.pem" } }), warnings: [{ code: "sshKeyMissing", detail: "C:\\keys\\prod.pem" }], duplicateOf: "" },
    { config: make("Cluster", "10.0.2.1", 7000, { mode: "cluster" }), warnings: [], duplicateOf: "" },
    { config: make("Yerel geliştirme", "127.0.0.1", 6379), warnings: [], duplicateOf: "c-local" },
  ];
}

async function runBulk(spec: BulkSpec, jobId: string, emit: (e: unknown) => void) {
  // Arka ucun davranışını taklit eder: süzgeçte önce tarama (toplam bilinmez), notlar (exists/duplicate/unchanged/
  // binary/hasTtl), kuru çalıştırmada ilk 500 örnek, adında "locked" geçen anahtarlarda hata.
  const started = Date.now();
  const store = db(spec.connectionId, spec.db);
  const action: BulkAction = spec.action;
  let keys: RBytes[] = [];
  let scanned = 0;
  if (spec.source.kind === "keys") keys = spec.source.keys;
  else {
    const filter = spec.source.filter;
    const matcher = compileMatcher(filter);
    const all = [...store.values()];
    for (let i = 0; i < all.length && !cancelled.has(jobId); i += 2000) {
      for (const e of all.slice(i, i + 2000)) {
        if ((filter.types.length === 0 || filter.types.includes(e.type)) && matcher.test(textOf(e.key))) keys.push(e.key);
      }
      scanned = Math.min(all.length, i + 2000);
      emit({ kind: "progress", scanned, matched: keys.length, processed: 0, succeeded: 0, failed: 0, skipped: 0, total: null });
      await delay(12);
    }
  }
  const total = spec.source.kind === "keys" ? keys.length : null;
  if (spec.source.kind === "keys") scanned = keys.length;
  const plans = action.kind === "rename" ? planRenames(store, keys, action) : null;
  const target = action.kind === "copy" ? db(action.targetConnectionId || spec.connectionId, action.targetDb) : null;
  let processed = 0;
  let succeeded = 0;
  let skipped = 0;
  let failed = 0;
  let sampled = 0;
  let samples: { key: RBytes; newKey: RBytes | null; note: string }[] = [];
  const progress = () => emit({ kind: "progress", scanned, matched: keys.length, processed, succeeded, failed, skipped, total });
  for (let i = 0; i < keys.length && !cancelled.has(jobId); i++) {
    const key = keys[i];
    const id = bytesId(key);
    const e = live(store, id);
    processed++;
    let note = plans ? plans[i].note : "";
    const newKey = plans ? plans[i].newKey : null;
    if (action.kind === "expire" && action.onlyWithoutTtl && action.ttlMs > 0 && e && e.expireAt !== -1) note = "hasTtl";
    if (target && action.kind === "copy" && !action.replace && live(target, id)) note = "exists";
    if (spec.dryRun) {
      if (note) skipped++;
      if (sampled < 500) {
        sampled++;
        samples.push({ key, newKey, note });
        if (samples.length >= 100) {
          emit({ kind: "sample", items: samples });
          samples = [];
        }
      }
    } else if (note || !e) {
      skipped++;
    } else if (textOf(key).includes("locked")) {
      failed++;
      emit({ kind: "error", key, message: "BUSYKEY Target key name is locked (sahte arka uç)" });
    } else {
      if (action.kind === "delete") store.delete(id);
      else if (action.kind === "expire") e.expireAt = action.ttlMs > 0 ? Date.now() + action.ttlMs : -1;
      else if (action.kind === "rename" && newKey !== null) {
        store.delete(id);
        store.set(bytesId(newKey), { ...e, key: newKey });
      } else if (action.kind === "copy" && target) {
        target.set(id, structuredClone(e));
        if (action.moveKeys) store.delete(id);
      }
      succeeded++;
    }
    if (processed % 250 === 0) {
      progress();
      await delay(20);
    }
  }
  if (samples.length) emit({ kind: "sample", items: samples });
  progress();
  const summary = { scanned, matched: keys.length, succeeded, failed, skipped, elapsedMs: Date.now() - started, cancelled: cancelled.has(jobId), dryRun: spec.dryRun, outputPath: action.kind === "export" && !spec.dryRun ? action.path : "" };
  emit({ kind: "done", summary });
  return summary;
}

/** Arka uçtaki rename::plan gibi: ikili, değişmeyen, aynı hedefe giden, hedefi dolu olanlar not alır */
function planRenames(store: Map<string, Entry>, keys: RBytes[], action: Extract<BulkAction, { kind: "rename" }>) {
  const plans = keys.map((key) => {
    if (typeof key !== "string") return { newKey: null as RBytes | null, note: "binary" };
    const next = renamed(key, action);
    return next === key ? { newKey: null, note: "unchanged" } : { newKey: next as RBytes | null, note: "" };
  });
  const perTarget = new Map<string, number>();
  for (const p of plans) if (p.newKey !== null) perTarget.set(p.newKey as string, (perTarget.get(p.newKey as string) ?? 0) + 1);
  for (const p of plans) if (p.newKey !== null && (perTarget.get(p.newKey as string) ?? 0) > 1) p.note = "duplicate";
  const moving = new Set(keys.filter((_, i) => plans[i].note === "").map(bytesId));
  for (const p of plans) {
    if (p.note || p.newKey === null) continue;
    if (moving.has(p.newKey as string) || (!action.overwrite && live(store, p.newKey as string))) p.note = "exists";
  }
  return plans;
}

/** Bul/değiştir; duyarsızken Türkçe İ/ı → i katlaması (UTF-16 uzunluğu korunur, konumlar özgün metne uyar) */
function renamed(key: string, action: Extract<BulkAction, { kind: "rename" }>): string {
  const fold = (s: string) => (action.caseSensitive ? s : s.replace(/[İı]/g, "i"));
  const source = fold(action.regex ? action.find.replace(/\(\?P</g, "(?<") : action.find.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  let re: RegExp;
  try {
    re = new RegExp(source, action.caseSensitive ? "gd" : "gid");
  } catch {
    return key;
  }
  const hay = fold(key);
  let out = "";
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(hay)) !== null) {
    const match = m;
    out += key.slice(last, match.index);
    const group = (name: string) => {
      const span = /^\d+$/.test(name) ? match.indices?.[Number(name)] : match.indices?.groups?.[name];
      return span ? key.slice(span[0], span[1]) : "";
    };
    out += action.regex ? action.replace.replace(/\$(\$|\{(\w+)\}|(\w+))/g, (_, all: string, braced?: string, bare?: string) => (all === "$" ? "$" : group(braced ?? bare ?? ""))) : action.replace;
    last = match.index + match[0].length;
    if (match[0].length === 0) re.lastIndex++;
  }
  return out + key.slice(last);
}

function fakeInfo(): string {
  const up = Math.floor(performance.now() / 1000) + 86400 * 12;
  const ops = 800 + Math.floor(Math.random() * 400);
  const mem = 734003200 + Math.floor(Math.random() * 5_000_000);
  return [
    "# Server",
    "redis_version:7.2.4",
    "redis_mode:standalone",
    "os:Linux 6.5.0-1022-azure x86_64",
    "arch_bits:64",
    "tcp_port:6379",
    `uptime_in_seconds:${up}`,
    `uptime_in_days:${Math.floor(up / 86400)}`,
    "",
    "# Clients",
    "connected_clients:42",
    "blocked_clients:0",
    "",
    "# Memory",
    `used_memory:${mem}`,
    `used_memory_human:${(mem / 1048576).toFixed(2)}M`,
    "used_memory_peak:912261120",
    "used_memory_peak_human:870.00M",
    "maxmemory:2147483648",
    "maxmemory_human:2.00G",
    "maxmemory_policy:allkeys-lru",
    "mem_fragmentation_ratio:1.08",
    "",
    "# Stats",
    "total_connections_received:18233",
    "total_commands_processed:982733421",
    `instantaneous_ops_per_sec:${ops}`,
    "keyspace_hits:87211233",
    "keyspace_misses:4321110",
    "expired_keys:1233221",
    "evicted_keys:0",
    "",
    "# Replication",
    "role:master",
    "connected_slaves:1",
    "",
    "# Keyspace",
    "db0:keys=2400,expires=600,avg_ttl=3600000",
    "db1:keys=120,expires=0,avg_ttl=0",
  ].join("\r\n");
}

export const mockTransport: Transport = {
  async invoke<T>(cmd: string, args: Record<string, unknown> = {}): Promise<T> {
    const handler = handlers[cmd] ?? fail("internal", `mock: ${cmd} yok`);
    await delay(4);
    return structuredClone(await handler(args)) as T;
  },
  async stream<T, E>(cmd: string, args: Record<string, unknown>, _channelArg: string, onEvent: (event: E) => void): Promise<T> {
    const handler = handlers[cmd] ?? fail("internal", `mock: ${cmd} yok`);
    return structuredClone(await handler(args, (e) => onEvent(structuredClone(e) as E))) as T;
  },
};
