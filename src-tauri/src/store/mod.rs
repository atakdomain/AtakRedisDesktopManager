//! Bağlantı listesi ve adlandırılmış JSON belgeleri (uygulama yapılandırma klasöründe).
//! Parolalar işletim sistemi anahtar zincirinde; erişilemezse dosyada kalır.
//! Değiştiren metotlar anahtar zincirine yazar (bloklayıcı) — async bağlamdan `block_in_place` ile çağrılır.

mod os_keyring;

use crate::error::{AppError, AppResult};
use crate::model::ConnectionConfig;
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use std::sync::Mutex;

const CONNECTIONS_FILE: &str = "connections.json";
const DOCS_DIR: &str = "state";

/// Gizli alanlar: (anahtar zinciri adı, alanın kendisi)
fn secrets(config: &mut ConnectionConfig) -> [(&'static str, &mut String); 4] {
    [
        ("password", &mut config.password),
        ("sentinel.sentinelPassword", &mut config.sentinel.sentinel_password),
        ("ssh.password", &mut config.ssh.password),
        ("ssh.passphrase", &mut config.ssh.passphrase),
    ]
}

/// Dosyadaki kayıt: `keyring` alanında adı geçen gizli alanlar dosyada boş tutulur.
#[derive(Serialize, Deserialize, Clone, Debug)]
struct Stored {
    #[serde(flatten)]
    config: ConnectionConfig,
    #[serde(default, rename = "keyringFields", skip_serializing_if = "Vec::is_empty")]
    keyring: Vec<String>,
}

pub struct Store {
    dir: PathBuf,
    keyring: Option<os_keyring::Keyring>,
    /// `order`'a göre sıralı, gizli alanlar dolu
    connections: Mutex<Vec<Stored>>,
}

impl Store {
    pub fn load(dir: PathBuf) -> AppResult<Store> {
        let keyring = os_keyring::Keyring::probe();
        Self::open(dir, keyring)
    }

    #[cfg(test)]
    pub(crate) fn without_keyring(dir: PathBuf) -> AppResult<Store> {
        Self::open(dir, None)
    }

    fn open(dir: PathBuf, keyring: Option<os_keyring::Keyring>) -> AppResult<Store> {
        let mut connections = read_connections(&dir.join(CONNECTIONS_FILE))?;
        for stored in &mut connections {
            let id = stored.config.id.clone();
            for (field, value) in secrets(&mut stored.config) {
                if stored.keyring.iter().any(|f| f == field) {
                    *value = keyring.as_ref().and_then(|k| k.get(&id, field)).unwrap_or_default();
                }
            }
        }
        connections.sort_by_key(|s| s.config.order);
        Ok(Store { dir, keyring, connections: Mutex::new(connections) })
    }

    pub fn config_dir(&self) -> &Path {
        &self.dir
    }

    pub fn secure_storage(&self) -> bool {
        self.keyring.is_some()
    }

    /// `order`'a göre sıralı, parolalar dolu
    pub fn list(&self) -> Vec<ConnectionConfig> {
        self.connections.lock().unwrap().iter().map(|s| s.config.clone()).collect()
    }

    pub fn get(&self, id: &str) -> AppResult<ConnectionConfig> {
        self.connections
            .lock()
            .unwrap()
            .iter()
            .find(|s| s.config.id == id)
            .map(|s| s.config.clone())
            .ok_or_else(|| AppError::not_found(format!("connection {id} not found")))
    }

    /// `id` boşsa yeni kimlik ve sona `order` atar
    pub fn save(&self, config: ConnectionConfig) -> AppResult<ConnectionConfig> {
        Ok(self.save_many(vec![config])?.remove(0))
    }

    pub fn save_many(&self, configs: Vec<ConnectionConfig>) -> AppResult<Vec<ConnectionConfig>> {
        let mut guard = self.connections.lock().unwrap();
        let mut next = guard.clone();
        let mut saved = Vec::with_capacity(configs.len());
        for mut config in configs {
            if config.id.is_empty() {
                config.id = uuid::Uuid::new_v4().to_string();
                config.order = next.iter().map(|s| s.config.order).max().map_or(0, |max| max + 1);
            }
            let old = next.iter().position(|s| s.config.id == config.id);
            let stored = self.vault(config, old.map(|i| &next[i]));
            saved.push(stored.config.clone());
            match old {
                Some(i) => next[i] = stored,
                None => next.push(stored),
            }
        }
        next.sort_by_key(|s| s.config.order);
        self.write_connections(&next)?;
        *guard = next;
        Ok(saved)
    }

    pub fn delete(&self, id: &str) -> AppResult<()> {
        let mut guard = self.connections.lock().unwrap();
        let Some(index) = guard.iter().position(|s| s.config.id == id) else {
            return Ok(());
        };
        let mut next = guard.clone();
        let removed = next.remove(index);
        self.write_connections(&next)?;
        *guard = next;
        if let Some(keyring) = &self.keyring {
            for field in &removed.keyring {
                keyring.delete(id, field);
            }
        }
        Ok(())
    }

    /// Listede olanlar verilen sırayı alır, olmayanlar arkada eski sıralarını korur
    pub fn reorder(&self, ids: &[String]) -> AppResult<()> {
        let mut guard = self.connections.lock().unwrap();
        let mut next = guard.clone();
        let rank = |s: &Stored| ids.iter().position(|id| *id == s.config.id).unwrap_or(usize::MAX);
        next.sort_by_key(|s| (rank(s), s.config.order));
        for (order, stored) in next.iter_mut().enumerate() {
            stored.config.order = order as i64;
        }
        self.write_connections(&next)?;
        *guard = next;
        Ok(())
    }

    /// Adlandırılmış belge (`[a-z0-9_-]+`); yoksa `Value::Null`
    pub fn doc_get(&self, name: &str) -> AppResult<serde_json::Value> {
        let path = self.doc_path(name)?;
        match std::fs::read(&path) {
            Ok(bytes) => Ok(serde_json::from_slice(&bytes)?),
            Err(err) if err.kind() == std::io::ErrorKind::NotFound => Ok(serde_json::Value::Null),
            Err(err) => Err(err.into()),
        }
    }

    pub fn doc_set(&self, name: &str, value: &serde_json::Value) -> AppResult<()> {
        let path = self.doc_path(name)?;
        std::fs::create_dir_all(self.dir.join(DOCS_DIR))?;
        write_atomic(&path, &serde_json::to_vec_pretty(value)?)?;
        Ok(())
    }

    fn doc_path(&self, name: &str) -> AppResult<PathBuf> {
        let valid = !name.is_empty() && name.bytes().all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'_' || b == b'-');
        if !valid {
            return Err(AppError::invalid(format!("invalid document name: {name:?}")));
        }
        Ok(self.dir.join(DOCS_DIR).join(format!("{name}.json")))
    }

    /// Gizli alanları anahtar zincirine yazar; yalnızca değişenler yazılır.
    /// Yazılamayan alan dosyada kalır.
    fn vault(&self, mut config: ConnectionConfig, old: Option<&Stored>) -> Stored {
        let mut in_keyring = Vec::new();
        let Some(keyring) = &self.keyring else {
            return Stored { config, keyring: in_keyring };
        };
        let id = config.id.clone();
        let mut old_config = old.map(|s| s.config.clone()).unwrap_or_default();
        let old_secrets = secrets(&mut old_config);
        for ((field, value), (_, old_value)) in secrets(&mut config).into_iter().zip(old_secrets) {
            let was_vaulted = old.is_some_and(|s| s.keyring.iter().any(|f| f == field));
            if value.is_empty() {
                if was_vaulted {
                    keyring.delete(&id, field);
                }
            } else if (was_vaulted && *value == *old_value) || keyring.set(&id, field, value) {
                in_keyring.push(field.to_string());
            }
        }
        Stored { config, keyring: in_keyring }
    }

    fn write_connections(&self, connections: &[Stored]) -> AppResult<()> {
        let on_disk: Vec<Stored> = connections
            .iter()
            .map(|stored| {
                let mut copy = stored.clone();
                for (field, value) in secrets(&mut copy.config) {
                    if stored.keyring.iter().any(|f| f == field) {
                        value.clear();
                    }
                }
                copy
            })
            .collect();
        std::fs::create_dir_all(&self.dir)?;
        write_atomic(&self.dir.join(CONNECTIONS_FILE), &serde_json::to_vec_pretty(&on_disk)?)?;
        Ok(())
    }
}

/// Bozuk dosya kenara alınır; uygulama boş listeyle açılır, kayıtlar elle kurtarılabilir.
fn read_connections(path: &Path) -> AppResult<Vec<Stored>> {
    let bytes = match std::fs::read(path) {
        Ok(bytes) => bytes,
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => return Ok(Vec::new()),
        Err(err) => return Err(err.into()),
    };
    match serde_json::from_slice(&bytes) {
        Ok(list) => Ok(list),
        Err(err) => {
            let stamp = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map_or(0, |d| d.as_secs());
            let backup = path.with_file_name(format!("connections.corrupt-{stamp}.json"));
            eprintln!("connections.json unreadable ({err}); moved to {}", backup.display());
            std::fs::rename(path, &backup)?;
            Ok(Vec::new())
        }
    }
}

fn write_atomic(path: &Path, bytes: &[u8]) -> std::io::Result<()> {
    use std::io::Write;
    let mut tmp_name = path.file_name().unwrap_or_default().to_os_string();
    tmp_name.push(".tmp");
    let tmp = path.with_file_name(tmp_name);
    {
        let mut file = std::fs::File::create(&tmp)?;
        file.write_all(bytes)?;
        file.sync_all()?;
    }
    std::fs::rename(&tmp, path)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_dir(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("ardm-store-{name}-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn sample(name: &str) -> ConnectionConfig {
        ConnectionConfig { name: name.into(), password: "secret".into(), ..Default::default() }
    }

    #[test]
    fn save_assigns_id_and_order_and_persists() {
        let dir = temp_dir("save");
        let store = Store::open(dir.clone(), None).unwrap();
        let a = store.save(sample("a")).unwrap();
        let b = store.save(sample("b")).unwrap();
        assert!(!a.id.is_empty());
        assert_eq!((a.order, b.order), (0, 1));

        let reopened = Store::open(dir.clone(), None).unwrap();
        let names: Vec<_> = reopened.list().into_iter().map(|c| c.name).collect();
        assert_eq!(names, ["a", "b"]);
        assert_eq!(reopened.get(&a.id).unwrap().password, "secret");
        std::fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn reorder_and_delete() {
        let dir = temp_dir("reorder");
        let store = Store::open(dir.clone(), None).unwrap();
        let ids: Vec<_> = ["a", "b", "c"].iter().map(|n| store.save(sample(n)).unwrap().id).collect();
        store.reorder(&[ids[2].clone(), ids[0].clone()]).unwrap();
        let names: Vec<_> = store.list().into_iter().map(|c| c.name).collect();
        assert_eq!(names, ["c", "a", "b"]);

        store.delete(&ids[0]).unwrap();
        let reopened = Store::open(dir.clone(), None).unwrap();
        let names: Vec<_> = reopened.list().into_iter().map(|c| c.name).collect();
        assert_eq!(names, ["c", "b"]);
        assert!(reopened.get(&ids[0]).is_err());
        std::fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn documents_round_trip_and_names_are_checked() {
        let dir = temp_dir("docs");
        let store = Store::open(dir.clone(), None).unwrap();
        assert_eq!(store.doc_get("settings").unwrap(), serde_json::Value::Null);
        let value = serde_json::json!({"theme": "dark"});
        store.doc_set("settings", &value).unwrap();
        assert_eq!(store.doc_get("settings").unwrap(), value);
        for bad in ["", "../x", "Settings", "a.b"] {
            assert_eq!(store.doc_get(bad).unwrap_err().kind, crate::error::ErrorKind::Invalid);
        }
        std::fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn corrupt_file_is_moved_aside() {
        let dir = temp_dir("corrupt");
        std::fs::write(dir.join(CONNECTIONS_FILE), b"{not json").unwrap();
        let store = Store::open(dir.clone(), None).unwrap();
        assert!(store.list().is_empty());
        assert!(!dir.join(CONNECTIONS_FILE).exists());
        std::fs::remove_dir_all(dir).unwrap();
    }

    /// İşletim sistemi anahtar zincirine gerçekten yazar (ve siler)
    #[test]
    #[ignore]
    fn keyring_keeps_secrets_out_of_the_file() {
        let Some(keyring) = os_keyring::Keyring::probe() else {
            eprintln!("keyring unavailable; skipped");
            return;
        };
        let dir = temp_dir("keyring");
        let store = Store::open(dir.clone(), Some(keyring)).unwrap();
        let mut config = sample("k");
        config.ssh.passphrase = "pass-phrase".into();
        let saved = store.save(config).unwrap();

        let file = std::fs::read_to_string(dir.join(CONNECTIONS_FILE)).unwrap();
        assert!(!file.contains("secret") && !file.contains("pass-phrase"));

        let reopened = Store::open(dir.clone(), os_keyring::Keyring::probe()).unwrap();
        let loaded = reopened.get(&saved.id).unwrap();
        assert_eq!((loaded.password.as_str(), loaded.ssh.passphrase.as_str()), ("secret", "pass-phrase"));

        reopened.delete(&saved.id).unwrap();
        let probe = os_keyring::Keyring::probe().unwrap();
        assert_eq!(probe.get(&saved.id, "password"), None);
        std::fs::remove_dir_all(dir).unwrap();
    }
}
