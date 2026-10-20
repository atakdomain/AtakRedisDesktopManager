//! Bağlantı listesi ve adlandırılmış JSON belgeleri (uygulama yapılandırma klasöründe).
//! Parolalar işletim sistemi anahtar zincirinde; erişilemezse dosyada kalır.
//! SAHİBİ: backend-core ajanı — gövdeler iskelettir.

use crate::error::AppResult;
use crate::model::ConnectionConfig;
use std::path::{Path, PathBuf};

pub struct Store {
    dir: PathBuf,
}

impl Store {
    pub fn load(dir: PathBuf) -> AppResult<Store> {
        Ok(Store { dir })
    }

    pub fn config_dir(&self) -> &Path {
        &self.dir
    }

    pub fn secure_storage(&self) -> bool {
        unimplemented!()
    }

    /// `order`'a göre sıralı, parolalar dolu
    pub fn list(&self) -> Vec<ConnectionConfig> {
        unimplemented!()
    }

    pub fn get(&self, _id: &str) -> AppResult<ConnectionConfig> {
        unimplemented!()
    }

    /// `id` boşsa yeni kimlik ve sona `order` atar
    pub fn save(&self, _config: ConnectionConfig) -> AppResult<ConnectionConfig> {
        unimplemented!()
    }

    pub fn save_many(&self, _configs: Vec<ConnectionConfig>) -> AppResult<Vec<ConnectionConfig>> {
        unimplemented!()
    }

    pub fn delete(&self, _id: &str) -> AppResult<()> {
        unimplemented!()
    }

    pub fn reorder(&self, _ids: &[String]) -> AppResult<()> {
        unimplemented!()
    }

    /// Adlandırılmış belge (`[a-z0-9_-]+`); yoksa `Value::Null`
    pub fn doc_get(&self, _name: &str) -> AppResult<serde_json::Value> {
        unimplemented!()
    }

    pub fn doc_set(&self, _name: &str, _value: &serde_json::Value) -> AppResult<()> {
        unimplemented!()
    }
}
