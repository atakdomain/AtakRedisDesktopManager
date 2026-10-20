//! Bir bağlantının canlı oturumu: düğüm bağlantıları (TCP / TLS / SSH tüneli), cluster yönlendirmesi,
//! sentinel ile master çözümü. Her (düğüm, db) çifti için ayrı MultiplexedConnection tutulur — SELECT yarışı olmaz.
//! SAHİBİ: backend-core ajanı — imzalar sözleşmedir (toplu işler ve tarama bunlara göre yazılır), gövdeler iskelettir.

use crate::error::AppResult;
use crate::model::{ConnectionConfig, SessionInfo};
use crate::store::Store;
use redis::FromRedisValue;
use std::sync::Arc;

pub type Conn = redis::aio::MultiplexedConnection;

/// Sunucunun bildirdiği düğüm adresi (SSH tünelinden önceki hâli)
#[derive(Clone, Debug, PartialEq, Eq, Hash)]
pub struct NodeAddr {
    pub host: String,
    pub port: u16,
}

impl std::fmt::Display for NodeAddr {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}:{}", self.host, self.port)
    }
}

pub struct Session {
    pub config: ConnectionConfig,
}

impl Session {
    pub fn info(&self) -> SessionInfo {
        unimplemented!()
    }

    pub fn is_cluster(&self) -> bool {
        unimplemented!()
    }

    /// (major, minor, patch)
    pub fn version(&self) -> (u32, u32, u32) {
        unimplemented!()
    }

    pub fn version_at_least(&self, major: u32, minor: u32) -> bool {
        let (ma, mi, _) = self.version();
        (ma, mi) >= (major, minor)
    }

    /// Salt okunur bağlantıda `ErrorKind::ReadOnly`
    pub fn ensure_writable(&self) -> AppResult<()> {
        unimplemented!()
    }

    /// SCAN hedefleri: tekil/sentinel → master; cluster → tüm master'lar
    pub async fn scan_nodes(&self) -> AppResult<Vec<NodeAddr>> {
        unimplemented!()
    }

    /// Belirli düğüme (cluster'da db 0 olmalı) bağlantı; gerekirse açar
    pub async fn node_conn(&self, _node: &NodeAddr, _db: u32) -> AppResult<Conn> {
        unimplemented!()
    }

    /// Anahtarın slotuna sahip düğüme komut; MOVED/ASK ve kopan bağlantıda bir kez yeniden dener
    pub async fn query_key<T: FromRedisValue>(&self, _db: u32, _key: &[u8], _cmd: &redis::Cmd) -> AppResult<T> {
        unimplemented!()
    }

    /// Anahtarsız komut. `node` boş = varsayılan düğüm (master / ilk cluster master'ı), değilse "host:port"
    pub async fn query_node<T: FromRedisValue>(&self, _node: &str, _db: u32, _cmd: &redis::Cmd) -> AppResult<T> {
        unimplemented!()
    }

    /// Tek anahtarlı komutlar; düğüm başına pipeline'a gruplanır. Sonuç sırası girdi sırasıdır, hatalar öğe başına.
    pub async fn pipeline_keys(&self, _db: u32, _items: Vec<(Vec<u8>, redis::Cmd)>) -> AppResult<Vec<AppResult<redis::Value>>> {
        unimplemented!()
    }

    /// Hepsi aynı anahtara dokunan komutlar MULTI/EXEC içinde; EXEC dizisini döndürür
    pub async fn atomic_key(&self, _db: u32, _key: &[u8], _pipe: redis::Pipeline) -> AppResult<redis::Value> {
        unimplemented!()
    }
}

#[derive(Default)]
pub struct SessionManager {}

impl SessionManager {
    /// Açık oturumu döndürür, yoksa açar
    pub async fn get(&self, _store: &Store, _connection_id: &str) -> AppResult<Arc<Session>> {
        unimplemented!()
    }

    /// Varsa kapatıp yeniden bağlanır
    pub async fn open(&self, _store: &Store, _connection_id: &str) -> AppResult<Arc<Session>> {
        unimplemented!()
    }

    pub async fn close(&self, _connection_id: &str) {
        unimplemented!()
    }

    /// Kaydedilmemiş yapılandırmayla deneme bağlantısı (oturum saklanmaz)
    pub async fn connect_once(&self, _config: &ConnectionConfig) -> AppResult<Arc<Session>> {
        unimplemented!()
    }
}
