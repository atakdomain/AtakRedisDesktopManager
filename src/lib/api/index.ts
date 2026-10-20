// Tauri komutlarının tipli sarmalayıcıları. Komut adları ve parametreler src-tauri/src/commands/* ile birebir.
// Tauri dışında (tarayıcıda `bun run dev`) bellek içi sahte arka uç (./mock) devreye girer.
import type {
  AppError,
  AppInfo,
  ArdmScan,
  BulkEvent,
  BulkSpec,
  BulkSummary,
  CodecFormat,
  ConfigItem,
  ConnectionConfig,
  ConsoleReply,
  DbInfo,
  ErrorKind,
  HashEntry,
  HashPage,
  ImportCandidate,
  KeyFilter,
  KeyInfo,
  KeyMeta,
  ListPage,
  NewKey,
  PubSubMessage,
  RBytes,
  ScanBatch,
  ScanResult,
  SessionInfo,
  SetPage,
  SlowlogEntry,
  StreamGroup,
  StreamPage,
  StringValue,
  TestResult,
  ZSetPage,
} from "./types";

export class ApiError extends Error {
  readonly kind: ErrorKind;

  constructor(kind: ErrorKind, message: string) {
    super(message);
    this.kind = kind;
  }
}

export interface Transport {
  invoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T>;
  /** `channelArg` adlı parametreye bir Tauri Channel bağlar; her mesaj `onEvent`'e gider. */
  stream<T, E>(cmd: string, args: Record<string, unknown>, channelArg: string, onEvent: (event: E) => void): Promise<T>;
}

export const inTauri = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

let transportPromise: Promise<Transport> | null = null;

function transport(): Promise<Transport> {
  // Üretim derlemesinde DEV sabit false olduğundan sahte arka uç pakete girmez
  transportPromise ??= import.meta.env.DEV && !inTauri ? import("./mock").then((m) => m.mockTransport) : import("./tauri").then((m) => m.tauriTransport);
  return transportPromise;
}

function toApiError(err: unknown): ApiError {
  if (err instanceof ApiError) return err;
  if (err && typeof err === "object" && "kind" in err && "message" in err) {
    const e = err as AppError;
    return new ApiError(e.kind, e.message);
  }
  return new ApiError("internal", err instanceof Error ? err.message : String(err));
}

async function call<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  try {
    return await (await transport()).invoke<T>(cmd, args);
  } catch (err) {
    throw toApiError(err);
  }
}

async function callStream<T, E>(cmd: string, args: Record<string, unknown>, channelArg: string, onEvent: (event: E) => void): Promise<T> {
  try {
    return await (await transport()).stream<T, E>(cmd, args, channelArg, onEvent);
  } catch (err) {
    throw toApiError(err);
  }
}

type Cid = string;

export const api = {
  app: {
    info: () => call<AppInfo>("app_info"),
    /** Adlandırılmış JSON belgesi (settings, uistate, history …); yoksa null */
    storeGet: <T>(name: string) => call<T | null>("store_get", { name }),
    storeSet: (name: string, value: unknown) => call<void>("store_set", { name, value }),
  },

  connections: {
    list: () => call<ConnectionConfig[]>("connections_list"),
    save: (config: ConnectionConfig) => call<ConnectionConfig>("connection_save", { config }),
    saveMany: (configs: ConnectionConfig[]) => call<ConnectionConfig[]>("connections_save_many", { configs }),
    remove: (id: string) => call<void>("connection_delete", { id }),
    reorder: (ids: string[]) => call<void>("connections_reorder", { ids }),
    test: (config: ConnectionConfig) => call<TestResult>("connection_test", { config }),
  },

  session: {
    open: (connectionId: Cid) => call<SessionInfo>("session_open", { connectionId }),
    close: (connectionId: Cid) => call<void>("session_close", { connectionId }),
    dbList: (connectionId: Cid) => call<DbInfo[]>("db_list", { connectionId }),
  },

  keys: {
    /** `cursor` boş = baştan; `limit` bu çağrıda en fazla kaç eşleşme toplanacağı */
    scan: (connectionId: Cid, db: number, filter: KeyFilter, cursor: string, limit: number, scanId: string, onBatch: (b: ScanBatch) => void) =>
      callStream<ScanResult, ScanBatch>("keys_scan", { connectionId, db, filter, cursor, limit, scanId }, "onBatch", onBatch),
    cancelScan: (scanId: string) => call<void>("scan_cancel", { scanId }),
    meta: (connectionId: Cid, db: number, keys: RBytes[]) => call<KeyMeta[]>("keys_meta", { connectionId, db, keys }),
    info: (connectionId: Cid, db: number, key: RBytes) => call<KeyInfo>("key_info", { connectionId, db, key }),
    create: (connectionId: Cid, db: number, spec: NewKey) => call<void>("key_create", { connectionId, db, spec }),
    remove: (connectionId: Cid, db: number, keys: RBytes[]) => call<number>("key_delete", { connectionId, db, keys }),
    rename: (connectionId: Cid, db: number, key: RBytes, newKey: RBytes, overwrite: boolean) =>
      call<void>("key_rename", { connectionId, db, key, newKey, overwrite }),
    /** Aynı veritabanında yeni ada kopya, TTL korunur. Hedef varsa ve overwrite yoksa `exists` hatası */
    copy: (connectionId: Cid, db: number, key: RBytes, newKey: RBytes, overwrite: boolean) =>
      call<void>("key_copy", { connectionId, db, key, newKey, overwrite }),
    /** `ttlMs` <= 0 → PERSIST */
    expire: (connectionId: Cid, db: number, key: RBytes, ttlMs: number) => call<void>("key_expire", { connectionId, db, key, ttlMs }),
  },

  string: {
    get: (connectionId: Cid, db: number, key: RBytes) => call<StringValue>("string_get", { connectionId, db, key }),
    /** TTL korunur */
    set: (connectionId: Cid, db: number, key: RBytes, value: RBytes) => call<void>("string_set", { connectionId, db, key, value }),
  },

  hash: {
    scan: (connectionId: Cid, db: number, key: RBytes, cursor: string, filter: KeyFilter, count: number) =>
      call<HashPage>("hash_scan", { connectionId, db, key, cursor, filter, count }),
    /** `oldField` verilirse alan yeniden adlandırılır (atomik) */
    set: (connectionId: Cid, db: number, key: RBytes, field: RBytes, value: RBytes, oldField: RBytes | null) =>
      call<void>("hash_set", { connectionId, db, key, field, value, oldField }),
    remove: (connectionId: Cid, db: number, key: RBytes, fields: RBytes[]) => call<number>("hash_delete", { connectionId, db, key, fields }),
  },

  list: {
    range: (connectionId: Cid, db: number, key: RBytes, start: number, count: number) =>
      call<ListPage>("list_range", { connectionId, db, key, start, count }),
    set: (connectionId: Cid, db: number, key: RBytes, index: number, value: RBytes) => call<void>("list_set", { connectionId, db, key, index, value }),
    push: (connectionId: Cid, db: number, key: RBytes, values: RBytes[], tail: boolean) =>
      call<number>("list_push", { connectionId, db, key, values, tail }),
    remove: (connectionId: Cid, db: number, key: RBytes, indexes: number[]) => call<number>("list_delete", { connectionId, db, key, indexes }),
  },

  set: {
    scan: (connectionId: Cid, db: number, key: RBytes, cursor: string, filter: KeyFilter, count: number) =>
      call<SetPage>("set_scan", { connectionId, db, key, cursor, filter, count }),
    add: (connectionId: Cid, db: number, key: RBytes, members: RBytes[]) => call<number>("set_add", { connectionId, db, key, members }),
    remove: (connectionId: Cid, db: number, key: RBytes, members: RBytes[]) => call<number>("set_delete", { connectionId, db, key, members }),
    replace: (connectionId: Cid, db: number, key: RBytes, oldMember: RBytes, newMember: RBytes) =>
      call<void>("set_replace", { connectionId, db, key, oldMember, newMember }),
  },

  zset: {
    range: (connectionId: Cid, db: number, key: RBytes, start: number, count: number, desc: boolean) =>
      call<ZSetPage>("zset_range", { connectionId, db, key, start, count, desc }),
    scan: (connectionId: Cid, db: number, key: RBytes, cursor: string, filter: KeyFilter, count: number) =>
      call<ZSetPage>("zset_scan", { connectionId, db, key, cursor, filter, count }),
    add: (connectionId: Cid, db: number, key: RBytes, member: RBytes, score: number, oldMember: RBytes | null) =>
      call<void>("zset_add", { connectionId, db, key, member, score, oldMember }),
    remove: (connectionId: Cid, db: number, key: RBytes, members: RBytes[]) => call<number>("zset_delete", { connectionId, db, key, members }),
  },

  stream: {
    /** Artan: XRANGE start end; azalan: XREVRANGE end start. Sınır dışlamak için "(" öneki. */
    range: (connectionId: Cid, db: number, key: RBytes, start: string, end: string, count: number, desc: boolean) =>
      call<StreamPage>("stream_range", { connectionId, db, key, start, end, count, desc }),
    add: (connectionId: Cid, db: number, key: RBytes, id: string, fields: HashEntry[]) => call<string>("stream_add", { connectionId, db, key, id, fields }),
    remove: (connectionId: Cid, db: number, key: RBytes, ids: string[]) => call<number>("stream_delete", { connectionId, db, key, ids }),
    groups: (connectionId: Cid, db: number, key: RBytes) => call<StreamGroup[]>("stream_groups", { connectionId, db, key }),
  },

  json: {
    get: (connectionId: Cid, db: number, key: RBytes) => call<string>("json_get", { connectionId, db, key }),
    set: (connectionId: Cid, db: number, key: RBytes, value: string) => call<void>("json_set", { connectionId, db, key, value }),
  },

  console: {
    /** `node` boş = otomatik yönlendirme (cluster'da anahtara göre) */
    exec: (connectionId: Cid, db: number, line: string, node: string) => call<ConsoleReply>("console_exec", { connectionId, db, line, node }),
    subscribe: (connectionId: Cid, channels: string[], patterns: string[], subId: string, onMessage: (m: PubSubMessage) => void) =>
      callStream<void, PubSubMessage>("pubsub_subscribe", { connectionId, channels, patterns, subId }, "onMessage", onMessage),
    monitor: (connectionId: Cid, node: string, subId: string, onLine: (line: string) => void) =>
      callStream<void, string>("monitor_start", { connectionId, node, subId }, "onLine", onLine),
    stop: (subId: string) => call<void>("subscription_stop", { subId }),
  },

  server: {
    info: (connectionId: Cid, node: string) => call<string>("server_info", { connectionId, node }),
    slowlog: (connectionId: Cid, node: string, count: number) => call<SlowlogEntry[]>("server_slowlog", { connectionId, node, count }),
    slowlogReset: (connectionId: Cid, node: string) => call<void>("server_slowlog_reset", { connectionId, node }),
    clients: (connectionId: Cid, node: string) => call<string>("server_clients", { connectionId, node }),
    config: (connectionId: Cid, node: string, pattern: string) => call<ConfigItem[]>("server_config", { connectionId, node, pattern }),
    configSet: (connectionId: Cid, node: string, name: string, value: string) => call<void>("server_config_set", { connectionId, node, name, value }),
  },

  bulk: {
    /** İş bitene dek bekler; ilerleme `onEvent`'e akar. İptal: `cancel(jobId)` */
    run: (spec: BulkSpec, jobId: string, onEvent: (e: BulkEvent) => void) => callStream<BulkSummary, BulkEvent>("bulk_start", { spec, jobId }, "onEvent", onEvent),
    importFile: (connectionId: Cid, db: number, path: string, replace: boolean, jobId: string, onEvent: (e: BulkEvent) => void) =>
      callStream<BulkSummary, BulkEvent>("bulk_import", { connectionId, db, path, replace, jobId }, "onEvent", onEvent),
    cancel: (jobId: string) => call<void>("bulk_cancel", { jobId }),
  },

  importer: {
    ardmDetect: () => call<ArdmScan>("ardm_detect"),
    ardmReadFile: (path: string) => call<ImportCandidate[]>("ardm_read_file", { path }),
  },

  codec: {
    decode: (data: RBytes, format: CodecFormat) => call<RBytes>("codec_decode", { data, format }),
    encode: (data: RBytes, format: CodecFormat) => call<RBytes>("codec_encode", { data, format }),
  },
};
