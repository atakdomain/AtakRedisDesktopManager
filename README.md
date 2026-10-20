# Atak Redis Desktop Manager

Hızlı, çapraz platform (Windows · Linux · macOS) Redis masaüstü yöneticisi. Tauri 2 + Rust arka uç, Svelte 5 arayüz.
Another Redis Desktop Manager'ın (ARDM) yerine geçmek üzere yazıldı; bağlantılar ilk açılışta tek tıkla aktarılır.

## Öne çıkanlar

- **ARDM'den aktarım** — ilk açılışta ARDM'nin yerel verisi (LevelDB) bulunur, bağlantılar parola, SSH, TLS,
  Sentinel ve Cluster ayarlarıyla gelir. ARDM verisine dokunulmaz (kopyası okunur). `.ardm` dışa aktarım dosyası da
  desteklenir.
- **Büyük/küçük harf** — aramada `Aa` (Alt+C) tek tıkla açılıp kapanır, seçim hatırlanır. Duyarsız arama sunucuda
  süzülür (`[aA]`), Türkçe İ/ı/I/i doğru eşleşir. Arama türleri: içerir, ile başlar, tam, glob, regex (Alt+R).
- **Toplu işlemler** — seçim, klasör ya da arama üzerinde sil, TTL, yeniden adlandır/öneki değiştir (regex `$1`),
  başka veritabanına/bağlantıya kopyala-taşı, dışa/içe aktar (DUMP ya da okunabilir JSON). Her işlemden önce sunucuda
  kesin sayımlı önizleme, eski → yeni ad farkı, iptal edilebilir ilerleme; canlı ortamda bağlantı adı yazılarak onay;
  silmeden önce yedek seçeneği. Gmail tarzı "sunucudaki tüm eşleşenleri seç".
- **Hız** — tarama parça parça akar, liste sanaldır; 200.000 anahtar ~2,5 sn'de yüklenir ve 60 fps kayar.
  Tür/TTL rozetleri yalnızca görünen satırlar için istenir.
- **Bağlantılar** — tekil, Cluster (kendi yönlendiricisi, MOVED/ASK), Sentinel, TLS (CA, istemci sertifikası,
  SNI), SSH tüneli (parola, anahtar, agent; Cluster dahil), ACL kullanıcı adı, salt okunur mod, ortam etiketi.
  Parolalar işletim sisteminin anahtar zincirinde saklanır.
- **Editörler** — string (Metin, JSON, Hex, Base64, Gzip/Deflate/Zlib/Brotli, MsgPack, PHP serialize), hash, list,
  set, sorted set, stream (tüketici grupları), RedisJSON. İkili anahtar ve değerler kayıpsız.
- **Konsol** — redis-cli biçiminde çıktı, komut tamamlama ve sözdizimi ipucu, geçmiş, tehlikeli komut onayı;
  Pub/Sub ve MONITOR; sunucu paneli (INFO, CONFIG, CLIENT LIST), yavaş sorgular.
- **Klavye** — Ctrl+K komut paleti, Ctrl+P anahtara git, Ctrl+` konsol; açık/koyu tema; Türkçe ve İngilizce.

## Kurulum

[Releases](https://github.com/atakdomain/AtakRedisDesktopManager/releases) sayfasından: Windows için `-setup.exe`,
Linux için `.AppImage`, `.deb` ya da `.rpm`.

## Geliştirme

Gereksinimler: [Bun](https://bun.sh), Rust (stable), Tauri'nin
[platform bağımlılıkları](https://v2.tauri.app/start/prerequisites/).

```bash
bun install
bun run app            # uygulamayı geliştirme modunda açar
bun run dev            # yalnızca arayüz, tarayıcıda sahte arka uçla
bun run check          # svelte-check
bun run test           # vitest
cargo test --manifest-path src-tauri/Cargo.toml
bun tauri build        # paketler
```

Gerçek Redis'e karşı entegrasyon testleri için yerel, geçici örnekler (tekil, ACL, TLS, Cluster, Sentinel, SSH)
WSL'de başlatılır; testler yalnızca bunlara bağlanır:

```bash
wsl -d <dağıtım> -u root -- bash scripts/dev-redis.sh start
wsl -d <dağıtım> -u root -- bash scripts/dev-redis-seed.sh 6390 0 20000
cargo test --manifest-path src-tauri/Cargo.toml -- --ignored --test-threads=1
```

Mimari ve IPC sözleşmesi: [docs/architecture.md](docs/architecture.md).
