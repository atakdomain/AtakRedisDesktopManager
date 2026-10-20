// IPC tipleri — Rust karşılığı: src-tauri/src/model.rs. Bir alan değişirse ikisi aynı değişiklikte güncellenir.

/** İkili-güvenli bayt: geçerli UTF-8 ise düz metin, değilse `{ $b: base64 }`. Yardımcılar: `./bytes.ts` */
export type RBytes = string | { $b: string };

export type ConnectionMode = "standalone" | "cluster" | "sentinel";
export type EnvTag = "none" | "local" | "dev" | "test" | "staging" | "production";
export type SshAuth = "password" | "privateKey" | "agent";

export interface SentinelConfig {
  masterName: string;
  sentinelUsername: string;
  sentinelPassword: string;
}

export interface TlsConfig {
  enabled: boolean;
  caPath: string;
  certPath: string;
  keyPath: string;
  skipVerify: boolean;
  serverName: string;
}

export interface SshConfig {
  enabled: boolean;
  host: string;
  port: number;
  username: string;
  auth: SshAuth;
  password: string;
  privateKeyPath: string;
  passphrase: string;
  timeoutSec: number;
}

/** Boş metin "yok" demektir. */
export interface ConnectionConfig {
  id: string;
  name: string;
  group: string;
  color: string;
  env: EnvTag;
  mode: ConnectionMode;
  host: string;
  port: number;
  username: string;
  password: string;
  db: number;
  separator: string;
  readOnly: boolean;
  timeoutSec: number;
  sentinel: SentinelConfig;
  tls: TlsConfig;
  ssh: SshConfig;
  order: number;
  importedFrom: string;
}

export interface TestResult {
  latencyMs: number;
  serverVersion: string;
  redisMode: string;
  role: string;
}

export interface NodeInfo {
  addr: string;
  role: string;
  slots: string;
}

export interface SessionInfo {
  connectionId: string;
  serverVersion: string;
  mode: ConnectionMode;
  dbCount: number;
  nodes: NodeInfo[];
  modules: string[];
  readOnly: boolean;
}

export interface DbInfo {
  index: number;
  keys: number;
  expires: number;
}

export type SearchMode = "contains" | "prefix" | "exact" | "glob" | "regex";

export interface KeyFilter {
  mode: SearchMode;
  term: string;
  caseSensitive: boolean;
  types: string[];
}

export interface ScanBatch {
  keys: RBytes[];
  scanned: number;
}

export interface ScanResult {
  cursor: string;
  done: boolean;
  matched: number;
  scanned: number;
}

export type KeyType = "string" | "hash" | "list" | "set" | "zset" | "stream" | "ReJSON-RL" | "none" | (string & {});

export interface KeyMeta {
  type: KeyType;
  /** ms; -1 süresiz, -2 yok */
  ttl: number;
}

export interface KeyInfo {
  type: KeyType;
  ttl: number;
  length: number;
  memory: number | null;
  encoding: string;
}

export interface HashEntry {
  field: RBytes;
  value: RBytes;
}

export interface StringValue {
  value: RBytes;
  size: number;
}

export interface HashPage {
  cursor: string;
  total: number;
  items: HashEntry[];
}

export interface ListPage {
  total: number;
  start: number;
  items: RBytes[];
}

export interface SetPage {
  cursor: string;
  total: number;
  items: RBytes[];
}

export interface ZEntry {
  member: RBytes;
  score: number;
}

export interface ZSetPage {
  cursor: string;
  total: number;
  items: ZEntry[];
}

export interface StreamEntry {
  id: string;
  fields: HashEntry[];
}

export interface StreamPage {
  total: number;
  items: StreamEntry[];
}

export interface StreamGroup {
  name: string;
  consumers: number;
  pending: number;
  lastDeliveredId: string;
}

export interface NewKey {
  key: RBytes;
  type: KeyType;
  /** ms; <= 0 süresiz */
  ttlMs: number;
  field: RBytes;
  value: RBytes;
  score: number;
  entries: HashEntry[];
  streamId: string;
}

export type RValue =
  | { t: "nil" }
  | { t: "int"; v: number }
  | { t: "str"; v: RBytes }
  | { t: "status"; v: string }
  | { t: "err"; v: string }
  | { t: "arr"; v: RValue[] }
  | { t: "map"; v: [RValue, RValue][] }
  | { t: "set"; v: RValue[] }
  | { t: "dbl"; v: number }
  | { t: "bool"; v: boolean }
  | { t: "verbatim"; v: string }
  | { t: "big"; v: string };

export interface ConsoleReply {
  value: RValue;
  db: number;
  elapsedMs: number;
}

export interface PubSubMessage {
  channel: RBytes;
  pattern: string;
  payload: RBytes;
  atMs: number;
}

export interface SlowlogEntry {
  id: number;
  timestamp: number;
  durationUs: number;
  args: RBytes[];
  client: string;
  clientName: string;
}

export interface ConfigItem {
  name: string;
  value: string;
}

export type BulkSource = { kind: "keys"; keys: RBytes[] } | { kind: "filter"; filter: KeyFilter };

export type ExportFormat = "dump" | "json";

export type BulkAction =
  | { kind: "delete" }
  | { kind: "expire"; ttlMs: number; onlyWithoutTtl: boolean }
  | { kind: "rename"; find: string; replace: string; regex: boolean; caseSensitive: boolean; overwrite: boolean }
  | { kind: "copy"; targetConnectionId: string; targetDb: number; replace: boolean; moveKeys: boolean }
  | { kind: "export"; path: string; format: ExportFormat };

export interface BulkSpec {
  connectionId: string;
  db: number;
  source: BulkSource;
  action: BulkAction;
  dryRun: boolean;
}

export type BulkNote = "" | "exists" | "duplicate" | "unchanged" | "hasTtl" | "binary";

export interface BulkSampleItem {
  key: RBytes;
  newKey: RBytes | null;
  note: BulkNote;
}

export interface BulkSummary {
  scanned: number;
  matched: number;
  succeeded: number;
  failed: number;
  skipped: number;
  elapsedMs: number;
  cancelled: boolean;
  dryRun: boolean;
  outputPath: string;
}

export type BulkEvent =
  | {
      kind: "progress";
      scanned: number;
      matched: number;
      processed: number;
      succeeded: number;
      failed: number;
      skipped: number;
      total: number | null;
    }
  | { kind: "sample"; items: BulkSampleItem[] }
  | { kind: "error"; key: RBytes; message: string }
  | { kind: "done"; summary: BulkSummary };

export type ImportWarningCode = "sshKeyMissing" | "tlsCaMissing" | "tlsCertMissing" | "tlsKeyMissing" | "unsupportedOption";

export interface ImportWarning {
  code: ImportWarningCode;
  detail: string;
}

export interface ImportCandidate {
  config: ConnectionConfig;
  warnings: ImportWarning[];
  duplicateOf: string;
}

export interface ArdmScan {
  source: string;
  candidates: ImportCandidate[];
  error: string;
}

export interface AppInfo {
  version: string;
  platform: "windows" | "linux" | "macos";
  configDir: string;
  secureStorage: boolean;
}

export type ErrorKind =
  | "connection"
  | "auth"
  | "timeout"
  | "redis"
  | "readOnly"
  | "notFound"
  | "exists"
  | "invalid"
  | "io"
  | "ssh"
  | "tls"
  | "cancelled"
  | "internal";

export interface AppError {
  kind: ErrorKind;
  message: string;
}

export type CodecFormat = "gzip" | "deflate" | "zlib" | "brotli";
