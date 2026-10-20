//! Yerel, geçici Redis örneklerine karşı entegrasyon testleri (`scripts/dev-redis.sh start`).
//! Çalıştırma: `cargo test -- --ignored --test-threads=1`

use super::*;
use crate::bytes::RBytes;
use crate::console;
use crate::model::{HashEntry, KeyFilter, NewKey, RValue, SearchMode, SshAuth};
use std::collections::HashSet;
use tokio_util::sync::CancellationToken;

const DB: u32 = 15;

fn dev_file(name: &str) -> String {
    format!("{}/target/dev-redis/{name}", env!("CARGO_MANIFEST_DIR"))
}

fn config(port: u16) -> ConnectionConfig {
    ConnectionConfig { id: format!("test-{port}"), host: "127.0.0.1".into(), port, timeout_sec: 5, ..Default::default() }
}

fn cluster_config() -> ConnectionConfig {
    ConnectionConfig { mode: ConnectionMode::Cluster, ..config(7101) }
}

fn with_ssh(mut config: ConnectionConfig, auth: SshAuth) -> ConnectionConfig {
    config.ssh.enabled = true;
    config.ssh.host = "127.0.0.1".into();
    config.ssh.port = 2222;
    config.ssh.username = "ardmtest".into();
    config.ssh.auth = auth;
    config.ssh.timeout_sec = 10;
    match auth {
        SshAuth::Password => config.ssh.password = "ardmtest".into(),
        SshAuth::PrivateKey => config.ssh.private_key_path = dev_file("id_ed25519"),
        SshAuth::Agent => {}
    }
    config
}

async fn open(config: ConnectionConfig) -> Arc<Session> {
    SessionManager::default().connect_once(&config).await.unwrap()
}

async fn fresh_db(session: &Session) {
    session.query_node::<Value>("", DB, &redis::cmd("FLUSHDB")).await.unwrap();
}

fn filter_all() -> KeyFilter {
    KeyFilter::default()
}

fn rb(text: &str) -> RBytes {
    RBytes::from(text)
}

#[tokio::test(flavor = "multi_thread")]
#[ignore]
async fn standalone_crud_for_every_type() {
    let s = open(config(6390)).await;
    fresh_db(&s).await;
    let info = s.info();
    assert_eq!(info.db_count, 16);
    assert!(s.version_at_least(6, 0));
    let test = s.test().await.unwrap();
    assert_eq!((test.redis_mode.as_str(), test.role.as_str()), ("standalone", "master"));

    // string
    let new = |key: &str, key_type: &str| NewKey { key: rb(key), key_type: key_type.into(), ..Default::default() };
    s.key_create(DB, NewKey { value: rb("v1"), ttl_ms: 60_000, ..new("s", "string") }).await.unwrap();
    assert_eq!(s.key_create(DB, new("s", "string")).await.unwrap_err().kind, ErrorKind::Exists);
    s.string_set(DB, b"s", b"v2").await.unwrap();
    let value = s.string_get(DB, b"s").await.unwrap();
    assert_eq!((value.value, value.size), (rb("v2"), 2));
    let info = s.key_info(DB, b"s").await.unwrap();
    assert!(info.ttl > 0 && info.ttl <= 60_000, "KEEPTTL kept the ttl");
    assert_eq!((info.key_type.as_str(), info.length), ("string", 2));
    assert!(info.memory.is_some());

    // hash
    s.key_create(DB, NewKey { field: rb("f1"), value: rb("a"), ..new("h", "hash") }).await.unwrap();
    s.hash_set(DB, b"h", b"f2", b"b", None).await.unwrap();
    s.hash_set(DB, b"h", b"f3", b"c", Some(b"f2")).await.unwrap();
    let page = s.hash_scan(DB, b"h", "", &filter_all(), 100).await.unwrap();
    assert_eq!((page.cursor.as_str(), page.total), ("", 2));
    let mut fields: Vec<_> = page.items.iter().map(|e| e.field.clone()).collect();
    fields.sort();
    assert_eq!(fields, [rb("f1"), rb("f3")]);
    let filtered = s
        .hash_scan(DB, b"h", "", &KeyFilter { mode: SearchMode::Prefix, term: "F3".into(), ..Default::default() }, 100)
        .await
        .unwrap();
    assert_eq!(filtered.items.len(), 1);
    assert_eq!(s.hash_delete(DB, b"h", &[rb("f1")]).await.unwrap(), 1);

    // list
    s.key_create(DB, NewKey { value: rb("a"), ..new("l", "list") }).await.unwrap();
    assert_eq!(s.list_push(DB, b"l", &[rb("b"), rb("c"), rb("d")], true).await.unwrap(), 4);
    s.list_set(DB, b"l", 1, b"B").await.unwrap();
    assert_eq!(s.list_delete(DB, b"l", &[0, 2]).await.unwrap(), 2);
    let page = s.list_range(DB, b"l", 0, 10).await.unwrap();
    assert_eq!((page.total, page.items), (2, vec![rb("B"), rb("d")]));

    // set
    s.key_create(DB, NewKey { value: rb("m1"), ..new("st", "set") }).await.unwrap();
    assert_eq!(s.set_add(DB, b"st", &[rb("m2"), rb("m3")]).await.unwrap(), 2);
    s.set_replace(DB, b"st", b"m3", b"m4").await.unwrap();
    assert_eq!(s.set_delete(DB, b"st", &[rb("m1")]).await.unwrap(), 1);
    let mut members = s.set_scan(DB, b"st", "", &filter_all(), 10).await.unwrap().items;
    members.sort();
    assert_eq!(members, [rb("m2"), rb("m4")]);

    // zset
    s.key_create(DB, NewKey { value: rb("z1"), score: 1.0, ..new("z", "zset") }).await.unwrap();
    s.zset_add(DB, b"z", b"z2", 2.5, None).await.unwrap();
    s.zset_add(DB, b"z", b"z3", 3.0, Some(b"z1")).await.unwrap();
    let page = s.zset_range(DB, b"z", 0, 10, true).await.unwrap();
    assert_eq!(page.total, 2);
    assert_eq!((page.items[0].member.clone(), page.items[0].score), (rb("z3"), 3.0));
    let scanned = s.zset_scan(DB, b"z", "", &KeyFilter { term: "2".into(), ..Default::default() }, 10).await.unwrap();
    assert_eq!(scanned.items.len(), 1);
    assert_eq!(scanned.items[0].score, 2.5);
    assert_eq!(s.zset_delete(DB, b"z", &[rb("z2")]).await.unwrap(), 1);

    // stream
    let entry = |f: &str, v: &str| HashEntry { field: rb(f), value: rb(v) };
    s.key_create(DB, NewKey { entries: vec![entry("a", "1")], stream_id: "1-1".into(), ..new("x", "stream") }).await.unwrap();
    let id = s.stream_add(DB, b"x", "", &[entry("b", "2"), entry("c", "3")]).await.unwrap();
    let page = s.stream_range(DB, b"x", "", "", 10, true).await.unwrap();
    assert_eq!(page.total, 2);
    assert_eq!(page.items[0].id, id);
    assert_eq!(page.items[0].fields.len(), 2);
    s.query_key::<Value>(DB, b"x", redis::cmd("XGROUP").arg("CREATE").arg("x").arg("g1").arg("0")).await.unwrap();
    let groups = s.stream_groups(DB, b"x").await.unwrap();
    assert_eq!((groups[0].name.as_str(), groups[0].last_delivered_id.as_str()), ("g1", "0-0"));
    assert_eq!(s.stream_delete(DB, b"x", &["1-1".into()]).await.unwrap(), 1);

    // meta, rename, expire, delete
    let metas = s.keys_meta(DB, vec![rb("s"), rb("h"), rb("missing")]).await.unwrap();
    assert_eq!(metas.iter().map(|m| m.key_type.as_str()).collect::<Vec<_>>(), ["string", "hash", "none"]);
    assert_eq!(metas[2].ttl, -2);
    assert_eq!(s.key_rename(DB, b"h", b"s", false).await.unwrap_err().kind, ErrorKind::Exists);
    s.key_rename(DB, b"h", b"h2", false).await.unwrap();
    s.key_expire(DB, b"h2", 5_000).await.unwrap();
    assert!(s.key_info(DB, b"h2").await.unwrap().ttl > 0);
    s.key_expire(DB, b"h2", 0).await.unwrap();
    assert_eq!(s.key_info(DB, b"h2").await.unwrap().ttl, -1);
    assert_eq!(s.key_expire(DB, b"missing", 5_000).await.unwrap_err().kind, ErrorKind::NotFound);
    let dbs = s.db_list().await.unwrap();
    assert_eq!((dbs.len(), dbs[DB as usize].keys), (16, 6));
    assert_eq!(s.key_delete(DB, vec![rb("s"), rb("h2"), rb("missing")]).await.unwrap(), 2);
    assert_eq!(s.key_info(DB, b"s").await.unwrap_err().kind, ErrorKind::NotFound);
    dispose(s).await;
}

#[tokio::test(flavor = "multi_thread")]
#[ignore]
async fn legacy_paths_without_keepttl_and_unlink() {
    let mut s = open(config(6390)).await;
    Arc::get_mut(&mut s).unwrap().version = (3, 2, 0);
    fresh_db(&s).await;
    s.query_key::<Value>(DB, b"old", redis::cmd("SET").arg("old").arg("1").arg("PX").arg(60_000)).await.unwrap();
    s.string_set(DB, b"old", b"2").await.unwrap();
    assert!(s.key_info(DB, b"old").await.unwrap().ttl > 0);
    assert_eq!(s.key_delete(DB, vec![rb("old")]).await.unwrap(), 1);
}

#[tokio::test(flavor = "multi_thread")]
#[ignore]
async fn key_copy_keeps_ttl_and_respects_existing_target() {
    let s = open(config(6390)).await;
    fresh_db(&s).await;
    s.query_key::<Value>(DB, b"src", redis::cmd("SET").arg("src").arg("v").arg("PX").arg(60_000)).await.unwrap();
    s.key_copy(DB, b"src", b"dst", false).await.unwrap();
    assert_eq!(s.string_get(DB, b"dst").await.unwrap().value, rb("v"));
    assert!(s.key_info(DB, b"dst").await.unwrap().ttl > 0);
    assert_eq!(s.key_copy(DB, b"src", b"dst", false).await.unwrap_err().kind, ErrorKind::Exists);
    s.string_set(DB, b"src", b"w").await.unwrap();
    s.key_copy(DB, b"src", b"dst", true).await.unwrap();
    assert_eq!(s.string_get(DB, b"dst").await.unwrap().value, rb("w"));
    assert_eq!(s.key_copy(DB, b"missing", b"x", false).await.unwrap_err().kind, ErrorKind::NotFound);
    dispose(s).await;

    let c = open(cluster_config()).await;
    c.key_delete(0, vec![rb("copy:a"), rb("copy:b")]).await.unwrap();
    c.query_key::<Value>(0, b"copy:a", redis::cmd("SET").arg("copy:a").arg("1")).await.unwrap();
    assert_ne!(key_slot(b"copy:a"), key_slot(b"copy:b"));
    c.key_copy(0, b"copy:a", b"copy:b", false).await.unwrap();
    assert_eq!(c.string_get(0, b"copy:b").await.unwrap().value, rb("1"));
    c.key_delete(0, vec![rb("copy:a"), rb("copy:b")]).await.unwrap();
    dispose(c).await;
}

#[tokio::test(flavor = "multi_thread")]
#[ignore]
async fn binary_keys_and_values_round_trip() {
    let s = open(config(6390)).await;
    fresh_db(&s).await;
    let key = RBytes(vec![0xff, 0x00, b'k']);
    let value = RBytes(vec![0x00, 0xfe, 0x80]);
    s.key_create(DB, NewKey { key: key.clone(), value: value.clone(), ..Default::default() }).await.unwrap();
    assert_eq!(s.string_get(DB, key.as_slice()).await.unwrap().value, value);
    let hkey = [0xc3u8, 0x28];
    s.hash_set(DB, &hkey, &[0xff], &[0x00, 0x01], None).await.unwrap();
    let page = s.hash_scan(DB, &hkey, "", &filter_all(), 10).await.unwrap();
    assert_eq!((page.items[0].field.clone(), page.items[0].value.clone()), (RBytes(vec![0xff]), RBytes(vec![0x00, 0x01])));
    let json = serde_json::to_string(&page.items[0]).unwrap();
    assert!(json.contains("$b"));
    let metas = s.keys_meta(DB, vec![key.clone(), RBytes(hkey.to_vec())]).await.unwrap();
    assert_eq!((metas[0].key_type.as_str(), metas[1].key_type.as_str()), ("string", "hash"));
    let reply = console::exec(&s, DB, r#"GET "\xff\x00k""#, "").await.unwrap();
    assert!(matches!(reply.value, RValue::Str(v) if v == value));
}

#[tokio::test(flavor = "multi_thread")]
#[ignore]
async fn read_only_connection_rejects_writes() {
    let s = open(ConnectionConfig { read_only: true, ..config(6390) }).await;
    assert!(s.info().read_only);
    let denied = |r: AppResult<()>| r.unwrap_err().kind == ErrorKind::ReadOnly;
    assert!(denied(s.key_create(DB, NewKey { key: rb("ro"), ..Default::default() }).await));
    assert!(denied(s.string_set(DB, b"ro", b"x").await));
    assert!(denied(s.key_expire(DB, b"ro", 0).await));
    assert!(denied(s.server_config_set("", "maxmemory", "0").await));
    assert_eq!(console::exec(&s, DB, "SET ro x", "").await.unwrap_err().kind, ErrorKind::ReadOnly);
    assert_eq!(console::exec(&s, DB, "config set maxmemory 0", "").await.unwrap_err().kind, ErrorKind::ReadOnly);
    assert_eq!(console::exec(&s, DB, "EVAL \"return 1\" 0", "").await.unwrap_err().kind, ErrorKind::ReadOnly);
    assert!(matches!(console::exec(&s, DB, "GET ro", "").await.unwrap().value, RValue::Nil));
    assert!(matches!(console::exec(&s, DB, "CONFIG GET maxmemory", "").await.unwrap().value, RValue::Arr(_)));
}

#[tokio::test(flavor = "multi_thread")]
#[ignore]
async fn console_select_errors_and_transactions() {
    let s = open(config(6390)).await;
    fresh_db(&s).await;
    let selected = console::exec(&s, 0, "select 15", "").await.unwrap();
    assert_eq!(selected.db, DB);
    let out_of_range = console::exec(&s, 0, "SELECT 99", "").await.unwrap();
    assert!(matches!(out_of_range.value, RValue::Err(_)) && out_of_range.db == 0);

    assert!(matches!(console::exec(&s, DB, r#"SET c "a b""#, "").await.unwrap().value, RValue::Status(ref ok) if ok == "OK"));
    assert!(matches!(console::exec(&s, DB, "GET c", "").await.unwrap().value, RValue::Str(v) if v == rb("a b")));
    assert!(matches!(console::exec(&s, DB, "HGET c f", "").await.unwrap().value, RValue::Err(e) if e.starts_with("WRONGTYPE")));
    assert!(matches!(console::exec(&s, DB, "NOSUCHCMD", "").await.unwrap().value, RValue::Err(e) if e.starts_with("ERR")));
    assert_eq!(console::exec(&s, DB, "SUBSCRIBE ch", "").await.unwrap_err().kind, ErrorKind::Invalid);
    assert_eq!(console::exec(&s, DB, r#"GET "unbalanced"#, "").await.unwrap_err().kind, ErrorKind::Invalid);

    // MULTI konsol şeridinde kalır; ana şerit etkilenmez
    console::exec(&s, DB, "MULTI", "").await.unwrap();
    assert!(matches!(console::exec(&s, DB, "INCR n", "").await.unwrap().value, RValue::Status(q) if q == "QUEUED"));
    assert_eq!(s.query_key::<Option<i64>>(DB, b"n", redis::cmd("GET").arg("n")).await.unwrap(), None);
    let exec = console::exec(&s, DB, "EXEC", "").await.unwrap();
    assert!(matches!(exec.value, RValue::Arr(ref items) if matches!(items[0], RValue::Int(1))));
}

#[tokio::test(flavor = "multi_thread")]
#[ignore]
async fn acl_and_password_auth() {
    let mut cfg = config(6391);
    assert_eq!(SessionManager::default().connect_once(&cfg).await.err().unwrap().kind, ErrorKind::Auth);
    cfg.password = "wrong".into();
    assert_eq!(SessionManager::default().connect_once(&cfg).await.err().unwrap().kind, ErrorKind::Auth);
    cfg.password = "testpass".into();
    let s = open(cfg.clone()).await;
    assert_eq!(s.test().await.unwrap().role, "master");
    cfg.username = "tester".into();
    cfg.password = "testpass2".into();
    let s = open(cfg).await;
    let whoami: String = s.query_node("", 0, redis::cmd("ACL").arg("WHOAMI")).await.unwrap();
    assert_eq!(whoami, "tester");
}

#[tokio::test(flavor = "multi_thread")]
#[ignore]
async fn tls_with_ca_client_cert_and_skip_verify() {
    let mut cfg = config(6392);
    cfg.tls.enabled = true;
    cfg.tls.ca_path = dev_file("ca.crt");
    let s = open(cfg.clone()).await;
    assert!(s.query_node::<String>("", 0, &redis::cmd("PING")).await.is_ok());

    cfg.tls.server_name = "localhost".into();
    cfg.tls.cert_path = dev_file("client.crt");
    cfg.tls.key_path = dev_file("client.key");
    open(cfg.clone()).await;

    cfg.tls.server_name = "wrong.example".into();
    assert_eq!(SessionManager::default().connect_once(&cfg).await.err().unwrap().kind, ErrorKind::Tls);
    cfg.tls.skip_verify = true;
    cfg.tls.ca_path.clear();
    open(cfg).await;
}

#[tokio::test(flavor = "multi_thread")]
#[ignore]
async fn cluster_routing_pipelines_and_redirects() {
    let s = open(cluster_config()).await;
    let info = s.info();
    assert_eq!((info.db_count, info.nodes.iter().filter(|n| n.role == "master").count()), (1, 3));
    let masters = s.scan_nodes().await.unwrap();
    assert_eq!(masters.len(), 3);

    let keys: Vec<Vec<u8>> = (0..30).map(|i| format!("ardm:cl:{i}").into_bytes()).collect();
    let owners: HashSet<_> = keys.iter().map(|k| s.node_for(&Route::Key(k))).collect();
    assert_eq!(owners.len(), 3, "keys spread over all masters");
    let sets = keys.iter().map(|k| (k.clone(), redis::cmd("SET").arg(k).arg(k).clone())).collect();
    assert!(s.pipeline_keys(0, sets).await.unwrap().iter().all(|r| r.is_ok()));
    let gets = keys.iter().map(|k| (k.clone(), redis::cmd("GET").arg(k).clone())).collect();
    let values = s.pipeline_keys(0, gets).await.unwrap();
    for (key, value) in keys.iter().zip(values) {
        assert_eq!(value.unwrap(), Value::BulkString(key.clone()));
    }

    // yanlış slot sahibi → MOVED izlenir ve tablo düzelir
    let key = b"ardm:cl:0";
    let slot = key_slot(key);
    let owner = s.node_for(&Route::Key(key));
    let wrong = masters.iter().find(|m| **m != owner).unwrap().clone();
    s.slots.as_ref().unwrap().write().unwrap().set_owner(slot, wrong.clone());
    *s.last_slots_refresh.lock().await = None;
    let value: Vec<u8> = s.query_key(0, key, redis::cmd("GET").arg(key)).await.unwrap();
    assert_eq!(value, key);
    assert_eq!(s.node_for(&Route::Key(key)), owner);
    s.slots.as_ref().unwrap().write().unwrap().set_owner(slot, wrong);
    let meta = s.keys_meta(0, vec![RBytes(key.to_vec())]).await.unwrap();
    assert_eq!(meta[0].key_type, "string");

    // farklı slotlara yeniden adlandırma ve atomik işlem
    s.key_rename(0, b"ardm:cl:1", b"ardm:cl:renamed", false).await.unwrap();
    assert_eq!(s.string_get(0, b"ardm:cl:renamed").await.unwrap().value, rb("ardm:cl:1"));
    s.hash_set(0, b"ardm:cl:h", b"a", b"1", None).await.unwrap();
    s.hash_set(0, b"ardm:cl:h", b"b", b"2", Some(b"a")).await.unwrap();
    assert_eq!(s.hash_scan(0, b"ardm:cl:h", "", &filter_all(), 10).await.unwrap().total, 1);

    // konsol: otomatik yönlendirme, açık düğümde MOVED görünür
    let reply = console::exec(&s, 0, "GET ardm:cl:2", "").await.unwrap();
    assert!(matches!(reply.value, RValue::Str(v) if v == rb("ardm:cl:2")));
    let other = masters.iter().find(|m| **m != s.node_for(&Route::Key(b"ardm:cl:2"))).unwrap();
    let reply = console::exec(&s, 0, "GET ardm:cl:2", &other.to_string()).await.unwrap();
    assert!(matches!(reply.value, RValue::Err(e) if e.starts_with("MOVED")));
    assert!(matches!(console::exec(&s, 0, "SELECT 1", "").await.unwrap().value, RValue::Err(_)));

    let dbs = s.db_list().await.unwrap();
    assert_eq!(dbs.len(), 1);
    assert!(dbs[0].keys >= 31);

    let deletes: Vec<RBytes> = keys.iter().map(|k| RBytes(k.clone())).chain([rb("ardm:cl:renamed"), rb("ardm:cl:h")]).collect();
    assert_eq!(s.key_delete(0, deletes).await.unwrap(), 31);
}

#[tokio::test(flavor = "multi_thread")]
#[ignore]
async fn cluster_follows_ask_during_migration() {
    let s = open(cluster_config()).await;
    let key = b"ardm:ask";
    let slot = key_slot(key);
    let source = s.node_for(&Route::Key(key));
    let target = s.scan_nodes().await.unwrap().into_iter().find(|m| *m != source).unwrap();
    let id = |node: &NodeAddr| {
        let node = node.to_string();
        let s = s.clone();
        async move { s.query_node::<String>(&node, 0, redis::cmd("CLUSTER").arg("MYID")).await.unwrap() }
    };
    let (source_id, target_id) = (id(&source).await, id(&target).await);
    let setslot = |node: &NodeAddr, state: &str, other: Option<&str>| {
        let mut c = redis::cmd("CLUSTER");
        c.arg("SETSLOT").arg(slot).arg(state);
        if let Some(other) = other {
            c.arg(other);
        }
        let (node, s) = (node.to_string(), s.clone());
        async move { s.query_node::<Value>(&node, 0, &c).await.unwrap() }
    };
    setslot(&target, "IMPORTING", Some(&source_id)).await;
    setslot(&source, "MIGRATING", Some(&target_id)).await;

    let result = s.query_key::<Value>(0, key, redis::cmd("SET").arg(key).arg("v")).await;
    let read = s.query_key::<Option<String>>(0, key, redis::cmd("GET").arg(key)).await;
    let cleanup = s.query_key::<i64>(0, key, redis::cmd("DEL").arg(key)).await;

    setslot(&target, "STABLE", None).await;
    setslot(&source, "STABLE", None).await;
    result.unwrap();
    assert_eq!(read.unwrap().as_deref(), Some("v"));
    assert_eq!(cleanup.unwrap(), 1);
}

#[tokio::test(flavor = "multi_thread")]
#[ignore]
async fn sentinel_resolves_master() {
    let mut cfg = config(26390);
    cfg.mode = ConnectionMode::Sentinel;
    cfg.sentinel.master_name = "mymaster".into();
    let s = open(cfg.clone()).await;
    assert_eq!(s.info().nodes[0].addr, "127.0.0.1:6393");
    s.string_set(0, b"ardm:sentinel", b"ok").await.unwrap();
    assert_eq!(s.string_get(0, b"ardm:sentinel").await.unwrap().value, rb("ok"));
    s.key_delete(0, vec![rb("ardm:sentinel")]).await.unwrap();

    cfg.sentinel.master_name = "nope".into();
    assert_eq!(SessionManager::default().connect_once(&cfg).await.err().unwrap().kind, ErrorKind::NotFound);
}

#[tokio::test(flavor = "multi_thread")]
#[ignore]
async fn ssh_tunnel_with_password_and_keys() {
    let s = open(with_ssh(config(6390), SshAuth::Password)).await;
    assert_eq!(s.test().await.unwrap().redis_mode, "standalone");
    dispose(s).await;

    let s = open(with_ssh(config(6390), SshAuth::PrivateKey)).await;
    s.string_set(DB, b"ardm:ssh", b"1").await.unwrap();
    s.key_delete(DB, vec![rb("ardm:ssh")]).await.unwrap();

    let mut cfg = with_ssh(config(6390), SshAuth::PrivateKey);
    cfg.ssh.private_key_path = dev_file("id_ed25519_pass");
    assert_eq!(SessionManager::default().connect_once(&cfg).await.err().unwrap().kind, ErrorKind::Ssh);
    cfg.ssh.passphrase = "keypass".into();
    open(cfg).await;

    let mut cfg = with_ssh(config(6390), SshAuth::Password);
    cfg.ssh.password = "wrong".into();
    assert_eq!(SessionManager::default().connect_once(&cfg).await.err().unwrap().kind, ErrorKind::Ssh);

    // cluster: her düğüm aynı SSH oturumunda ayrı kanal
    let s = open(with_ssh(cluster_config(), SshAuth::Password)).await;
    let keys: Vec<Vec<u8>> = (0..12).map(|i| format!("ardm:sshc:{i}").into_bytes()).collect();
    let sets = keys.iter().map(|k| (k.clone(), redis::cmd("SET").arg(k).arg(1).clone())).collect();
    assert!(s.pipeline_keys(0, sets).await.unwrap().iter().all(|r| r.is_ok()));
    assert_eq!(s.key_delete(0, keys.into_iter().map(RBytes).collect()).await.unwrap(), 12);
}

#[tokio::test(flavor = "multi_thread")]
#[ignore]
async fn pubsub_and_monitor_stream_until_cancelled() {
    let s = open(config(6390)).await;

    let cancel = CancellationToken::new();
    let (tx, mut rx) = tokio::sync::mpsc::unbounded_channel();
    let task = tokio::spawn({
        let (s, cancel) = (s.clone(), cancel.clone());
        async move { console::subscribe(&s, &["ardm-ch".into()], &["ardm-p*".into()], cancel, |m| tx.send(m).is_ok()).await }
    });
    let mut received = Vec::new();
    for _ in 0..50 {
        s.query_node::<i64>("", 0, redis::cmd("PUBLISH").arg("ardm-pat").arg("hello")).await.unwrap();
        if let Ok(Some(message)) = tokio::time::timeout(Duration::from_millis(100), rx.recv()).await {
            received.push(message);
            break;
        }
    }
    let message = received.pop().expect("message delivered");
    assert_eq!((message.channel, message.pattern.as_str(), message.payload), (rb("ardm-pat"), "ardm-p*", rb("hello")));
    cancel.cancel();
    task.await.unwrap().unwrap();

    let cancel = CancellationToken::new();
    let (tx, mut rx) = tokio::sync::mpsc::unbounded_channel();
    let task = tokio::spawn({
        let (s, cancel) = (s.clone(), cancel.clone());
        async move { console::monitor(&s, "", cancel, |line| tx.send(line).is_ok()).await }
    });
    let mut seen = false;
    'outer: for _ in 0..50 {
        s.query_node::<Option<String>>("", 0, redis::cmd("GET").arg("ardm-monitor-probe")).await.unwrap();
        while let Ok(Some(line)) = tokio::time::timeout(Duration::from_millis(100), rx.recv()).await {
            if line.contains("ardm-monitor-probe") {
                seen = true;
                break 'outer;
            }
        }
    }
    assert!(seen);
    cancel.cancel();
    task.await.unwrap().unwrap();
}

#[tokio::test(flavor = "multi_thread")]
#[ignore]
async fn manager_opens_once_and_reconnects_after_drop() {
    let dir = std::env::temp_dir().join(format!("ardm-manager-{}", uuid::Uuid::new_v4()));
    let store = Store::without_keyring(dir.clone()).unwrap();
    let id = store.save(config(6390)).unwrap().id;
    let manager = SessionManager::default();
    let (a, b) = tokio::join!(manager.get(&store, &id), manager.get(&store, &id));
    let (a, b) = (a.unwrap(), b.unwrap());
    assert!(Arc::ptr_eq(&a, &b));

    // sunucu bağlantıyı koparır → bir kez yeniden bağlanılır
    let client_id: i64 = a.query_node("", DB, redis::cmd("CLIENT").arg("ID")).await.unwrap();
    let killer = open(config(6390)).await;
    killer.query_node::<Value>("", 0, redis::cmd("CLIENT").arg("KILL").arg("ID").arg(client_id)).await.unwrap();
    let pong: String = a.query_node("", DB, &redis::cmd("PING")).await.unwrap();
    assert_eq!(pong, "PONG");

    let reopened = manager.open(&store, &id).await.unwrap();
    assert!(!Arc::ptr_eq(&a, &reopened));
    assert_eq!(a.query_node::<String>("", DB, &redis::cmd("PING")).await.unwrap_err().kind, ErrorKind::Connection);
    manager.close(&id).await;
    std::fs::remove_dir_all(dir).unwrap();
}

#[tokio::test(flavor = "multi_thread")]
#[ignore]
async fn server_panel_commands() {
    let s = open(config(6390)).await;
    assert!(s.server_info("").await.unwrap().contains("redis_version:"));
    assert!(s.server_clients("").await.unwrap().contains("addr="));
    let items = s.server_config("", "slowlog-*").await.unwrap();
    assert!(items.windows(2).all(|w| w[0].name <= w[1].name) && items.iter().any(|i| i.name == "slowlog-log-slower-than"));
    s.server_config_set("", "slowlog-log-slower-than", "0").await.unwrap();
    s.query_node::<Option<String>>("", DB, redis::cmd("GET").arg("ardm-slow-probe")).await.unwrap();
    let entries = s.server_slowlog("", 50).await.unwrap();
    s.server_config_set("", "slowlog-log-slower-than", "10000").await.unwrap();
    assert!(entries.iter().any(|e| e.args.contains(&rb("ardm-slow-probe")) && e.timestamp > 0 && !e.client.is_empty()));
    s.server_slowlog_reset("").await.unwrap();

    let c = open(cluster_config()).await;
    let node = c.info().nodes.iter().find(|n| n.addr.ends_with(":7102")).unwrap().addr.clone();
    assert!(c.server_info(&node).await.unwrap().contains("tcp_port:7102"));
    assert!(matches!(console::exec(&c, 0, "DBSIZE", "").await.unwrap().value, RValue::Int(_)));
}
