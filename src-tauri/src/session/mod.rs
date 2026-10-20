//! Bir bağlantının canlı oturumu: düğüm bağlantıları (TCP / TLS / SSH tüneli), cluster yönlendirmesi,
//! sentinel ile master çözümü. Her (düğüm, db) çifti için ayrı MultiplexedConnection tutulur — SELECT yarışı olmaz.
//! SAHİBİ: backend-core ajanı — imzalar sözleşmedir (toplu işler ve tarama bunlara göre yazılır).

mod admin;
mod cluster;
mod keys;
pub(crate) mod reply;
mod values;

#[cfg(test)]
mod tests;

pub use cluster::key_slot;

use crate::console::CommandCache;
use crate::error::{AppError, AppResult, ErrorKind};
use crate::model::{ConnectionConfig, ConnectionMode, NodeInfo, SessionInfo};
use crate::net::{BoxStream, Connector};
use crate::store::Store;
use cluster::SlotTable;
use redis::aio::MultiplexedConnection;
use redis::{AsyncConnectionConfig, FromRedisValue, RedisConnectionInfo, ServerError, ServerErrorKind, Value};
use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, RwLock};
use std::time::{Duration, Instant};
use tokio::sync::OnceCell;

pub type Conn = redis::aio::MultiplexedConnection;

const RESPONSE_TIMEOUT: Duration = Duration::from_secs(60);
const MAX_REDIRECTS: usize = 5;
const SLOTS_REFRESH_GAP: Duration = Duration::from_millis(500);

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

impl NodeAddr {
    /// "host:port" (IPv6 host'ta son ':' ayırıcıdır)
    pub fn parse(text: &str) -> AppResult<NodeAddr> {
        text.rsplit_once(':')
            .and_then(|(host, port)| Some(NodeAddr { host: host.trim_matches(['[', ']']).to_string(), port: port.parse().ok()? }))
            .filter(|n| !n.host.is_empty())
            .ok_or_else(|| AppError::invalid(format!("invalid node address: {text}")))
    }
}

/// Konsolun kendi bağlantıları var: orada MULTI ya da BLPOP ana şeridi etkilemez
#[derive(Clone, Copy, PartialEq, Eq, Hash, Debug)]
pub(crate) enum Lane {
    Main,
    Console,
}

pub(crate) enum Route<'a> {
    /// Tekil/sentinel master'ı; cluster'da ilk master
    Default,
    Key(&'a [u8]),
    /// Açıkça seçilmiş düğüm; MOVED/ASK izlenmez
    Node(NodeAddr),
}

#[derive(Clone, Copy)]
enum Request<'a> {
    Cmd(&'a redis::Cmd),
    Atomic(&'a redis::Pipeline),
}

struct Pooled {
    conn: Conn,
    driver: tokio::task::AbortHandle,
}

impl Drop for Pooled {
    fn drop(&mut self) {
        self.driver.abort();
    }
}

type PoolKey = (NodeAddr, u32, Lane);
type PoolSlot = Arc<OnceCell<Pooled>>;

pub struct Session {
    pub config: ConnectionConfig,
    connector: Connector,
    version: (u32, u32, u32),
    version_text: String,
    role: String,
    db_count: u32,
    modules: Vec<String>,
    default_node: RwLock<NodeAddr>,
    slots: Option<RwLock<SlotTable>>,
    last_slots_refresh: tokio::sync::Mutex<Option<Instant>>,
    pool: Mutex<HashMap<PoolKey, PoolSlot>>,
    closed: AtomicBool,
    pub(crate) commands: CommandCache,
}

impl Session {
    async fn open(config: ConnectionConfig) -> AppResult<Session> {
        let connector = Connector::new(&config).await?;
        let seed = NodeAddr { host: config.host.clone(), port: config.port };
        let cluster = config.mode == ConnectionMode::Cluster;
        let mut session = Session {
            config,
            connector,
            version: (0, 0, 0),
            version_text: String::new(),
            role: "master".into(),
            db_count: 16,
            modules: Vec::new(),
            default_node: RwLock::new(seed.clone()),
            slots: cluster.then(|| RwLock::new(SlotTable::default())),
            last_slots_refresh: tokio::sync::Mutex::new(None),
            pool: Mutex::new(HashMap::new()),
            closed: AtomicBool::new(false),
            commands: CommandCache::default(),
        };
        match session.config.mode {
            ConnectionMode::Standalone => {}
            ConnectionMode::Sentinel => {
                let master = session.resolve_master().await?;
                *session.default_node.get_mut().unwrap() = master;
            }
            ConnectionMode::Cluster => {
                let table = session.fetch_slots(&seed).await?;
                session.install_slots(table);
            }
        }
        session.load_facts().await?;
        Ok(session)
    }

    pub fn info(&self) -> SessionInfo {
        let nodes = match &self.slots {
            Some(table) => table.read().unwrap().nodes(),
            None => vec![NodeInfo { addr: self.default_node().to_string(), role: self.role.clone(), slots: String::new() }],
        };
        SessionInfo {
            connection_id: self.config.id.clone(),
            server_version: self.version_text.clone(),
            mode: self.config.mode,
            db_count: self.db_count,
            nodes,
            modules: self.modules.clone(),
            read_only: self.config.read_only,
        }
    }

    pub fn is_cluster(&self) -> bool {
        self.slots.is_some()
    }

    /// (major, minor, patch)
    pub fn version(&self) -> (u32, u32, u32) {
        self.version
    }

    pub fn version_at_least(&self, major: u32, minor: u32) -> bool {
        let (ma, mi, _) = self.version();
        (ma, mi) >= (major, minor)
    }

    pub fn db_count(&self) -> u32 {
        self.db_count
    }

    /// Salt okunur bağlantıda `ErrorKind::ReadOnly`
    pub fn ensure_writable(&self) -> AppResult<()> {
        if self.config.read_only {
            Err(AppError::read_only())
        } else {
            Ok(())
        }
    }

    /// SCAN hedefleri: tekil/sentinel → master; cluster → tüm master'lar
    pub async fn scan_nodes(&self) -> AppResult<Vec<NodeAddr>> {
        Ok(match &self.slots {
            Some(table) => table.read().unwrap().masters(),
            None => vec![self.default_node()],
        })
    }

    /// Anahtarın slotuna sahip düğüme komut; MOVED/ASK ve kopan bağlantıda bir kez yeniden dener
    pub async fn query_key<T: FromRedisValue>(&self, db: u32, key: &[u8], cmd: &redis::Cmd) -> AppResult<T> {
        convert(self.run(db, Lane::Main, &Route::Key(key), Request::Cmd(cmd)).await?)
    }

    /// Anahtarsız komut. `node` boş = varsayılan düğüm (master / ilk cluster master'ı), değilse "host:port"
    pub async fn query_node<T: FromRedisValue>(&self, node: &str, db: u32, cmd: &redis::Cmd) -> AppResult<T> {
        let route = node_route(node)?;
        convert(self.run(db, Lane::Main, &route, Request::Cmd(cmd)).await?)
    }

    /// Sunucu hatası dahil ham yanıt (konsol için; iç içe hatalar korunur)
    pub(crate) async fn query_raw(&self, db: u32, lane: Lane, route: &Route<'_>, cmd: &redis::Cmd) -> AppResult<Value> {
        self.run(db, lane, route, Request::Cmd(cmd)).await
    }

    /// Tek anahtarlı komutlar; düğüm başına pipeline'a gruplanır. Sonuç sırası girdi sırasıdır, hatalar öğe başına.
    pub async fn pipeline_keys(&self, db: u32, items: Vec<(Vec<u8>, redis::Cmd)>) -> AppResult<Vec<AppResult<redis::Value>>> {
        let mut groups: HashMap<NodeAddr, Vec<usize>> = HashMap::new();
        for (index, (key, _)) in items.iter().enumerate() {
            groups.entry(self.node_for(&Route::Key(key))).or_default().push(index);
        }
        let runs = groups.into_iter().map(|(node, indexes)| {
            let items = &items;
            async move {
                let mut pipe = redis::pipe();
                for &i in &indexes {
                    pipe.add_command(items[i].1.clone());
                }
                let result = self.pipeline_on(&node, db, &pipe).await;
                (indexes, result)
            }
        });
        let mut results: Vec<Option<AppResult<Value>>> = items.iter().map(|_| None).collect();
        let mut redirected = Vec::new();
        for (indexes, result) in futures_util::future::join_all(runs).await {
            match result {
                Ok(values) => {
                    for (i, value) in indexes.into_iter().zip(values) {
                        match value {
                            Value::ServerError(err) if self.is_cluster() && redirect_kind(&err).is_some() => redirected.push(i),
                            Value::ServerError(err) => results[i] = Some(Err(err.into())),
                            value => results[i] = Some(Ok(value)),
                        }
                    }
                }
                Err(err) => {
                    for i in indexes {
                        results[i] = Some(Err(err.clone()));
                    }
                }
            }
        }
        if !redirected.is_empty() {
            self.refresh_slots().await;
            for i in redirected {
                let (key, cmd) = &items[i];
                let value = self.run(db, Lane::Main, &Route::Key(key), Request::Cmd(cmd)).await;
                results[i] = Some(value.and_then(|v| match v {
                    Value::ServerError(err) => Err(err.into()),
                    v => Ok(v),
                }));
            }
        }
        Ok(results.into_iter().map(|r| r.unwrap_or_else(|| Err(AppError::internal("missing pipeline reply")))).collect())
    }

    /// Hepsi aynı anahtara dokunan komutlar MULTI/EXEC içinde; EXEC dizisini döndürür
    pub async fn atomic_key(&self, db: u32, key: &[u8], pipe: redis::Pipeline) -> AppResult<redis::Value> {
        let mut pipe = pipe;
        pipe.atomic();
        match self.run(db, Lane::Main, &Route::Key(key), Request::Atomic(&pipe)).await? {
            Value::ServerError(err) => Err(err.into()),
            Value::Array(items) => match items.iter().find_map(as_server_error) {
                Some(err) => Err(err.clone().into()),
                None => Ok(Value::Array(items)),
            },
            other => Ok(other),
        }
    }

    /// Pub/Sub ve MONITOR için havuz dışı ham akış
    pub(crate) async fn open_stream(&self, node: &NodeAddr) -> AppResult<BoxStream> {
        self.connector.connect(&node.host, node.port).await
    }

    pub(crate) fn credentials(&self, db: u32) -> RedisConnectionInfo {
        credentials(&self.config.username, &self.config.password, db)
    }

    pub(crate) fn connect_timeout(&self) -> Duration {
        self.connector.timeout()
    }

    pub(crate) fn default_node(&self) -> NodeAddr {
        self.default_node.read().unwrap().clone()
    }

    /// Yapılandırmadaki veritabanı; cluster'da 0
    pub(crate) fn home_db(&self) -> u32 {
        if self.is_cluster() {
            0
        } else {
            self.config.db
        }
    }

    pub(crate) fn node_for(&self, route: &Route<'_>) -> NodeAddr {
        match (route, &self.slots) {
            (Route::Node(node), _) => node.clone(),
            (Route::Key(key), Some(table)) => table.read().unwrap().master_for(key_slot(key)).cloned().unwrap_or_else(|| self.default_node()),
            _ => self.default_node(),
        }
    }

    async fn shutdown(&self) {
        self.closed.store(true, Ordering::SeqCst);
        let pool = std::mem::take(&mut *self.pool.lock().unwrap());
        drop(pool);
        self.connector.close().await;
    }

    // ── yönlendirme ──

    async fn run(&self, db: u32, lane: Lane, route: &Route<'_>, request: Request<'_>) -> AppResult<Value> {
        let follow = !matches!(route, Route::Node(_));
        let mut node = self.node_for(route);
        let mut asking = false;
        let mut reconnected = false;
        for _ in 0..=MAX_REDIRECTS {
            match self.exec_once(&node, db, lane, request, asking).await? {
                Err(err) if !reconnected && is_dropped(&err) => {
                    reconnected = true;
                    if follow {
                        self.recover_master().await;
                        node = self.node_for(route);
                    }
                }
                Err(err) => return Err(err.into()),
                Ok(Value::ServerError(err)) if follow => match redirect_kind(&err).filter(|_| self.is_cluster()) {
                    Some(kind) => {
                        let (slot, target) = redirect_target(&err, &node)?;
                        asking = kind == ServerErrorKind::Ask;
                        if kind == ServerErrorKind::Moved {
                            if let Some(table) = &self.slots {
                                table.write().unwrap().set_owner(slot, target.clone());
                            }
                            self.refresh_slots().await;
                        }
                        node = target;
                    }
                    None if !reconnected && self.is_sentinel() && err.kind() == Some(ServerErrorKind::ReadOnly) => {
                        reconnected = true;
                        self.recover_master().await;
                        node = self.node_for(route);
                    }
                    None => return Ok(Value::ServerError(err)),
                },
                Ok(value) => return Ok(value),
            }
        }
        Err(AppError::new(ErrorKind::Redis, "too many cluster redirects"))
    }

    /// Dış hata: bağlantı kurulamadı. İç hata: komut gönderildi ama başarısız oldu.
    async fn exec_once(&self, node: &NodeAddr, db: u32, lane: Lane, request: Request<'_>, asking: bool) -> AppResult<redis::RedisResult<Value>> {
        let (mut conn, slot) = self.conn_slot(node, db, lane).await?;
        let result = match request {
            Request::Cmd(cmd) if asking => {
                let mut pipe = redis::pipe();
                pipe.cmd("ASKING").add_command(cmd.clone());
                conn.send_packed_commands(&pipe, 1, 1).await.map(last)
            }
            Request::Cmd(cmd) => conn.send_packed_command(cmd).await,
            Request::Atomic(pipe) => conn.send_packed_commands(pipe, pipe.len() + 1, 1).await.map(last).or_else(moved_in_abort),
        };
        if result.as_ref().is_err_and(is_dropped) {
            self.evict(&self.pool_key(node, db, lane), &slot);
        }
        Ok(result)
    }

    async fn pipeline_on(&self, node: &NodeAddr, db: u32, pipe: &redis::Pipeline) -> AppResult<Vec<Value>> {
        let mut node = node.clone();
        let mut reconnected = false;
        loop {
            let (mut conn, slot) = self.conn_slot(&node, db, Lane::Main).await?;
            match conn.send_packed_commands(pipe, 0, pipe.len()).await {
                Ok(values) => return Ok(values),
                Err(err) if !reconnected && is_dropped(&err) => {
                    self.evict(&self.pool_key(&node, db, Lane::Main), &slot);
                    reconnected = true;
                    if !self.is_cluster() {
                        self.recover_master().await;
                        node = self.default_node();
                    }
                }
                Err(err) => return Err(err.into()),
            }
        }
    }

    // ── bağlantı havuzu ──

    fn pool_key(&self, node: &NodeAddr, db: u32, lane: Lane) -> PoolKey {
        (node.clone(), if self.is_cluster() { 0 } else { db }, lane)
    }

    async fn conn_slot(&self, node: &NodeAddr, db: u32, lane: Lane) -> AppResult<(Conn, PoolSlot)> {
        if self.closed.load(Ordering::SeqCst) {
            return Err(AppError::connection("session is closed"));
        }
        let key = self.pool_key(node, db, lane);
        let info = self.credentials(key.1);
        let slot = self.pool.lock().unwrap().entry(key).or_default().clone();
        let pooled = slot.get_or_try_init(|| self.connect(node, info)).await?;
        Ok((pooled.conn.clone(), slot))
    }

    /// Yalnızca hâlâ aynı yuva duruyorsa siler (bu arada açılmış yeni bağlantıya dokunmaz)
    fn evict(&self, key: &PoolKey, slot: &PoolSlot) {
        let mut pool = self.pool.lock().unwrap();
        if pool.get(key).is_some_and(|current| Arc::ptr_eq(current, slot)) {
            pool.remove(key);
        }
    }

    async fn connect(&self, node: &NodeAddr, info: RedisConnectionInfo) -> AppResult<Pooled> {
        let stream = self.connector.connect(&node.host, node.port).await?;
        let config = AsyncConnectionConfig::new().set_response_timeout(Some(RESPONSE_TIMEOUT));
        let (conn, driver) = tokio::time::timeout(self.connector.timeout(), MultiplexedConnection::new_with_config(&info, stream, config))
            .await
            .map_err(|_| AppError::new(ErrorKind::Timeout, format!("{node}: no response during handshake")))??;
        let driver = tokio::spawn(driver).abort_handle();
        Ok(Pooled { conn, driver })
    }

    // ── sentinel ──

    fn is_sentinel(&self) -> bool {
        self.config.mode == ConnectionMode::Sentinel
    }

    async fn resolve_master(&self) -> AppResult<NodeAddr> {
        let sentinel = &self.config.sentinel;
        if sentinel.master_name.is_empty() {
            return Err(AppError::invalid("sentinel master name is empty"));
        }
        let node = NodeAddr { host: self.config.host.clone(), port: self.config.port };
        let info = credentials(&sentinel.sentinel_username, &sentinel.sentinel_password, 0);
        let mut pooled = self.connect(&node, info).await?;
        let reply: Option<(String, u16)> = redis::cmd("SENTINEL")
            .arg("get-master-addr-by-name")
            .arg(&sentinel.master_name)
            .query_async(&mut pooled.conn)
            .await?;
        let (host, port) = reply.ok_or_else(|| AppError::not_found(format!("sentinel does not know master \"{}\"", sentinel.master_name)))?;
        Ok(NodeAddr { host, port })
    }

    /// Failover sonrası yeni master'ı öğrenir; sentinel dışında bir şey yapmaz
    async fn recover_master(&self) {
        if self.is_sentinel() {
            if let Ok(master) = self.resolve_master().await {
                *self.default_node.write().unwrap() = master;
            }
        }
    }

    // ── cluster ──

    async fn fetch_slots(&self, node: &NodeAddr) -> AppResult<SlotTable> {
        let cmd = redis::cmd("CLUSTER").arg("SLOTS").clone();
        let reply = self.exec_once(node, 0, Lane::Main, Request::Cmd(&cmd), false).await??;
        if let Value::ServerError(err) = reply {
            return Err(err.into());
        }
        SlotTable::parse(&reply, node).ok_or_else(|| AppError::new(ErrorKind::Redis, format!("{node}: unexpected CLUSTER SLOTS reply")))
    }

    fn install_slots(&self, table: SlotTable) {
        if let (Some(first), Some(slots)) = (table.masters().into_iter().next(), &self.slots) {
            *self.default_node.write().unwrap() = first;
            *slots.write().unwrap() = table;
        }
    }

    /// Art arda gelen MOVED'larda tablo bir kez yenilenir
    async fn refresh_slots(&self) {
        let Some(slots) = &self.slots else { return };
        let mut last = self.last_slots_refresh.lock().await;
        if last.is_some_and(|at| at.elapsed() < SLOTS_REFRESH_GAP) {
            return;
        }
        let mut candidates = slots.read().unwrap().masters();
        candidates.push(NodeAddr { host: self.config.host.clone(), port: self.config.port });
        for node in candidates {
            if let Ok(table) = self.fetch_slots(&node).await {
                self.install_slots(table);
                break;
            }
        }
        *last = Some(Instant::now());
    }

    // ── açılış bilgileri ──

    async fn load_facts(&mut self) -> AppResult<()> {
        let mut pipe = redis::pipe();
        pipe.cmd("INFO").cmd("CONFIG").arg("GET").arg("databases").cmd("MODULE").arg("LIST");
        let (mut conn, _) = self.conn_slot(&self.default_node(), self.home_db(), Lane::Main).await?;
        let replies = conn.send_packed_commands(&pipe, 0, 3).await?;
        // parola istenip verilmediyse burada ortaya çıkar; INFO'ya ACL izni olmaması ise tolere edilir
        if let Value::ServerError(err) = &replies[0] {
            if matches!(err.code(), "NOAUTH" | "WRONGPASS") {
                return Err(err.clone().into());
            }
        }
        let info = reply::text(&replies[0]);
        self.version_text = reply::info_field(&info, "redis_version").unwrap_or_default().to_string();
        self.version = parse_version(&self.version_text);
        self.role = match reply::info_field(&info, "role") {
            Some("slave") => "replica".into(),
            Some(role) => role.into(),
            None => "master".into(),
        };
        self.db_count = if self.is_cluster() { 1 } else { reply::config_value(&replies[1]).and_then(|v| v.parse().ok()).unwrap_or(16) };
        self.modules = reply::module_names(&replies[2]);
        Ok(())
    }
}

fn credentials(username: &str, password: &str, db: u32) -> RedisConnectionInfo {
    let mut info = RedisConnectionInfo::default().set_db(i64::from(db));
    if !username.is_empty() {
        info = info.set_username(username);
    }
    if !password.is_empty() {
        info = info.set_password(password);
    }
    info
}

fn node_route(node: &str) -> AppResult<Route<'static>> {
    if node.is_empty() {
        Ok(Route::Default)
    } else {
        Ok(Route::Node(NodeAddr::parse(node)?))
    }
}

fn convert<T: FromRedisValue>(value: Value) -> AppResult<T> {
    match value {
        Value::ServerError(err) => Err(err.into()),
        value => Ok(T::from_redis_value(value.extract_error()?)?),
    }
}

fn last(mut values: Vec<Value>) -> Value {
    values.pop().unwrap_or(Value::Nil)
}

fn as_server_error(value: &Value) -> Option<&ServerError> {
    match value {
        Value::ServerError(err) => Some(err),
        _ => None,
    }
}

fn is_dropped(err: &redis::RedisError) -> bool {
    err.is_connection_dropped() || (err.is_io_error() && !err.is_timeout())
}

/// MULTI içinde MOVED alan komut EXECABORT'a dönüşür; yönlendirme için MOVED'u öne çıkarır
fn moved_in_abort(err: redis::RedisError) -> redis::RedisResult<Value> {
    if err.kind() == redis::ErrorKind::Server(ServerErrorKind::ExecAbort) {
        if let Some(errors) = err.clone().into_server_errors() {
            if let Some((_, moved)) = errors.iter().find(|(_, e)| e.kind() == Some(ServerErrorKind::Moved)) {
                return Ok(Value::ServerError(moved.clone()));
            }
        }
    }
    Err(err)
}

fn redirect_kind(err: &ServerError) -> Option<ServerErrorKind> {
    err.kind().filter(|k| matches!(k, ServerErrorKind::Moved | ServerErrorKind::Ask))
}

/// "3999 127.0.0.1:6381"; host boşsa mevcut düğümün host'u
fn redirect_target(err: &ServerError, current: &NodeAddr) -> AppResult<(u16, NodeAddr)> {
    let detail = err.details().unwrap_or_default();
    let mut parts = detail.split_ascii_whitespace();
    let slot = parts.next().and_then(|s| s.parse().ok());
    let addr = parts.next().and_then(|a| a.rsplit_once(':'));
    match (slot, addr) {
        (Some(slot), Some((host, port))) => {
            let port = port.parse().map_err(|_| AppError::new(ErrorKind::Redis, format!("bad redirect: {detail}")))?;
            let host = if host.is_empty() { current.host.clone() } else { host.to_string() };
            Ok((slot, NodeAddr { host, port }))
        }
        _ => Err(AppError::new(ErrorKind::Redis, format!("bad redirect: {detail}"))),
    }
}

fn parse_version(text: &str) -> (u32, u32, u32) {
    let mut parts = text.split('.').map(|p| p.parse().unwrap_or(0));
    (parts.next().unwrap_or(0), parts.next().unwrap_or(0), parts.next().unwrap_or(0))
}

#[derive(Default)]
pub struct SessionManager {
    sessions: tokio::sync::Mutex<HashMap<String, Arc<OnceCell<Arc<Session>>>>>,
}

impl SessionManager {
    /// Açık oturumu döndürür, yoksa açar
    pub async fn get(&self, store: &Store, connection_id: &str) -> AppResult<Arc<Session>> {
        let cell = self.sessions.lock().await.entry(connection_id.to_string()).or_default().clone();
        let session = cell
            .get_or_try_init(|| async {
                let config = store.get(connection_id)?;
                Session::open(config).await.map(Arc::new)
            })
            .await?;
        Ok(session.clone())
    }

    /// Varsa kapatıp yeniden bağlanır
    pub async fn open(&self, store: &Store, connection_id: &str) -> AppResult<Arc<Session>> {
        self.close(connection_id).await;
        self.get(store, connection_id).await
    }

    pub async fn close(&self, connection_id: &str) {
        let cell = self.sessions.lock().await.remove(connection_id);
        if let Some(session) = cell.as_ref().and_then(|c| c.get()) {
            session.shutdown().await;
        }
    }

    /// Kaydedilmemiş yapılandırmayla deneme bağlantısı (oturum saklanmaz)
    pub async fn connect_once(&self, config: &ConnectionConfig) -> AppResult<Arc<Session>> {
        Session::open(config.clone()).await.map(Arc::new)
    }
}

/// `connect_once` oturumunu bırakmadan önce bağlantıları ve SSH oturumunu kapatır
pub async fn dispose(session: Arc<Session>) {
    session.shutdown().await;
}
