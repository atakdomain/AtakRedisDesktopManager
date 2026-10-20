# Mimari

Tauri 2 + Rust arka uç, Svelte 5 + TypeScript ön yüz. Windows ve Linux birinci sınıf hedef (macOS bonus).

## Sözleşme

| Katman | Dosya |
|---|---|
| IPC tipleri (Rust) | `src-tauri/src/model.rs` |
| IPC tipleri (TS) | `src/lib/api/types.ts` |
| Komut listesi | `src-tauri/src/lib.rs` → `generate_handler!` |
| TS sarmalayıcılar | `src/lib/api/index.ts` (`api.*`) |
| Tarayıcı sahte arka ucu | `src/lib/api/mock.ts` (Tauri dışında `bun run dev`) |

Bir komutun imzası ya da bir tip değişirse dört dosya aynı değişiklikte güncellenir. Tauri parametre adları
snake_case (Rust) ↔ camelCase (JS) otomatik çevrilir.

**Baytlar:** anahtar, alan, değer her yerde `RBytes` — geçerli UTF-8 ise düz metin, değilse `{"$b": base64}`.
İkili anahtarlar kayıpsız gidip gelir.

**Hatalar:** her komut `Result<T, AppError>` döner; `AppError { kind, message }`. Arayüz `kind`'a göre davranır
(`auth` → parola iste, `readOnly` → bilgilendir, `cancelled` → sessiz geç).

**Uzun işler:** tarama (`keys_scan`), toplu işler (`bulk_start`, `bulk_import`), abonelikler (`pubsub_subscribe`,
`monitor_start`) bir `tauri::ipc::Channel` üzerinden olay akıtır. Kimliği (`scanId`, `jobId`, `subId`) arayüz üretir;
iptal `scan_cancel` / `bulk_cancel` / `subscription_stop` ile. `AppState.tasks` (`TaskRegistry`) iptal belirteçlerini
tutar; aynı kimlikle yeni kayıt eskisini iptal eder.

## Arka uç modülleri

```
src-tauri/src/
  bytes.rs      RBytes
  error.rs      AppError, ErrorKind, From<RedisError/io/serde>
  model.rs      IPC tipleri
  state.rs      AppState { store, sessions, tasks }
  store/        bağlantılar (connections.json) + adlandırılmış JSON belgeleri + anahtar zinciri
  net/          TCP / TLS (tokio-rustls, ring) / SSH (russh, ring) akışları
  session/      Session + SessionManager: düğüm bağlantıları, cluster yönlendirme, sentinel
  pattern.rs    KeyFilter → sunucu glob'u + istemci doğrulayıcısı
  scan.rs       çok düğümlü SCAN motoru (tarama ve toplu işler ortak kullanır)
  bulk/         toplu işler (sil, TTL, yeniden adlandır, kopyala/taşı, dışa/içe aktar)
  import/       ARDM içe aktarma (LevelDB + .ardm dosyası)
  console/      redis-cli sözdizimi ayrıştırıcı, Value → RValue
  commands/     #[tauri::command] gövdeleri — ince; iş mantığı yukarıdaki modüllerde
```

### Bağlantı katmanı

redis-rs'in cluster/TLS istemcisi kullanılmaz. Her düğüm bağlantısı elle kurulur:

1. Akış: TCP **ya da** SSH `direct-tcpip` kanalı (russh `Channel::into_stream()`), yerel port dinleyicisi yok.
2. TLS etkinse akış `tokio-rustls` ile sarılır; SNI = `tls.serverName` || hedef host. CA/cert/key PEM dosyaları;
   `skipVerify` için doğrulamayan `ServerCertVerifier`.
3. `redis::aio::MultiplexedConnection::new_with_config(&RedisConnectionInfo, stream, config)` — AUTH/SELECT
   redis-rs yapar. Her (düğüm, db) için ayrı bağlantı; SELECT paylaşılan bağlantıyı bozmaz.

Cluster: `CLUSTER SLOTS` ile slot tablosu, CRC16 (hash tag `{…}` dahil) ile yönlendirme, MOVED'da tablo yenilenir,
ASK'te hedefe `ASKING` + komut. SSH ile cluster çalışır çünkü her düğüm aynı SSH oturumu üzerinden kanal açar.
Sentinel: sentinel düğümüne bağlan, `SENTINEL get-master-addr-by-name`, master'a normal düğüm gibi bağlan.

### Anahtar arama (`pattern.rs`)

| Mod | Sunucu deseni (MATCH) |
|---|---|
| contains | `*terim*` — terimdeki `*` `?` joker, `[ ] \` kaçışlı |
| prefix | `terim*` |
| exact | kaçışlı terim; büyük/küçük duyarlıysa `EXISTS` kısayolu |
| glob | olduğu gibi |
| regex | `*` + istemci tarafı `regex` süzgeci |

Büyük/küçük harf duyarsızken ASCII harfler `[aA]` sınıfına çevrilir — süzme sunucuda kalır, hızlıdır. ASCII
dışı harf varsa (ş, İ, ı …) o harf sunucu deseninde `*`'a genişler ve istemci tarafında Unicode küçük harfe
çevirerek (Türkçe İ/ı/I → i) kesin doğrulama yapılır. Aynı derleyici hash/set/zset alan süzgecinde de kullanılır.

## Ön yüz

```
src/
  app.css                tasarım belirteçleri (açık/koyu), temel stiller
  App.svelte             yerleşim: bağlantı rayı | anahtar gezgini | sekmeler; durum çubuğu
  lib/api/               sözleşme + taşıma (tauri.ts / mock.ts)
  lib/i18n/              tr.ts (kaynak), en.ts; t("anahtar", {param})
  lib/state/             runes durum modülleri (*.svelte.ts)
  lib/ui/                ilkel bileşenler (Button, Modal, Menu, VirtualList …)
  lib/features/          connections, browser, editors, console, server, bulk, onboarding, settings
```

Hız: anahtar listesi sanal (yalnızca görünen satırlar DOM'da), tür/TTL rozetleri yalnızca görünen satırlar için
`keys_meta` ile tembel yüklenir, tarama parçalar hâlinde akar ve yeni arama eskisini iptal eder.
