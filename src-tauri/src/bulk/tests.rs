//! Toplu işlerin yerel, geçici Redis'e karşı entegrasyon testleri (`scripts/dev-redis.sh start`).
//! Çalıştırma: `cargo test -- --ignored --test-threads=1`

use super::*;
use crate::bytes::RBytes;
use crate::model::{BulkSampleItem, ExportFormat, KeyFilter, SearchMode};
use crate::scan::tests::{cluster_config, config, keys_with_prefix, names, open, purge, set_strings, DB};
use std::collections::{HashMap, HashSet};
use std::sync::Mutex;

const TARGET_DB: u32 = 13;

fn spec(source: BulkSource, action: BulkAction, dry_run: bool) -> BulkSpec {
    BulkSpec { connection_id: "source".into(), db: DB, source, action, dry_run }
}

fn prefix(prefix: &str) -> BulkSource {
    BulkSource::Filter { filter: KeyFilter { mode: SearchMode::Prefix, term: prefix.into(), case_sensitive: true, types: vec![] } }
}

fn listed(keys: &[Vec<u8>]) -> BulkSource {
    BulkSource::Keys { keys: keys.iter().map(|k| RBytes(k.clone())).collect() }
}

async fn run_job(source: &Session, target: &Session, spec: &BulkSpec) -> (AppResult<BulkSummary>, Vec<BulkEvent>) {
    run_with(source, target, spec, &CancellationToken::new(), false).await
}

/// `cancel_on_progress`: ilk Progress olayında iptal eder
async fn run_with(
    source: &Session,
    target: &Session,
    spec: &BulkSpec,
    token: &CancellationToken,
    cancel_on_progress: bool,
) -> (AppResult<BulkSummary>, Vec<BulkEvent>) {
    let events = Mutex::new(Vec::new());
    let emit = |event: BulkEvent| {
        if cancel_on_progress && matches!(event, BulkEvent::Progress { .. }) {
            token.cancel();
        }
        events.lock().unwrap().push(event);
    };
    let result = run(source, target, spec, token, &emit).await;
    (result, events.into_inner().unwrap())
}

fn samples(events: &[BulkEvent]) -> Vec<BulkSampleItem> {
    events
        .iter()
        .filter_map(|e| match e {
            BulkEvent::Sample { items } => Some(items.clone()),
            _ => None,
        })
        .flatten()
        .collect()
}

fn sample_notes(events: &[BulkEvent]) -> HashMap<Vec<u8>, (Option<Vec<u8>>, String)> {
    samples(events).into_iter().map(|s| (s.key.0, (s.new_key.map(|k| k.0), s.note))).collect()
}

fn assert_done_last(events: &[BulkEvent], summary: &BulkSummary) {
    let Some(BulkEvent::Done { summary: done }) = events.last() else { panic!("Done must be the last event") };
    let counts = |s: &BulkSummary| (s.matched, s.succeeded, s.skipped, s.failed);
    assert_eq!(counts(done), counts(summary));
    assert!(matches!(events[events.len() - 2], BulkEvent::Progress { .. }), "a final Progress precedes Done");
}

async fn exists(s: &Session, db: u32, key: &[u8]) -> bool {
    s.query_key::<i64>(db, key, &key_cmd("EXISTS", key)).await.unwrap() == 1
}

async fn pttl(s: &Session, db: u32, key: &[u8]) -> i64 {
    s.query_key(db, key, &key_cmd("PTTL", key)).await.unwrap()
}

async fn get(s: &Session, db: u32, key: &[u8]) -> Option<Vec<u8>> {
    s.query_key(db, key, &key_cmd("GET", key)).await.unwrap()
}

async fn cmd(s: &Session, db: u32, key: &[u8], parts: &[&[u8]]) -> redis::Value {
    let mut c = redis::cmd(std::str::from_utf8(parts[0]).unwrap());
    for part in &parts[1..] {
        c.arg(*part);
    }
    s.query_key(db, key, &c).await.unwrap()
}

#[tokio::test(flavor = "multi_thread")]
#[ignore]
async fn delete_dry_run_then_real() {
    let s = open(config(6390)).await;
    let p = "ops:test:del:";
    purge(&s, DB, p).await;
    purge(&s, DB, "ops:test:delx").await;
    let keys = names(p, 1200);
    set_strings(&s, DB, &keys).await;
    set_strings(&s, DB, &[b"ops:test:delx".to_vec()]).await;

    let (summary, events) = run_job(&s, &s, &spec(prefix(p), BulkAction::Delete, true)).await;
    let summary = summary.unwrap();
    assert!(summary.dry_run && !summary.cancelled);
    assert_eq!((summary.matched, summary.succeeded, summary.skipped), (1200, 0, 0));
    assert_eq!(samples(&events).len(), 500);
    let sample_sizes: Vec<usize> = events
        .iter()
        .filter_map(|e| match e {
            BulkEvent::Sample { items } => Some(items.len()),
            _ => None,
        })
        .collect();
    assert_eq!(sample_sizes, [100; 5]);
    assert_done_last(&events, &summary);
    assert_eq!(keys_with_prefix(&s, DB, p).await.len(), 1200, "dry run writes nothing");

    let (summary, events) = run_job(&s, &s, &spec(prefix(p), BulkAction::Delete, false)).await;
    let summary = summary.unwrap();
    assert_eq!((summary.matched, summary.succeeded, summary.failed), (1200, 1200, 0));
    assert!(samples(&events).is_empty());
    assert_done_last(&events, &summary);
    assert!(keys_with_prefix(&s, DB, p).await.is_empty());
    assert!(exists(&s, DB, b"ops:test:delx").await);

    let pair = listed(&[b"ops:test:delx".to_vec(), b"ops:test:del:gone".to_vec()]);
    let (summary, _) = run_job(&s, &s, &spec(pair, BulkAction::Delete, false)).await;
    let summary = summary.unwrap();
    assert_eq!((summary.matched, summary.succeeded, summary.skipped), (2, 1, 1));
}

#[tokio::test(flavor = "multi_thread")]
#[ignore]
async fn expire_only_without_ttl_and_persist() {
    let s = open(config(6390)).await;
    let p = "ops:test:exp:";
    purge(&s, DB, p).await;
    let keys = names(p, 3);
    set_strings(&s, DB, &keys).await;
    cmd(&s, DB, &keys[1], &[b"PEXPIRE", &keys[1], b"100000"]).await;
    let action = BulkAction::Expire { ttl_ms: 50_000, only_without_ttl: true };

    let (summary, events) = run_job(&s, &s, &spec(listed(&keys), action.clone(), true)).await;
    assert_eq!(summary.unwrap().skipped, 1);
    let notes = sample_notes(&events);
    assert_eq!(notes[&keys[1]].1, "hasTtl");
    assert_eq!(notes[&keys[0]].1, "");
    assert_eq!(pttl(&s, DB, &keys[0]).await, -1, "dry run writes nothing");

    let (summary, _) = run_job(&s, &s, &spec(prefix(p), action, false)).await;
    let summary = summary.unwrap();
    assert_eq!((summary.succeeded, summary.skipped), (2, 1));
    assert!((1..=50_000).contains(&pttl(&s, DB, &keys[0]).await));
    assert!(pttl(&s, DB, &keys[1]).await > 50_000, "existing TTL kept");

    let (summary, _) = run_job(&s, &s, &spec(prefix(p), BulkAction::Expire { ttl_ms: 0, only_without_ttl: false }, false)).await;
    assert_eq!(summary.unwrap().succeeded, 3);
    for key in &keys {
        assert_eq!(pttl(&s, DB, key).await, -1);
    }
    purge(&s, DB, p).await;
}

fn rename_action(find: &str, replace: &str, regex: bool, case_sensitive: bool, overwrite: bool) -> BulkAction {
    BulkAction::Rename { find: find.into(), replace: replace.into(), regex, case_sensitive, overwrite }
}

/// Yeni adlar filtreye yeniden uyar (`user:` → `user:old:`); her anahtar tam bir kez adlandırılmalı
#[tokio::test(flavor = "multi_thread")]
#[ignore]
async fn rename_does_not_chase_its_own_output() {
    let s = open(config(6390)).await;
    let p = "ops:test:rn:user:";
    purge(&s, DB, "ops:test:rn:").await;
    let keys = names(p, 2000);
    set_strings(&s, DB, &keys).await;
    let (summary, _) = run_job(&s, &s, &spec(prefix(p), rename_action("user:", "user:old:", false, true, false), false)).await;
    let summary = summary.unwrap();
    assert_eq!((summary.matched, summary.succeeded, summary.skipped, summary.failed), (2000, 2000, 0, 0));
    let after = keys_with_prefix(&s, DB, "ops:test:rn:").await;
    let want: HashSet<Vec<u8>> = (0..2000).map(|i| format!("ops:test:rn:user:old:{i}").into_bytes()).collect();
    assert_eq!(after, want);
    assert_eq!(get(&s, DB, b"ops:test:rn:user:old:7").await.unwrap(), b"ops:test:rn:user:7");
    purge(&s, DB, "ops:test:rn:").await;
}

#[tokio::test(flavor = "multi_thread")]
#[ignore]
async fn rename_notes_turkish_regex_and_overwrite() {
    let s = open(config(6390)).await;
    let p = "ops:test:rn2:";
    purge(&s, DB, p).await;
    let k = |suffix: &[u8]| [p.as_bytes(), suffix].concat();
    let seeded = [k(b"Old:1"), k(b"old:2"), k(b"new:2"), k(b"a:old"), k(b"a:OLD"), k(b"other"), k(b"\xffold"), k(b"x"), k(b"xx")];
    set_strings(&s, DB, &seeded).await;
    let action = rename_action("old", "new", false, false, false);

    let (summary, events) = run_job(&s, &s, &spec(prefix(p), action.clone(), true)).await;
    let summary = summary.unwrap();
    let notes = sample_notes(&events);
    assert_eq!(notes[&k(b"Old:1")], (Some(k(b"new:1")), String::new()));
    assert_eq!(notes[&k(b"old:2")], (Some(k(b"new:2")), "exists".into()));
    assert_eq!(notes[&k(b"a:old")].1, "duplicate");
    assert_eq!(notes[&k(b"a:OLD")].1, "duplicate");
    assert_eq!(notes[&k(b"other")], (None, "unchanged".into()));
    assert_eq!(notes[&k(b"\xffold")], (None, "binary".into()));
    assert_eq!((summary.matched, summary.skipped), (9, 8));

    let (summary, _) = run_job(&s, &s, &spec(prefix(p), action, false)).await;
    let summary = summary.unwrap();
    assert_eq!((summary.succeeded, summary.skipped, summary.failed), (1, 8, 0));
    assert_eq!(get(&s, DB, &k(b"new:1")).await.unwrap(), k(b"Old:1"));
    assert_eq!(get(&s, DB, &k(b"new:2")).await.unwrap(), k(b"new:2"), "existing target untouched");

    let (summary, events) = run_job(&s, &s, &spec(listed(&[k(b"x"), k(b"xx")]), rename_action("x", "xx", false, true, true), true)).await;
    assert_eq!(summary.unwrap().skipped, 1);
    assert_eq!(sample_notes(&events)[&k(b"x")].1, "exists", "target is itself being renamed");

    let (summary, _) = run_job(&s, &s, &spec(listed(&[k(b"old:2")]), rename_action("old", "new", false, true, true), false)).await;
    assert_eq!(summary.unwrap().succeeded, 1);
    assert_eq!(get(&s, DB, &k(b"new:2")).await.unwrap(), k(b"old:2"), "overwrite replaced the target");

    set_strings(&s, DB, &[k("İSTANBUL:1".as_bytes())]).await;
    let turkish = rename_action("istanbul", "ankara", false, false, false);
    let (summary, _) = run_job(&s, &s, &spec(listed(&[k("İSTANBUL:1".as_bytes())]), turkish, false)).await;
    assert_eq!(summary.unwrap().succeeded, 1);
    assert!(exists(&s, DB, &k(b"ankara:1")).await);
    let regex = rename_action(r"^ops:test:rn2:(\w+):(\d+)$", "ops:test:rn2:$2:${1}", true, true, false);
    let (summary, _) = run_job(&s, &s, &spec(listed(&[k(b"ankara:1")]), regex, false)).await;
    assert_eq!(summary.unwrap().succeeded, 1);
    assert!(exists(&s, DB, &k(b"1:ankara")).await);
    purge(&s, DB, p).await;
}

#[tokio::test(flavor = "multi_thread")]
#[ignore]
async fn cluster_rename_across_slots_keeps_ttl() {
    let s = open(cluster_config()).await;
    purge(&s, 0, "ops:test:crn").await;
    purge(&s, 0, "{ops:test:tag}").await;
    let keys = names("ops:test:crn:", 60);
    set_strings(&s, 0, &keys).await;
    cmd(&s, 0, &keys[0], &[b"PEXPIRE", &keys[0], b"600000"]).await;
    let tagged = vec![b"{ops:test:tag}:a".to_vec()];
    set_strings(&s, 0, &tagged).await;
    let job = BulkSpec { db: 0, ..spec(prefix("ops:test:crn:"), rename_action("crn:", "crn2:", false, true, false), false) };
    let (summary, _) = run_job(&s, &s, &job).await;
    let summary = summary.unwrap();
    assert_eq!((summary.succeeded, summary.failed), (60, 0));
    assert!(keys_with_prefix(&s, 0, "ops:test:crn:").await.is_empty());
    assert_eq!(keys_with_prefix(&s, 0, "ops:test:crn2:").await.len(), 60);
    assert_eq!(get(&s, 0, b"ops:test:crn2:5").await.unwrap(), b"ops:test:crn:5");
    assert!(pttl(&s, 0, b"ops:test:crn2:0").await > 500_000);

    let job = BulkSpec { db: 0, ..spec(listed(&tagged), rename_action(":a", ":b", false, true, false), false) };
    assert_eq!(run_job(&s, &s, &job).await.0.unwrap().succeeded, 1);
    assert!(exists(&s, 0, b"{ops:test:tag}:b").await);
    purge(&s, 0, "ops:test:crn").await;
    purge(&s, 0, "{ops:test:tag}").await;
}

fn copy_action(target: &str, target_db: u32, replace: bool, move_keys: bool) -> BulkAction {
    BulkAction::Copy { target_connection_id: target.into(), target_db, replace, move_keys }
}

#[tokio::test(flavor = "multi_thread")]
#[ignore]
async fn copy_and_move_between_dbs_and_connections() {
    let s = open(config(6390)).await;
    let cluster = open(cluster_config()).await;
    let p = "ops:test:cp:";
    purge(&s, DB, p).await;
    purge(&s, TARGET_DB, p).await;
    purge(&cluster, 0, p).await;
    let keys = names(p, 3);
    set_strings(&s, DB, &keys).await;
    cmd(&s, DB, &keys[0], &[b"PEXPIRE", &keys[0], b"600000"]).await;
    cmd(&s, TARGET_DB, &keys[2], &[b"SET", &keys[2], b"kept"]).await;

    let (summary, events) = run_job(&s, &s, &spec(prefix(p), copy_action("", TARGET_DB, false, false), true)).await;
    assert_eq!(summary.unwrap().skipped, 1);
    assert_eq!(sample_notes(&events)[&keys[2]], (Some(keys[2].clone()), "exists".into()));

    let (summary, _) = run_job(&s, &s, &spec(prefix(p), copy_action("", TARGET_DB, false, false), false)).await;
    let summary = summary.unwrap();
    assert_eq!((summary.succeeded, summary.skipped, summary.failed), (2, 1, 0));
    assert_eq!(get(&s, TARGET_DB, &keys[2]).await.unwrap(), b"kept");
    assert!(pttl(&s, TARGET_DB, &keys[0]).await > 500_000, "TTL copied");

    let (summary, _) = run_job(&s, &s, &spec(prefix(p), copy_action("source", TARGET_DB, true, true), false)).await;
    assert_eq!(summary.unwrap().succeeded, 3);
    assert!(keys_with_prefix(&s, DB, p).await.is_empty(), "moved");
    assert_eq!(get(&s, TARGET_DB, &keys[2]).await.unwrap(), keys[2], "replaced");

    let same_db = run_job(&s, &s, &spec(prefix(p), copy_action("", DB, false, false), false)).await.0;
    assert_eq!(same_db.unwrap_err().kind, ErrorKind::Invalid);
    let cluster_db = run_job(&s, &cluster, &spec(prefix(p), copy_action("cluster", 1, false, false), false)).await.0;
    assert_eq!(cluster_db.unwrap_err().kind, ErrorKind::Invalid);

    let to_cluster = BulkSpec { db: TARGET_DB, ..spec(prefix(p), copy_action("cluster", 0, false, false), false) };
    let (summary, _) = run_job(&s, &cluster, &to_cluster).await;
    assert_eq!(summary.unwrap().succeeded, 3);
    assert_eq!(keys_with_prefix(&cluster, 0, p).await.len(), 3);
    assert!(pttl(&cluster, 0, &keys[0]).await > 500_000);

    let back = BulkSpec { db: 0, connection_id: "cluster".into(), ..spec(prefix(p), copy_action("standalone", DB, false, true), false) };
    let (summary, _) = run_job(&cluster, &s, &back).await;
    assert_eq!(summary.unwrap().succeeded, 3);
    assert!(keys_with_prefix(&cluster, 0, p).await.is_empty());
    assert_eq!(keys_with_prefix(&s, DB, p).await.len(), 3);
    let same_cluster = BulkSpec { db: 0, ..spec(prefix(p), copy_action("", 1, false, false), false) };
    assert_eq!(run_job(&cluster, &cluster, &same_cluster).await.0.unwrap_err().kind, ErrorKind::Invalid);
    purge(&s, DB, p).await;
    purge(&s, TARGET_DB, p).await;
}

async fn seed_every_type(s: &Session, db: u32, p: &str) -> Vec<Vec<u8>> {
    let k = |suffix: &[u8]| [p.as_bytes(), suffix].concat();
    let binary_key = k(b"bin:\xff\x00");
    cmd(s, db, &k(b"str"), &[b"SET", &k(b"str"), "değer".as_bytes()]).await;
    cmd(s, db, &binary_key, &[b"SET", &binary_key, b"\x00\xff\xfe"]).await;
    cmd(s, db, &k(b"ttl"), &[b"SET", &k(b"ttl"), b"x", b"PX", b"600000"]).await;
    cmd(s, db, &k(b"hash"), &[b"HSET", &k(b"hash"), b"f1", b"v1", b"\xfff", b"\x00v", "alan".as_bytes(), "şık".as_bytes()]).await;
    cmd(s, db, &k(b"list"), &[b"RPUSH", &k(b"list"), b"a", b"b", b"a", b"\xff"]).await;
    cmd(s, db, &k(b"set"), &[b"SADD", &k(b"set"), b"x", b"y", b"\x00"]).await;
    cmd(s, db, &k(b"zset"), &[b"ZADD", &k(b"zset"), b"1.5", b"m1", b"-inf", b"m2", b"+inf", b"m3", b"0.1", b"m4"]).await;
    cmd(s, db, &k(b"stream"), &[b"XADD", &k(b"stream"), b"1-1", b"f", b"v", b"g", b"\xff"]).await;
    cmd(s, db, &k(b"stream"), &[b"XADD", &k(b"stream"), b"2-0", b"f", b"w"]).await;
    ["str", "ttl", "hash", "list", "set", "zset", "stream"].iter().map(|n| k(n.as_bytes())).chain([binary_key]).collect()
}

/// Tip + sıralanmış değer; TTL'nin varlığı
async fn snapshot(s: &Session, db: u32, key: &[u8]) -> (String, Vec<Vec<u8>>, bool) {
    let key_type: String = s.query_key(db, key, &key_cmd("TYPE", key)).await.unwrap();
    let read: &[&[u8]] = match key_type.as_str() {
        "string" => &[b"GET"],
        "hash" => &[b"HGETALL"],
        "list" => &[b"LRANGE", b"0", b"-1"],
        "set" => &[b"SMEMBERS"],
        "zset" => &[b"ZRANGE", b"0", b"-1", b"WITHSCORES"],
        "stream" => &[b"XRANGE", b"-", b"+"],
        other => panic!("unexpected type {other}"),
    };
    let mut parts = vec![read[0], key];
    parts.extend_from_slice(&read[1..]);
    let mut values = Vec::new();
    flatten(cmd(s, db, key, &parts).await, &mut values);
    if key_type == "hash" {
        let mut pairs: Vec<Vec<u8>> = values.chunks(2).map(|p| p.concat()).collect();
        pairs.sort();
        values = pairs;
    } else if key_type == "set" {
        values.sort();
    }
    (key_type, values, pttl(s, db, key).await > 0)
}

fn flatten(value: redis::Value, out: &mut Vec<Vec<u8>>) {
    match value {
        redis::Value::Array(items) => items.into_iter().for_each(|v| flatten(v, out)),
        other => out.push(bytes_of(other).unwrap_or_default()),
    }
}

async fn import(s: &Session, db: u32, path: &str, replace: bool) -> BulkSummary {
    let token = CancellationToken::new();
    import_file(s, db, path, replace, &token, &|_| {}).await.unwrap()
}

#[tokio::test(flavor = "multi_thread")]
#[ignore]
async fn export_import_round_trip_every_type() {
    let s = open(config(6390)).await;
    let p = "ops:test:ex:";
    purge(&s, DB, p).await;
    purge(&s, TARGET_DB, p).await;
    let keys = seed_every_type(&s, DB, p).await;
    let mut originals = Vec::new();
    for key in &keys {
        originals.push(snapshot(&s, DB, key).await);
    }
    let dir = std::env::temp_dir().join(format!("atak-rdm-export-{}", uuid::Uuid::new_v4()));
    std::fs::create_dir_all(&dir).unwrap();
    for format in [ExportFormat::Dump, ExportFormat::Json] {
        let path = dir.join(format!("export-{format:?}")).to_string_lossy().into_owned();
        let dry = spec(prefix(p), BulkAction::Export { path: path.clone(), format }, true);
        let (summary, _) = run_job(&s, &s, &dry).await;
        assert_eq!((summary.unwrap().output_path.as_str(), std::path::Path::new(&path).exists()), ("", false));

        let export = spec(prefix(p), BulkAction::Export { path: path.clone(), format }, false);
        let (summary, events) = run_job(&s, &s, &export).await;
        let summary = summary.unwrap();
        assert_eq!((summary.succeeded, summary.failed, summary.output_path.as_str()), (keys.len() as u64, 0, path.as_str()));
        assert_done_last(&events, &summary);
        if format == ExportFormat::Json {
            let parsed: serde_json::Value = serde_json::from_str(&std::fs::read_to_string(&path).unwrap()).unwrap();
            assert_eq!(parsed.as_array().unwrap().len(), keys.len());
        }

        let summary = import(&s, TARGET_DB, &path, false).await;
        assert_eq!((summary.succeeded, summary.failed), (keys.len() as u64, 0), "{format:?}");
        for (key, original) in keys.iter().zip(&originals) {
            assert_eq!(&snapshot(&s, TARGET_DB, key).await, original, "{format:?} {}", String::from_utf8_lossy(key));
        }
        let summary = import(&s, TARGET_DB, &path, false).await;
        assert_eq!((summary.succeeded, summary.skipped), (0, keys.len() as u64), "existing keys are skipped");
        cmd(&s, TARGET_DB, &keys[0], &[b"SET", &keys[0], b"changed"]).await;
        let summary = import(&s, TARGET_DB, &path, true).await;
        assert_eq!(summary.succeeded, keys.len() as u64);
        assert_eq!(snapshot(&s, TARGET_DB, &keys[0]).await, originals[0], "replace restored the value");
        purge(&s, TARGET_DB, p).await;
    }
    std::fs::remove_dir_all(&dir).unwrap();
    purge(&s, DB, p).await;
}

#[tokio::test(flavor = "multi_thread")]
#[ignore]
async fn cancellation_returns_a_cancelled_summary() {
    let s = open(config(6390)).await;
    let p = "ops:test:cancel:";
    purge(&s, DB, p).await;
    let keys = names(p, 2000);
    set_strings(&s, DB, &keys).await;

    let token = CancellationToken::new();
    token.cancel();
    for source in [listed(&keys), prefix(p)] {
        let (summary, events) = run_with(&s, &s, &spec(source, BulkAction::Delete, false), &token, false).await;
        let summary = summary.unwrap();
        assert!(summary.cancelled && summary.succeeded == 0);
        assert!(matches!(events.last(), Some(BulkEvent::Done { .. })));
    }

    let token = CancellationToken::new();
    let (summary, _) = run_with(&s, &s, &spec(listed(&keys), BulkAction::Delete, false), &token, true).await;
    let summary = summary.unwrap();
    assert!(summary.cancelled);
    assert_eq!(summary.succeeded, CHUNK as u64, "stops after the chunk in flight");
    assert_eq!(keys_with_prefix(&s, DB, p).await.len(), 2000 - CHUNK);
    purge(&s, DB, p).await;
}

#[tokio::test(flavor = "multi_thread")]
#[ignore]
async fn read_only_connection_allows_only_reads() {
    let s = open(crate::model::ConnectionConfig { read_only: true, ..config(6390) }).await;
    let job = |action, dry_run| spec(listed(&[b"ops:test:ro".to_vec()]), action, dry_run);
    assert_eq!(run_job(&s, &s, &job(BulkAction::Delete, false)).await.0.unwrap_err().kind, ErrorKind::ReadOnly);
    assert!(run_job(&s, &s, &job(BulkAction::Delete, true)).await.0.is_ok());
    let writable = open(config(6390)).await;
    let copy = job(copy_action("other", TARGET_DB, false, false), false);
    assert!(run_job(&s, &writable, &copy).await.0.is_ok(), "copying out of a read-only connection is a read");
    let moving = job(copy_action("other", TARGET_DB, false, true), false);
    assert_eq!(run_job(&s, &writable, &moving).await.0.unwrap_err().kind, ErrorKind::ReadOnly);
    let token = CancellationToken::new();
    let err = import_file(&s, DB, "unused", false, &token, &|_| {}).await.unwrap_err();
    assert_eq!(err.kind, ErrorKind::ReadOnly);
}
