//! ARDM (AnotherRedisDesktopManager) bağlantılarını içe aktarma: yerel Electron localStorage'ı ya da
//! "Export connections" dosyası (`base64(JSON dizisi)`). ARDM alanları gevşek okunur (sayılar metin olabilir).

mod local_storage;

use crate::error::{AppError, AppResult};
use crate::model::{ArdmScan, ConnectionConfig, ConnectionMode, ImportCandidate, ImportWarning, SshAuth};
use crate::pattern::fold_text;
use base64::engine::general_purpose::STANDARD;
use base64::Engine;
use serde_json::Value;
use std::path::{Path, PathBuf};

const APP_FOLDERS: [&str; 2] = ["another-redis-desktop-manager", "Another Redis Desktop Manager"];

/// ARDM klasörünü bulur ve bağlantılarını okur; `existing` yineleme tespiti içindir
pub fn detect(existing: &[ConnectionConfig]) -> ArdmScan {
    let Some(dir) = candidate_dirs().into_iter().find(|dir| dir.is_dir()) else {
        return ArdmScan { source: String::new(), candidates: Vec::new(), error: String::new() };
    };
    let source = dir.to_string_lossy().into_owned();
    let rank = |text: &str| serde_json::from_str(text).map_or(0, |v| connection_values(&v).len());
    let stored = local_storage::read_value(&dir, "connections", rank).and_then(|text| {
        text.map(|text| serde_json::from_str::<Value>(&text).map_err(|e| e.to_string())).transpose()
    });
    match stored {
        Ok(value) => ArdmScan {
            source,
            candidates: value.map_or_else(Vec::new, |v| candidates(&v, existing)),
            error: String::new(),
        },
        Err(error) => ArdmScan { source, candidates: Vec::new(), error },
    }
}

/// ARDM export dosyası (base64 JSON), düz JSON dizisi ya da `{anahtar: bağlantı}` haritası
pub fn read_file(path: &Path, existing: &[ConnectionConfig]) -> AppResult<Vec<ImportCandidate>> {
    let raw = std::fs::read(path)?;
    let text = String::from_utf8_lossy(&raw);
    let text = text.trim_start_matches('\u{FEFF}').trim();
    let json = if text.starts_with('[') || text.starts_with('{') {
        text.to_string()
    } else {
        let compact: String = text.chars().filter(|c| !c.is_whitespace()).collect();
        let decoded = STANDARD.decode(compact).map_err(|_| AppError::invalid("not an ARDM connections file"))?;
        String::from_utf8(decoded).map_err(|_| AppError::invalid("not an ARDM connections file"))?
    };
    let value: Value = serde_json::from_str(&json)?;
    let found = candidates(&value, existing);
    if found.is_empty() {
        return Err(AppError::invalid("the file contains no ARDM connections"));
    }
    Ok(found)
}

fn candidate_dirs() -> Vec<PathBuf> {
    let leveldb = |base: PathBuf| APP_FOLDERS.map(|app| base.join(app).join("Local Storage").join("leveldb"));
    let mut dirs = Vec::new();
    if let Some(config) = dirs::config_dir() {
        dirs.extend(leveldb(config));
    }
    if let Some(home) = dirs::home_dir() {
        let snap = home.join("snap").join("another-redis-desktop-manager").join("current").join(".config");
        dirs.extend(leveldb(snap));
        if let Ok(apps) = std::fs::read_dir(home.join(".var").join("app")) {
            for app in apps.flatten() {
                dirs.extend(leveldb(app.path().join("config")));
            }
        }
    }
    dirs
}

fn connection_values(value: &Value) -> Vec<&Value> {
    match value {
        Value::Array(items) => items.iter().filter(|v| v.is_object()).collect(),
        Value::Object(map) => map.values().filter(|v| v.is_object()).collect(),
        _ => Vec::new(),
    }
}

/// ARDM sırasıyla (`order`)
fn candidates(value: &Value, existing: &[ConnectionConfig]) -> Vec<ImportCandidate> {
    let mut found: Vec<ImportCandidate> =
        connection_values(value).into_iter().enumerate().map(|(i, raw)| map_connection(raw, i as i64)).collect();
    found.sort_by_key(|c| c.config.order);
    for candidate in &mut found {
        candidate.duplicate_of = duplicate_of(&candidate.config, existing);
    }
    found
}

fn duplicate_of(config: &ConnectionConfig, existing: &[ConnectionConfig]) -> String {
    let name = fold_text(&config.name);
    existing
        .iter()
        .find(|e| e.port == config.port && e.host.eq_ignore_ascii_case(&config.host) && fold_text(&e.name) == name)
        .map(|e| e.id.clone())
        .unwrap_or_default()
}

fn map_connection(raw: &Value, index: i64) -> ImportCandidate {
    let mut config = ConnectionConfig { imported_from: "ardm".into(), ..ConnectionConfig::default() };
    let mut warnings = Vec::new();
    if let Some(host) = text(raw, "host").filter(|h| !h.is_empty()) {
        config.host = host;
    }
    config.port = number(raw, "port").and_then(|p| u16::try_from(p).ok()).unwrap_or(config.port);
    config.name = text(raw, "name")
        .filter(|n| !n.trim().is_empty())
        .unwrap_or_else(|| format!("{}:{}", config.host, config.port));
    config.username = text(raw, "username").unwrap_or_default();
    config.password = text(raw, "auth").unwrap_or_default();
    if let Some(separator) = text(raw, "separator").filter(|s| !s.is_empty()) {
        config.separator = separator;
    }
    config.read_only = flag(raw, "connectionReadOnly");
    config.order = number(raw, "order").unwrap_or(index);
    config.db = number(raw, "db").and_then(|db| u32::try_from(db).ok()).unwrap_or(0);
    if flag(raw, "cluster") {
        config.mode = ConnectionMode::Cluster;
    }
    if let Some(sentinel) = raw.get("sentinelOptions").filter(|v| v.is_object()) {
        config.mode = ConnectionMode::Sentinel;
        config.sentinel.master_name =
            text(sentinel, "masterName").filter(|m| !m.is_empty()).unwrap_or_else(|| "mymaster".into());
        config.sentinel.sentinel_password = std::mem::take(&mut config.password);
        config.password = text(sentinel, "nodePassword").unwrap_or_default();
    }
    if let Some(ssh) = raw.get("sshOptions").filter(|v| text(v, "host").is_some_and(|h| !h.is_empty())) {
        map_ssh(&mut config, ssh, &mut warnings);
    }
    if let Some(ssl) = raw.get("sslOptions").filter(|v| v.is_object()) {
        map_tls(&mut config, ssl, &mut warnings);
    }
    ImportCandidate { config, warnings, duplicate_of: String::new() }
}

fn map_ssh(config: &mut ConnectionConfig, ssh: &Value, warnings: &mut Vec<ImportWarning>) {
    let target = &mut config.ssh;
    target.enabled = true;
    target.host = text(ssh, "host").unwrap_or_default();
    target.port = number(ssh, "port").and_then(|p| u16::try_from(p).ok()).unwrap_or(target.port);
    target.username = text(ssh, "username").unwrap_or_default();
    target.password = text(ssh, "password").unwrap_or_default();
    target.passphrase = text(ssh, "passphrase").unwrap_or_default();
    let timeout = number(ssh, "timeout").and_then(|t| u32::try_from(t).ok()).filter(|t| *t > 0);
    target.timeout_sec = timeout.unwrap_or(target.timeout_sec);
    if let Some(key) = text(ssh, "privatekey").filter(|k| !k.is_empty()) {
        target.auth = SshAuth::PrivateKey;
        warn_missing(&key, "sshKeyMissing", warnings);
        target.private_key_path = key;
    }
}

fn map_tls(config: &mut ConnectionConfig, ssl: &Value, warnings: &mut Vec<ImportWarning>) {
    let tls = &mut config.tls;
    tls.enabled = true;
    for (field, code, target) in [
        ("ca", "tlsCaMissing", &mut tls.ca_path),
        ("cert", "tlsCertMissing", &mut tls.cert_path),
        ("key", "tlsKeyMissing", &mut tls.key_path),
    ] {
        if let Some(path) = text(ssl, field).filter(|p| !p.is_empty()) {
            warn_missing(&path, code, warnings);
            *target = path;
        }
    }
    tls.server_name = text(ssl, "servername").unwrap_or_default();
}

fn warn_missing(path: &str, code: &str, warnings: &mut Vec<ImportWarning>) {
    if !Path::new(path).is_file() {
        warnings.push(ImportWarning { code: code.into(), detail: path.into() });
    }
}

fn text(raw: &Value, field: &str) -> Option<String> {
    match raw.get(field)? {
        Value::String(s) => Some(s.clone()),
        Value::Number(n) => Some(n.to_string()),
        _ => None,
    }
}

fn number(raw: &Value, field: &str) -> Option<i64> {
    match raw.get(field)? {
        Value::Number(n) => n.as_i64().or_else(|| n.as_f64().map(|f| f as i64)),
        Value::String(s) => s.trim().parse().ok(),
        _ => None,
    }
}

fn flag(raw: &Value, field: &str) -> bool {
    match raw.get(field) {
        Some(Value::Bool(b)) => *b,
        Some(Value::String(s)) => s == "true" || s == "1",
        Some(Value::Number(n)) => n.as_i64() == Some(1),
        _ => false,
    }
}

#[cfg(test)]
mod tests {
    use super::local_storage::tests::{entry_key, latin1, temp_dir, utf16, write_db};
    use super::*;
    use serde_json::json;

    fn ardm_connections() -> Value {
        json!({
            "plain": {"host": "10.0.0.1", "port": 6380, "auth": "pw", "name": "Plain", "separator": "::", "order": 3, "key": "plain"},
            "strings": {"host": "", "port": "6390", "name": "", "cluster": "true", "connectionReadOnly": true, "order": "1"},
            "turkish": {"host": "redis.local", "port": 6379, "name": "İstanbul Şube", "username": "ağ", "auth": "şifre", "order": 2},
            "ssh": {"host": "127.0.0.1", "port": 6379, "name": "Tünel", "order": 4,
                    "sshOptions": {"host": "bastion", "port": "2222", "username": "u", "password": "p",
                                   "privatekey": "/nope/id_rsa", "passphrase": "pp", "timeout": 15}},
            "ssh-empty": {"host": "h", "port": 1, "name": "no ssh host", "order": 5, "sshOptions": {"host": ""}},
            "ssl": {"host": "h", "port": 6392, "name": "TLS", "order": 6,
                    "sslOptions": {"ca": "/nope/ca.crt", "cert": "", "key": "/nope/client.key", "servername": "redis.example"}},
            "sentinel": {"host": "s", "port": 26379, "name": "Sentinel", "auth": "sentinel-pw", "order": 7, "db": 2,
                         "sentinelOptions": {"masterName": "mymaster", "nodePassword": "node-pw"}},
        })
    }

    fn by_name<'a>(found: &'a [ImportCandidate], name: &str) -> &'a ImportCandidate {
        found.iter().find(|c| c.config.name == name).unwrap_or_else(|| panic!("{name} missing"))
    }

    fn assert_mapping(found: &[ImportCandidate]) {
        assert_eq!(found.len(), 7);
        let orders: Vec<i64> = found.iter().map(|c| c.config.order).collect();
        assert_eq!(orders, [1, 2, 3, 4, 5, 6, 7]);
        assert!(found.iter().all(|c| c.config.imported_from == "ardm" && c.config.id.is_empty()));

        let plain = &by_name(found, "Plain").config;
        assert_eq!((plain.host.as_str(), plain.port, plain.password.as_str(), plain.separator.as_str()), ("10.0.0.1", 6380, "pw", "::"));
        assert_eq!(plain.mode, ConnectionMode::Standalone);

        let strings = &by_name(found, "127.0.0.1:6390").config;
        assert_eq!((strings.mode, strings.read_only, strings.separator.as_str()), (ConnectionMode::Cluster, true, ":"));

        let turkish = &by_name(found, "İstanbul Şube").config;
        assert_eq!((turkish.username.as_str(), turkish.password.as_str()), ("ağ", "şifre"));

        let ssh = by_name(found, "Tünel");
        assert!(ssh.config.ssh.enabled);
        assert_eq!((ssh.config.ssh.host.as_str(), ssh.config.ssh.port, ssh.config.ssh.timeout_sec), ("bastion", 2222, 15));
        assert_eq!((ssh.config.ssh.auth, ssh.config.ssh.private_key_path.as_str()), (SshAuth::PrivateKey, "/nope/id_rsa"));
        assert_eq!((ssh.config.ssh.password.as_str(), ssh.config.ssh.passphrase.as_str()), ("p", "pp"));
        assert_eq!(ssh.warnings.iter().map(|w| w.code.as_str()).collect::<Vec<_>>(), ["sshKeyMissing"]);
        assert!(!by_name(found, "no ssh host").config.ssh.enabled);

        let ssl = by_name(found, "TLS");
        assert!(ssl.config.tls.enabled && !ssl.config.tls.skip_verify);
        assert_eq!((ssl.config.tls.ca_path.as_str(), ssl.config.tls.cert_path.as_str()), ("/nope/ca.crt", ""));
        assert_eq!(ssl.config.tls.server_name, "redis.example");
        assert_eq!(ssl.warnings.iter().map(|w| w.code.as_str()).collect::<Vec<_>>(), ["tlsCaMissing", "tlsKeyMissing"]);

        let sentinel = &by_name(found, "Sentinel").config;
        assert_eq!(sentinel.mode, ConnectionMode::Sentinel);
        assert_eq!(sentinel.sentinel.master_name, "mymaster");
        assert_eq!((sentinel.password.as_str(), sentinel.sentinel.sentinel_password.as_str()), ("node-pw", "sentinel-pw"));
        assert_eq!(sentinel.db, 2);
    }

    #[test]
    fn maps_every_variant() {
        assert_mapping(&candidates(&ardm_connections(), &[]));
    }

    #[test]
    fn duplicates_match_host_port_and_folded_name() {
        let existing = ConnectionConfig {
            id: "c1".into(),
            name: "istanbul şube".into(),
            host: "REDIS.local".into(),
            port: 6379,
            ..ConnectionConfig::default()
        };
        let found = candidates(&ardm_connections(), &[existing]);
        assert_eq!(by_name(&found, "İstanbul Şube").duplicate_of, "c1");
        assert!(found.iter().filter(|c| c.duplicate_of.is_empty()).count() == 6);
    }

    #[test]
    fn reads_local_storage_in_both_encodings() {
        let text = ardm_connections().to_string();
        for (script_key, value) in [(latin1("connections"), utf16(&text)), (utf16("connections"), utf16(&text))] {
            let dir = temp_dir();
            let decoy = json!({"x": {"host": "decoy"}}).to_string();
            let other = (entry_key("https://other", latin1("connections")), latin1(&decoy));
            write_db(&dir, &[(entry_key("file://", script_key), value), other]);
            let stored = local_storage::read_value(&dir, "connections", |t| {
                serde_json::from_str(t).map_or(0, |v| connection_values(&v).len())
            })
            .unwrap()
            .unwrap();
            assert_mapping(&candidates(&serde_json::from_str(&stored).unwrap(), &[]));
            std::fs::remove_dir_all(&dir).unwrap();
        }
    }

    #[test]
    fn latin1_connections_value() {
        let text = json!({"a": {"host": "h", "port": 1, "name": "Müşteri"}}).to_string().replace('ş', "s");
        let dir = temp_dir();
        write_db(&dir, &[(entry_key("file://", latin1("connections")), latin1(&text))]);
        let stored = local_storage::read_value(&dir, "connections", |_| 0).unwrap().unwrap();
        assert_eq!(candidates(&serde_json::from_str(&stored).unwrap(), &[])[0].config.name, "Müsteri");
        std::fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn reads_ardm_export_files() {
        let list: Vec<Value> = ardm_connections().as_object().unwrap().values().cloned().collect();
        let array = serde_json::to_string(&list).unwrap();
        let dir = temp_dir();
        let encoded = STANDARD.encode(&array);
        let lines: Vec<&str> = encoded.as_bytes().chunks(76).map(|c| std::str::from_utf8(c).unwrap()).collect();
        for (name, content) in [
            ("connections.ardm", encoded.clone()),
            ("wrapped.ardm", lines.join("\n")),
            ("plain.json", format!("\u{FEFF}{array}")),
            ("map.json", ardm_connections().to_string()),
        ] {
            let path = dir.join(name);
            std::fs::write(&path, content).unwrap();
            assert_mapping(&read_file(&path, &[]).unwrap());
        }
        for bad in ["not base64 !!", "[]", "e30="] {
            let path = dir.join("bad.ardm");
            std::fs::write(&path, bad).unwrap();
            assert!(read_file(&path, &[]).is_err(), "{bad}");
        }
        std::fs::remove_dir_all(&dir).unwrap();
    }
}
