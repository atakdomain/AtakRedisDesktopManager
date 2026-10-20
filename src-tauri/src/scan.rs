//! Çok düğümlü SCAN motoru: tarama (`keys_scan`) ve toplu işler ortak kullanır.
//! İmleç "düğüm:sunucu-imleci" biçimindedir; düğümler `Session::scan_nodes` sırasıyla gezilir.

use crate::bytes::RBytes;
use crate::error::{AppError, AppResult};
use crate::model::{KeyFilter, ScanBatch, ScanResult};
use crate::pattern::CompiledFilter;
use crate::session::{NodeAddr, Session};
use std::time::{Duration, Instant};
use tokio_util::sync::CancellationToken;

/// Eşleşme yokken bile `scanned` bu aralıkla arayüze akar
const IDLE_BATCH_INTERVAL: Duration = Duration::from_millis(500);

pub struct Scanner<'a> {
    session: &'a Session,
    db: u32,
    filter: CompiledFilter,
    types: Vec<String>,
    /// Tek tip ve sunucu ≥ 6.0 → SCAN … TYPE
    server_type: Option<String>,
    nodes: Vec<NodeAddr>,
    node: usize,
    cursor: u64,
    done: bool,
    /// Sunucudan gelen anahtarlar (istemci süzgecinden önce)
    pub scanned: u64,
}

impl<'a> Scanner<'a> {
    pub async fn new(session: &'a Session, db: u32, filter: &KeyFilter, cursor: &str) -> AppResult<Scanner<'a>> {
        if session.is_cluster() && db != 0 {
            return Err(AppError::invalid("cluster mode has only db 0"));
        }
        let compiled = CompiledFilter::compile(filter)?;
        let nodes = if compiled.exact_key().is_some() { Vec::new() } else { session.scan_nodes().await? };
        let (node, server_cursor) = decode_cursor(cursor, nodes.len())?;
        let server_type = match filter.types.as_slice() {
            [only] if session.version_at_least(6, 0) => Some(only.clone()),
            _ => None,
        };
        let done = compiled.exact_key().is_none() && node >= nodes.len();
        Ok(Scanner {
            session,
            db,
            filter: compiled,
            types: filter.types.clone(),
            server_type,
            done,
            nodes,
            node,
            cursor: server_cursor,
            scanned: 0,
        })
    }

    pub fn is_done(&self) -> bool {
        self.done
    }

    /// Devam imleci; tarama bittiyse boş
    pub fn cursor(&self) -> String {
        if self.done {
            String::new()
        } else {
            format!("{}:{}", self.node, self.cursor)
        }
    }

    /// Bir SCAN turu; dönen anahtarlar tip ve istemci süzgecinden geçmiştir (boş olabilir).
    pub async fn next_round(&mut self) -> AppResult<Vec<Vec<u8>>> {
        if self.done {
            return Ok(Vec::new());
        }
        if let Some(key) = self.filter.exact_key() {
            let key = key.to_vec();
            self.done = true;
            return self.exact(key).await;
        }
        let node = self.nodes[self.node].to_string();
        let reply: (String, Vec<Vec<u8>>) = self.session.query_node(&node, self.db, &self.scan_cmd()).await?;
        let (next, mut keys) = reply;
        self.scanned += keys.len() as u64;
        self.advance(&next)?;
        if self.filter.needs_client_check() {
            keys.retain(|key| self.filter.matches(key));
        }
        if !self.types.is_empty() && self.server_type.is_none() {
            keys = self.retain_types(keys).await?;
        }
        Ok(keys)
    }

    fn scan_cmd(&self) -> redis::Cmd {
        let mut cmd = redis::cmd("SCAN");
        cmd.arg(self.cursor);
        let pattern = self.filter.server_pattern();
        if pattern == "*" {
            cmd.arg("COUNT").arg(1000);
        } else {
            cmd.arg("MATCH").arg(pattern).arg("COUNT").arg(5000);
        }
        if let Some(key_type) = &self.server_type {
            cmd.arg("TYPE").arg(key_type);
        }
        cmd
    }

    fn advance(&mut self, next: &str) -> AppResult<()> {
        self.cursor = next.parse().map_err(|_| AppError::internal(format!("bad SCAN cursor {next:?}")))?;
        if self.cursor == 0 {
            self.node += 1;
            self.done = self.node >= self.nodes.len();
        }
        Ok(())
    }

    async fn exact(&mut self, key: Vec<u8>) -> AppResult<Vec<Vec<u8>>> {
        self.scanned = 1;
        let mut cmd = redis::cmd("EXISTS");
        cmd.arg(&key);
        let exists: i64 = self.session.query_key(self.db, &key, &cmd).await?;
        if exists == 0 {
            return Ok(Vec::new());
        }
        if self.types.is_empty() {
            return Ok(vec![key]);
        }
        self.retain_types(vec![key]).await
    }

    async fn retain_types(&self, keys: Vec<Vec<u8>>) -> AppResult<Vec<Vec<u8>>> {
        if keys.is_empty() {
            return Ok(keys);
        }
        let items = keys
            .iter()
            .map(|key| {
                let mut cmd = redis::cmd("TYPE");
                cmd.arg(key);
                (key.clone(), cmd)
            })
            .collect();
        let replies = self.session.pipeline_keys(self.db, items).await?;
        let wanted = |reply: AppResult<redis::Value>| {
            let key_type: String = reply.ok().and_then(|v| redis::from_redis_value(v).ok()).unwrap_or_default();
            self.types.iter().any(|t| t.eq_ignore_ascii_case(&key_type))
        };
        Ok(keys.into_iter().zip(replies).filter_map(|(key, reply)| wanted(reply).then_some(key)).collect())
    }
}

fn decode_cursor(cursor: &str, nodes: usize) -> AppResult<(usize, u64)> {
    if cursor.is_empty() {
        return Ok((0, 0));
    }
    let bad = || AppError::invalid(format!("invalid scan cursor {cursor:?}"));
    let (node, server) = cursor.split_once(':').ok_or_else(bad)?;
    let node: usize = node.parse().map_err(|_| bad())?;
    let server: u64 = server.parse().map_err(|_| bad())?;
    if node >= nodes.max(1) {
        return Err(bad());
    }
    Ok((node, server))
}

/// `keys_scan`: `limit` eşleşmeye ulaşan turdan sonra durur (turun anahtarları bölünmez), devam imleci döner.
pub async fn scan_page(
    session: &Session,
    db: u32,
    filter: &KeyFilter,
    cursor: &str,
    limit: u32,
    token: &CancellationToken,
    mut on_batch: impl FnMut(ScanBatch),
) -> AppResult<ScanResult> {
    let mut scanner = Scanner::new(session, db, filter, cursor).await?;
    let limit = u64::from(limit.max(1));
    let mut matched = 0u64;
    let mut last_batch = Instant::now();
    while !scanner.is_done() && matched < limit {
        let keys = tokio::select! {
            keys = scanner.next_round() => keys?,
            _ = token.cancelled() => return Err(AppError::cancelled()),
        };
        matched += keys.len() as u64;
        if !keys.is_empty() || last_batch.elapsed() >= IDLE_BATCH_INTERVAL {
            on_batch(ScanBatch { keys: keys.into_iter().map(RBytes).collect(), scanned: scanner.scanned });
            last_batch = Instant::now();
        }
    }
    Ok(ScanResult { cursor: scanner.cursor(), done: scanner.is_done(), matched, scanned: scanner.scanned })
}

#[cfg(test)]
pub(crate) mod tests {
    use super::*;
    use crate::error::ErrorKind;
    use crate::model::{ConnectionConfig, ConnectionMode, SearchMode};
    use crate::pattern::redis_glob;
    use crate::session::SessionManager;
    use std::collections::HashSet;
    use std::sync::Arc;

    /// Entegrasyon testleri (`scripts/dev-redis.sh start`, `cargo test -- --ignored --test-threads=1`) bu db'yi kullanır
    pub const DB: u32 = 14;

    pub fn config(port: u16) -> ConnectionConfig {
        ConnectionConfig { id: format!("ops-test-{port}"), host: "127.0.0.1".into(), port, timeout_sec: 5, ..Default::default() }
    }

    pub fn cluster_config() -> ConnectionConfig {
        ConnectionConfig { mode: ConnectionMode::Cluster, ..config(7101) }
    }

    pub async fn open(config: ConnectionConfig) -> Arc<Session> {
        SessionManager::default().connect_once(&config).await.unwrap()
    }

    /// Öneki taşıyan tüm anahtarlar (KEYS, her düğümde)
    pub async fn keys_with_prefix(s: &Session, db: u32, prefix: &str) -> HashSet<Vec<u8>> {
        let mut found = HashSet::new();
        for node in s.scan_nodes().await.unwrap() {
            let mut cmd = redis::cmd("KEYS");
            cmd.arg(format!("{prefix}*"));
            let keys: Vec<Vec<u8>> = s.query_node(&node.to_string(), db, &cmd).await.unwrap();
            found.extend(keys);
        }
        found
    }

    pub async fn purge(s: &Session, db: u32, prefix: &str) {
        let items: Vec<_> = keys_with_prefix(s, db, prefix)
            .await
            .into_iter()
            .map(|key| {
                let mut cmd = redis::cmd("DEL");
                cmd.arg(&key);
                (key, cmd)
            })
            .collect();
        if !items.is_empty() {
            assert!(s.pipeline_keys(db, items).await.unwrap().iter().all(|r| r.is_ok()));
        }
    }

    /// Değeri anahtarın kendisi olan string'ler
    pub async fn set_strings(s: &Session, db: u32, keys: &[Vec<u8>]) {
        let items = keys
            .iter()
            .map(|key| {
                let mut cmd = redis::cmd("SET");
                cmd.arg(key).arg(key);
                (key.clone(), cmd)
            })
            .collect();
        assert!(s.pipeline_keys(db, items).await.unwrap().iter().all(|r| r.is_ok()));
    }

    pub fn names(prefix: &str, count: usize) -> Vec<Vec<u8>> {
        (0..count).map(|i| format!("{prefix}{i}").into_bytes()).collect()
    }

    pub fn filter(mode: SearchMode, term: &str, case_sensitive: bool) -> KeyFilter {
        KeyFilter { mode, term: term.into(), case_sensitive, types: vec![] }
    }

    async fn scan_all(s: &Session, db: u32, filter: &KeyFilter) -> Vec<Vec<u8>> {
        let mut keys = Vec::new();
        let token = CancellationToken::new();
        let result = scan_page(s, db, filter, "", u32::MAX, &token, |b| keys.extend(b.keys.into_iter().map(|k| k.0)))
            .await
            .unwrap();
        assert!(result.done && result.cursor.is_empty());
        assert_eq!(result.matched, keys.len() as u64);
        keys
    }

    #[test]
    fn cursor_round_trip_and_validation() {
        assert_eq!(decode_cursor("", 3).unwrap(), (0, 0));
        assert_eq!(decode_cursor("2:18446744073709551615", 3).unwrap(), (2, u64::MAX));
        for bad in ["3:0", "x:1", "1", "1:-5", "1:abc"] {
            assert_eq!(decode_cursor(bad, 3).unwrap_err().kind, ErrorKind::Invalid, "{bad}");
        }
    }

    const SCAN_PREFIX: &str = "ops:test:scan:";

    fn scan_seed() -> Vec<Vec<u8>> {
        let names = [
            "User:1", "user:2", "USER:3", "İSTANBUL", "istanbul", "Istanbul", "ıstanbul", "şehir", "ŞEHİR", "sehir", "a*b",
            "axb", "a[1]", "a\\b", "Kelvin:\u{212A}", "kelvin:k", "]x", "_x",
        ];
        names
            .iter()
            .map(|n| format!("{SCAN_PREFIX}{n}").into_bytes())
            .chain([[SCAN_PREFIX.as_bytes(), b"\xff\x00bin"].concat()])
            .collect()
    }

    #[tokio::test(flavor = "multi_thread")]
    #[ignore]
    async fn scan_every_mode_and_case() {
        use SearchMode::*;
        let s = open(config(6390)).await;
        purge(&s, DB, SCAN_PREFIX).await;
        let seeded = scan_seed();
        set_strings(&s, DB, &seeded).await;
        let seeded_set: HashSet<Vec<u8>> = seeded.iter().cloned().collect();
        let cases: &[(SearchMode, &str, bool, Option<usize>)] = &[
            (Contains, "user", true, Some(1)),
            (Contains, "user", false, Some(3)),
            (Contains, "istanbul", false, Some(4)),
            (Contains, "istanbul", true, Some(1)),
            (Contains, "İSTANBUL", false, Some(4)),
            (Contains, "ıSTANBUL", false, Some(4)),
            (Contains, "şehir", false, Some(2)),
            (Contains, "şehir", true, Some(1)),
            (Contains, "a*b", true, None),
            (Contains, "a?b", false, None),
            (Contains, "a[1]", true, Some(1)),
            (Contains, "a\\b", true, Some(1)),
            (Contains, "bin", true, Some(1)),
            (Contains, "k", false, None),
            (Prefix, "ops:test:scan:u", false, Some(3)),
            (Prefix, "ops:test:scan:]", true, Some(1)),
            (Exact, "ops:test:scan:a*b", true, Some(1)),
            (Exact, "ops:test:scan:A*B", false, Some(1)),
            (Exact, "ops:test:scan:nope", true, Some(0)),
            (Glob, "ops:test:scan:[uU]ser:?", true, Some(2)),
            (Glob, "ops:test:scan:user:[0-9]", false, Some(3)),
            (Glob, "ops:test:scan:[^a-z]*", false, None),
            (Glob, "ops:test:scan:[a-]]*", true, Some(6)),
            (Regex, r"^ops:test:scan:user:\d$", false, Some(3)),
            (Regex, r"^ops:test:scan:user:\d$", true, Some(1)),
            (Regex, "İstanbul$", false, Some(4)),
        ];
        for (mode, term, cs, count) in cases {
            let f = filter(*mode, term, *cs);
            let compiled = CompiledFilter::compile(&f).unwrap();
            let expected: HashSet<Vec<u8>> = seeded.iter().filter(|k| compiled.matches(k)).cloned().collect();
            let found: HashSet<Vec<u8>> =
                scan_all(&s, DB, &f).await.into_iter().filter(|k| seeded_set.contains(k)).collect();
            assert_eq!(found, expected, "{mode:?} {term:?} cs={cs} server={:?}", compiled.server_pattern());
            if let Some(count) = count {
                assert_eq!(found.len(), *count, "{mode:?} {term:?} cs={cs}");
            }
        }
        purge(&s, DB, SCAN_PREFIX).await;
    }

    /// `redis_glob` (istemci tarafı Redis kopyası) gerçek sunucunun MATCH sonucuyla aynı mı
    #[tokio::test(flavor = "multi_thread")]
    #[ignore]
    async fn redis_glob_agrees_with_server() {
        let s = open(config(6390)).await;
        purge(&s, DB, SCAN_PREFIX).await;
        let mut seeded = scan_seed();
        set_strings(&s, DB, &seeded).await;
        set_strings(&s, DB, &[Vec::new()]).await;
        seeded.push(Vec::new());
        let patterns = [
            "ops:test:scan:a[*x]b",
            "ops:test:scan:a\\*b",
            "ops:test:scan:[a-]]*",
            "ops:test:scan:a[1",
            "*[uU][sS][eE][rR]*",
            "ops:test:scan:?*[sS][tT][aA][nN][bB][uU][lL]",
            "ops:test:scan:\\a*",
            "ops:test:scan:a\\\\b",
            "**bin",
            "ops:test:scan:[^a-z]*",
            "**",
            "ops:test:scan:[]x",
            "ops:test:scan:[^]x",
            "ops:test:scan:?x",
            "ops:test:scan:Kelvin:???",
        ];
        for pattern in patterns {
            let mut server = HashSet::new();
            let mut cursor = 0u64;
            loop {
                let mut cmd = redis::cmd("SCAN");
                cmd.arg(cursor).arg("MATCH").arg(pattern).arg("COUNT").arg(1000);
                let (next, keys): (u64, Vec<Vec<u8>>) = s.query_node("", DB, &cmd).await.unwrap();
                server.extend(keys);
                cursor = next;
                if cursor == 0 {
                    break;
                }
            }
            let ours: HashSet<Vec<u8>> = seeded.iter().filter(|k| redis_glob(pattern.as_bytes(), k)).cloned().collect();
            let theirs: HashSet<Vec<u8>> = server.into_iter().filter(|k| seeded.contains(k)).collect();
            assert_eq!(ours, theirs, "pattern {pattern:?}");
        }
        purge(&s, DB, SCAN_PREFIX).await;
        let mut del = redis::cmd("DEL");
        del.arg("");
        let _: i64 = s.query_key(DB, b"", &del).await.unwrap();
    }

    #[tokio::test(flavor = "multi_thread")]
    #[ignore]
    async fn scan_type_filters_and_exact_fast_path() {
        let s = open(config(6390)).await;
        let prefix = "ops:test:types:";
        purge(&s, DB, prefix).await;
        let key = |suffix: &str| format!("{prefix}{suffix}");
        set_strings(&s, DB, &[key("s").into_bytes()]).await;
        let mut hset = redis::cmd("HSET");
        hset.arg(key("h")).arg("f").arg("v");
        let _: i64 = s.query_key(DB, key("h").as_bytes(), &hset).await.unwrap();
        let mut rpush = redis::cmd("RPUSH");
        rpush.arg(key("l")).arg("x");
        let _: i64 = s.query_key(DB, key("l").as_bytes(), &rpush).await.unwrap();
        let typed = |types: &[&str], mode: SearchMode, term: &str| KeyFilter {
            types: types.iter().map(|t| t.to_string()).collect(),
            ..filter(mode, term, true)
        };
        let names = |keys: Vec<Vec<u8>>| -> HashSet<String> {
            keys.into_iter().map(|k| String::from_utf8(k).unwrap()).collect()
        };
        let one = names(scan_all(&s, DB, &typed(&["hash"], SearchMode::Prefix, prefix)).await);
        assert_eq!(one, HashSet::from([key("h")]));
        let two = names(scan_all(&s, DB, &typed(&["hash", "LIST"], SearchMode::Prefix, prefix)).await);
        assert_eq!(two, HashSet::from([key("h"), key("l")]));
        let exact = |types: &[&str]| typed(types, SearchMode::Exact, &key("h"));
        assert_eq!(scan_all(&s, DB, &exact(&[])).await.len(), 1);
        assert_eq!(scan_all(&s, DB, &exact(&["hash"])).await.len(), 1);
        assert_eq!(scan_all(&s, DB, &exact(&["string"])).await.len(), 0);
        let token = CancellationToken::new();
        let result = scan_page(&s, DB, &exact(&[]), "", 1, &token, |_| {}).await.unwrap();
        assert_eq!((result.done, result.matched, result.cursor.as_str()), (true, 1, ""));
        purge(&s, DB, prefix).await;
    }

    #[tokio::test(flavor = "multi_thread")]
    #[ignore]
    async fn scan_resumes_with_cursor_and_soft_limit() {
        let s = open(config(6390)).await;
        let prefix = "ops:test:resume:";
        purge(&s, DB, prefix).await;
        // COUNT 5000: birden çok tur için tablo bundan büyük olmalı
        let seeded = names(prefix, 30_000);
        set_strings(&s, DB, &seeded).await;
        let f = filter(SearchMode::Prefix, prefix, true);
        let token = CancellationToken::new();
        let (mut cursor, mut found, mut calls) = (String::new(), HashSet::new(), 0);
        loop {
            let mut batch_keys = 0;
            let result = scan_page(&s, DB, &f, &cursor, 100, &token, |b| {
                batch_keys += b.keys.len();
                found.extend(b.keys.into_iter().map(|k| k.0));
            })
            .await
            .unwrap();
            calls += 1;
            assert_eq!(result.matched, batch_keys as u64);
            assert!(result.done || result.matched >= 100, "soft limit is reached unless done");
            if result.done {
                break;
            }
            cursor = result.cursor;
        }
        assert!(calls > 2);
        assert_eq!(found, seeded.into_iter().collect::<HashSet<_>>());
        purge(&s, DB, prefix).await;
    }

    #[tokio::test(flavor = "multi_thread")]
    #[ignore]
    async fn cluster_scan_walks_every_master() {
        let s = open(cluster_config()).await;
        let prefix = "ops:test:cl:";
        purge(&s, 0, prefix).await;
        let seeded = names(prefix, 300);
        set_strings(&s, 0, &seeded).await;
        let f = filter(SearchMode::Contains, "test:CL:", false);
        let all: HashSet<Vec<u8>> = scan_all(&s, 0, &f).await.into_iter().collect();
        assert_eq!(all, seeded.iter().cloned().collect::<HashSet<_>>());
        let token = CancellationToken::new();
        let (mut cursor, mut found, mut nodes_seen) = (String::new(), HashSet::new(), HashSet::new());
        loop {
            let result = scan_page(&s, 0, &f, &cursor, 40, &token, |b| found.extend(b.keys.into_iter().map(|k| k.0)))
                .await
                .unwrap();
            if result.done {
                break;
            }
            nodes_seen.insert(result.cursor.split(':').next().unwrap().to_string());
            cursor = result.cursor;
        }
        assert_eq!(found, all);
        assert!(nodes_seen.len() >= 2, "cursor moved across nodes: {nodes_seen:?}");
        let err = scan_page(&s, 1, &f, "", 10, &token, |_| {}).await.unwrap_err();
        assert_eq!(err.kind, ErrorKind::Invalid);
        purge(&s, 0, prefix).await;
    }

    #[tokio::test(flavor = "multi_thread")]
    #[ignore]
    async fn scan_cancellation() {
        let s = open(config(6390)).await;
        let token = CancellationToken::new();
        token.cancel();
        let f = filter(SearchMode::Contains, "x", false);
        let err = scan_page(&s, DB, &f, "", 10, &token, |_| {}).await.unwrap_err();
        assert_eq!(err.kind, ErrorKind::Cancelled);
    }
}
