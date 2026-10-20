//! Arayüzle paylaşılan IPC tipleri. TypeScript karşılığı: `src/lib/api/types.ts` —
//! bir alan değişirse ikisi aynı değişiklikte güncellenir.

use crate::bytes::RBytes;
use serde::{Deserialize, Serialize};

// ───────────────────────────── Bağlantılar ─────────────────────────────

#[derive(Serialize, Deserialize, Clone, Copy, Debug, Default, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum ConnectionMode {
    #[default]
    Standalone,
    Cluster,
    Sentinel,
}

/// Ortam etiketi; `production` yıkıcı toplu işlemlerde ek onay ister.
#[derive(Serialize, Deserialize, Clone, Copy, Debug, Default, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum EnvTag {
    #[default]
    None,
    Local,
    Dev,
    Test,
    Staging,
    Production,
}

#[derive(Serialize, Deserialize, Clone, Copy, Debug, Default, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum SshAuth {
    #[default]
    Password,
    PrivateKey,
    Agent,
}

#[derive(Serialize, Deserialize, Clone, Debug, Default, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct SentinelConfig {
    pub master_name: String,
    pub sentinel_username: String,
    pub sentinel_password: String,
}

#[derive(Serialize, Deserialize, Clone, Debug, Default, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct TlsConfig {
    pub enabled: bool,
    /// PEM dosya yolları; boşsa sistem kök sertifikaları kullanılır
    pub ca_path: String,
    pub cert_path: String,
    pub key_path: String,
    pub skip_verify: bool,
    /// SNI / sertifika adı; boşsa `host`
    pub server_name: String,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct SshConfig {
    pub enabled: bool,
    pub host: String,
    pub port: u16,
    pub username: String,
    pub auth: SshAuth,
    pub password: String,
    pub private_key_path: String,
    pub passphrase: String,
    pub timeout_sec: u32,
}

impl Default for SshConfig {
    fn default() -> Self {
        SshConfig {
            enabled: false,
            host: String::new(),
            port: 22,
            username: String::new(),
            auth: SshAuth::Password,
            password: String::new(),
            private_key_path: String::new(),
            passphrase: String::new(),
            timeout_sec: 30,
        }
    }
}

/// Boş metin "yok" demektir — TypeScript tarafında opsiyonel alan yoktur.
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct ConnectionConfig {
    pub id: String,
    pub name: String,
    pub group: String,
    /// `#rrggbb` ya da boş
    pub color: String,
    pub env: EnvTag,
    pub mode: ConnectionMode,
    /// Sentinel modunda sentinel düğümünün adresi
    pub host: String,
    pub port: u16,
    pub username: String,
    pub password: String,
    /// Bağlanınca açılacak veritabanı
    pub db: u32,
    pub separator: String,
    pub read_only: bool,
    pub timeout_sec: u32,
    pub sentinel: SentinelConfig,
    pub tls: TlsConfig,
    pub ssh: SshConfig,
    pub order: i64,
    /// "ardm" ya da boş
    pub imported_from: String,
}

impl Default for ConnectionConfig {
    fn default() -> Self {
        ConnectionConfig {
            id: String::new(),
            name: String::new(),
            group: String::new(),
            color: String::new(),
            env: EnvTag::None,
            mode: ConnectionMode::Standalone,
            host: "127.0.0.1".into(),
            port: 6379,
            username: String::new(),
            password: String::new(),
            db: 0,
            separator: ":".into(),
            read_only: false,
            timeout_sec: 10,
            sentinel: SentinelConfig::default(),
            tls: TlsConfig::default(),
            ssh: SshConfig::default(),
            order: 0,
            imported_from: String::new(),
        }
    }
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct TestResult {
    pub latency_ms: f64,
    pub server_version: String,
    /// INFO `redis_mode`: standalone / cluster / sentinel
    pub redis_mode: String,
    pub role: String,
}

// ───────────────────────────── Oturum ─────────────────────────────

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct NodeInfo {
    /// `host:port` — sunucunun bildirdiği adres (SSH tünelinden önceki)
    pub addr: String,
    /// master / replica
    pub role: String,
    /// "0-5460" gibi; cluster dışı boş
    pub slots: String,
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct SessionInfo {
    pub connection_id: String,
    pub server_version: String,
    pub mode: ConnectionMode,
    /// `CONFIG GET databases`; erişilemezse 16, cluster'da 1
    pub db_count: u32,
    pub nodes: Vec<NodeInfo>,
    /// MODULE LIST adları (ör. "ReJSON", "search"); erişilemezse boş
    pub modules: Vec<String>,
    pub read_only: bool,
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct DbInfo {
    pub index: u32,
    pub keys: u64,
    pub expires: u64,
}

// ───────────────────────────── Anahtar arama ─────────────────────────────

#[derive(Serialize, Deserialize, Clone, Copy, Debug, Default, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum SearchMode {
    /// `*terim*`; terimdeki `*` ve `?` joker kalır, diğer glob karakterleri düz metindir
    #[default]
    Contains,
    /// `terim*`; joker kuralı Contains ile aynı
    Prefix,
    /// Tam eşleşme; her karakter düz metin
    Exact,
    /// Redis glob deseni olduğu gibi
    Glob,
    /// Rust `regex` sözdizimi; istemci tarafında süzülür
    Regex,
}

#[derive(Serialize, Deserialize, Clone, Debug, Default, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct KeyFilter {
    pub mode: SearchMode,
    /// Boş terim = tüm anahtarlar
    pub term: String,
    pub case_sensitive: bool,
    /// Boş = tüm tipler; ör. ["hash", "string"]
    pub types: Vec<String>,
}

/// `keys_scan` kanalına akan parça
#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct ScanBatch {
    pub keys: Vec<RBytes>,
    /// Bu taramada şimdiye dek sunucudan geçen anahtar sayısı (eşleşmeyenler dahil)
    pub scanned: u64,
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct ScanResult {
    /// Devam imleci; tarama bittiyse boş
    pub cursor: String,
    pub done: bool,
    pub matched: u64,
    pub scanned: u64,
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct KeyMeta {
    /// string / hash / list / set / zset / stream / ReJSON-RL … ; anahtar yoksa "none"
    #[serde(rename = "type")]
    pub key_type: String,
    /// Milisaniye; -1 süresiz, -2 yok
    pub ttl: i64,
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct KeyInfo {
    #[serde(rename = "type")]
    pub key_type: String,
    pub ttl: i64,
    /// STRLEN / HLEN / LLEN / SCARD / ZCARD / XLEN
    pub length: u64,
    /// MEMORY USAGE bayt; desteklenmiyorsa null
    pub memory: Option<u64>,
    pub encoding: String,
}

// ───────────────────────────── Değerler ─────────────────────────────

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct HashEntry {
    pub field: RBytes,
    pub value: RBytes,
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct StringValue {
    pub value: RBytes,
    pub size: u64,
}

/// HSCAN / SSCAN / ZSCAN sayfası. `cursor` boşsa son sayfa.
#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct HashPage {
    pub cursor: String,
    pub total: u64,
    pub items: Vec<HashEntry>,
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct ListPage {
    pub total: u64,
    pub start: i64,
    pub items: Vec<RBytes>,
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct SetPage {
    pub cursor: String,
    pub total: u64,
    pub items: Vec<RBytes>,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct ZEntry {
    pub member: RBytes,
    pub score: f64,
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct ZSetPage {
    /// Sıra tabanlı sayfada boş; ZSCAN sayfasında devam imleci
    pub cursor: String,
    pub total: u64,
    pub items: Vec<ZEntry>,
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct StreamEntry {
    pub id: String,
    pub fields: Vec<HashEntry>,
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct StreamPage {
    pub total: u64,
    pub items: Vec<StreamEntry>,
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct StreamGroup {
    pub name: String,
    pub consumers: u64,
    pub pending: u64,
    pub last_delivered_id: String,
}

/// Yeni anahtar. Tipine göre kullanılan alanlar:
/// string → `value`; hash → `field` + `value`; list/set → `value`;
/// zset → `value` + `score`; stream → `entries` (+ `streamId`, boşsa "*"); ReJSON-RL → `value` (JSON metni)
#[derive(Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase", default)]
pub struct NewKey {
    pub key: RBytes,
    #[serde(rename = "type")]
    pub key_type: String,
    /// Milisaniye; <= 0 süresiz
    pub ttl_ms: i64,
    pub field: RBytes,
    pub value: RBytes,
    pub score: f64,
    pub entries: Vec<HashEntry>,
    pub stream_id: String,
}

impl Default for NewKey {
    fn default() -> Self {
        NewKey {
            key: RBytes::default(),
            key_type: "string".into(),
            ttl_ms: 0,
            field: RBytes::default(),
            value: RBytes::default(),
            score: 0.0,
            entries: Vec::new(),
            stream_id: String::new(),
        }
    }
}

// ───────────────────────────── Konsol ─────────────────────────────

/// RESP yanıtı; arayüz redis-cli biçiminde gösterir.
#[derive(Serialize, Clone, Debug)]
#[serde(tag = "t", content = "v", rename_all = "lowercase")]
pub enum RValue {
    Nil,
    Int(i64),
    Str(RBytes),
    /// +OK gibi basit durum yanıtı
    Status(String),
    Err(String),
    Arr(Vec<RValue>),
    Map(Vec<(RValue, RValue)>),
    Set(Vec<RValue>),
    Dbl(f64),
    Bool(bool),
    Verbatim(String),
    Big(String),
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct ConsoleReply {
    pub value: RValue,
    /// SELECT sonrası konsolun veritabanı
    pub db: u32,
    pub elapsed_ms: f64,
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct PubSubMessage {
    pub channel: RBytes,
    /// PSUBSCRIBE eşleşmesiyse desen, değilse boş
    pub pattern: String,
    pub payload: RBytes,
    pub at_ms: i64,
}

// ───────────────────────────── Sunucu ─────────────────────────────

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct SlowlogEntry {
    pub id: u64,
    /// Unix saniye
    pub timestamp: i64,
    pub duration_us: u64,
    pub args: Vec<RBytes>,
    pub client: String,
    pub client_name: String,
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct ConfigItem {
    pub name: String,
    pub value: String,
}

// ───────────────────────────── Toplu işlemler ─────────────────────────────

#[derive(Deserialize, Clone, Debug)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum BulkSource {
    /// Seçili anahtarlar
    Keys { keys: Vec<RBytes> },
    /// Sunucudaki tüm eşleşenler (SCAN); klasör = prefix + separator, büyük/küçük harf duyarlı
    Filter { filter: KeyFilter },
}

#[derive(Serialize, Deserialize, Clone, Copy, Debug, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum ExportFormat {
    /// JSON Lines; satır başına {key, type, ttl, dump(base64)} — RESTORE ile birebir geri yüklenir
    Dump,
    /// Okunabilir JSON dizisi; {key, type, ttl, value}
    Json,
}

#[derive(Deserialize, Clone, Debug)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum BulkAction {
    /// UNLINK (4.0 öncesi sunucuda DEL)
    Delete,
    /// `ttlMs` <= 0 → PERSIST
    #[serde(rename_all = "camelCase")]
    Expire { ttl_ms: i64, only_without_ttl: bool },
    /// Anahtar adında bul/değiştir. regex=false iken `find` düz metin, tüm geçişleri değişir.
    /// Regex'te `replace` içinde $1, ${ad} geçerli.
    #[serde(rename_all = "camelCase")]
    Rename { find: String, replace: String, regex: bool, case_sensitive: bool, overwrite: bool },
    /// `targetConnectionId` boşsa aynı bağlantı. `moveKeys` kopyadan sonra kaynağı siler.
    #[serde(rename_all = "camelCase")]
    Copy { target_connection_id: String, target_db: u32, replace: bool, move_keys: bool },
    #[serde(rename_all = "camelCase")]
    Export { path: String, format: ExportFormat },
}

#[derive(Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct BulkSpec {
    pub connection_id: String,
    pub db: u32,
    pub source: BulkSource,
    pub action: BulkAction,
    /// true: hiçbir şey yazılmaz; eşleşenler sayılır, ilk 500'ü örnek olarak gelir
    pub dry_run: bool,
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct BulkSampleItem {
    pub key: RBytes,
    /// Rename / copy hedefi
    pub new_key: Option<RBytes>,
    /// "" | "exists" (hedef var, atlanacak) | "duplicate" (iki anahtar aynı hedefe) | "unchanged" | "hasTtl" | "binary"
    pub note: String,
}

#[derive(Serialize, Clone, Debug, Default)]
#[serde(rename_all = "camelCase")]
pub struct BulkSummary {
    pub scanned: u64,
    pub matched: u64,
    pub succeeded: u64,
    pub failed: u64,
    pub skipped: u64,
    pub elapsed_ms: u64,
    pub cancelled: bool,
    pub dry_run: bool,
    /// Export dosyası
    pub output_path: String,
}

/// `bulk_start` kanalına akan olaylar; Progress en fazla ~10/sn.
#[derive(Serialize, Clone, Debug)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum BulkEvent {
    #[serde(rename_all = "camelCase")]
    Progress {
        scanned: u64,
        matched: u64,
        processed: u64,
        succeeded: u64,
        failed: u64,
        skipped: u64,
        /// Biliniyorsa (Keys kaynağı) toplam
        total: Option<u64>,
    },
    Sample { items: Vec<BulkSampleItem> },
    /// İlk 200 hata
    Error { key: RBytes, message: String },
    Done { summary: BulkSummary },
}

// ───────────────────────────── İçe aktarma ─────────────────────────────

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct ImportWarning {
    /// sshKeyMissing / tlsCaMissing / tlsCertMissing / tlsKeyMissing / unsupportedOption
    pub code: String,
    pub detail: String,
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct ImportCandidate {
    /// `id` boş; kaydedilince atanır
    pub config: ConnectionConfig,
    pub warnings: Vec<ImportWarning>,
    /// Aynı host+port+ad'a sahip mevcut bağlantının id'si; yoksa boş
    pub duplicate_of: String,
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct ArdmScan {
    /// ARDM verisinin bulunduğu klasör; bulunamadıysa boş
    pub source: String,
    pub candidates: Vec<ImportCandidate>,
    /// Klasör bulundu ama okunamadıysa nedeni
    pub error: String,
}

// ───────────────────────────── Uygulama ─────────────────────────────

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct AppInfo {
    pub version: String,
    /// windows / linux / macos
    pub platform: String,
    pub config_dir: String,
    /// Parolalar işletim sistemi anahtar zincirinde mi
    pub secure_storage: bool,
}
