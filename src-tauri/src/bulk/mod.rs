//! Toplu işler: sil, TTL, yeniden adlandır, kopyala/taşı, dışa/içe aktar.
//! Anahtarlar 500'lük parçalar hâlinde `Session::pipeline_keys` ile işlenir (cluster'da düğüm başına gruplanır).

mod copy;
mod export;
mod import;
mod rename;
#[cfg(test)]
mod tests;

pub use import::import_file;

use crate::bytes::RBytes;
use crate::error::{AppError, AppResult, ErrorKind};
use crate::model::{BulkAction, BulkEvent, BulkSampleItem, BulkSource, BulkSpec, BulkSummary};
use crate::scan::Scanner;
use crate::session::Session;
use redis::Value;
use std::time::{Duration, Instant};
use tokio_util::sync::CancellationToken;

const CHUNK: usize = 500;
const MAX_SAMPLES: usize = 500;
const SAMPLE_BATCH: usize = 100;
const MAX_ERRORS: u32 = 200;
const PROGRESS_INTERVAL: Duration = Duration::from_millis(100);

pub type Emit<'e> = &'e (dyn Fn(BulkEvent) + Sync);

pub(crate) mod note {
    pub const NONE: &str = "";
    pub const EXISTS: &str = "exists";
    pub const DUPLICATE: &str = "duplicate";
    pub const UNCHANGED: &str = "unchanged";
    pub const HAS_TTL: &str = "hasTtl";
    pub const BINARY: &str = "binary";
}

pub(crate) enum Outcome {
    Done,
    Skipped,
    Failed(String),
}

/// `target` copy hedefinin oturumudur (aynı bağlantıda `source` ile aynı); diğer işlerde kullanılmaz.
pub async fn run(
    source: &Session,
    target: &Session,
    spec: &BulkSpec,
    token: &CancellationToken,
    emit: Emit<'_>,
) -> AppResult<BulkSummary> {
    let total = match &spec.source {
        BulkSource::Keys { keys } => Some(keys.len() as u64),
        BulkSource::Filter { .. } => None,
    };
    if source.is_cluster() && spec.db != 0 {
        return Err(AppError::invalid("cluster mode has only db 0"));
    }
    let mut job = Job { session: source, db: spec.db, rep: Reporter::new(emit, total, spec.dry_run) };
    let mut keys = KeySource::new(source, spec).await?;
    let mut worker = Worker::new(&job, target, spec).await?;
    let result = match &mut worker {
        Worker::Rename { renamer, overwrite } => rename::run(&mut job, &mut keys, renamer, *overwrite, token).await,
        _ => worker.run(&mut job, &mut keys, token).await,
    };
    let output_path = worker.finish().await?;
    let cancelled = match result {
        Ok(()) => false,
        Err(err) if err.kind == ErrorKind::Cancelled => true,
        Err(err) => return Err(err),
    };
    Ok(job.rep.finish(cancelled, output_path))
}

pub(crate) struct Job<'a> {
    pub session: &'a Session,
    pub db: u32,
    pub rep: Reporter<'a>,
}

impl Job<'_> {
    pub fn dry_run(&self) -> bool {
        self.rep.dry_run
    }

    pub async fn pipeline(&self, items: Vec<(Vec<u8>, redis::Cmd)>) -> AppResult<Vec<AppResult<Value>>> {
        self.session.pipeline_keys(self.db, items).await
    }

    pub fn unlink_name(&self) -> &'static str {
        unlink_name(self.session)
    }
}

pub(crate) fn unlink_name(session: &Session) -> &'static str {
    if session.version_at_least(4, 0) {
        "UNLINK"
    } else {
        "DEL"
    }
}

enum Worker<'a> {
    Delete,
    Expire { ttl_ms: i64, only_without_ttl: bool },
    Rename { renamer: rename::Renamer, overwrite: bool },
    Copy(copy::Copier<'a>),
    Export(export::Exporter),
}

impl<'a> Worker<'a> {
    async fn new(job: &Job<'a>, target: &'a Session, spec: &BulkSpec) -> AppResult<Worker<'a>> {
        let source = job.session;
        let writes_source = match &spec.action {
            BulkAction::Export { .. } => false,
            BulkAction::Copy { move_keys, .. } => *move_keys,
            _ => true,
        };
        if writes_source && !spec.dry_run {
            source.ensure_writable()?;
        }
        Ok(match &spec.action {
            BulkAction::Delete => Worker::Delete,
            BulkAction::Expire { ttl_ms, only_without_ttl } => {
                Worker::Expire { ttl_ms: *ttl_ms, only_without_ttl: *only_without_ttl }
            }
            BulkAction::Rename { find, replace, regex, case_sensitive, overwrite } => Worker::Rename {
                renamer: rename::Renamer::new(find, replace, *regex, *case_sensitive)?,
                overwrite: *overwrite,
            },
            BulkAction::Copy { target_connection_id, target_db, replace, move_keys } => {
                let same_connection = target_connection_id.is_empty() || *target_connection_id == spec.connection_id;
                let copier = copy::Copier::new(
                    source,
                    target,
                    same_connection,
                    spec.db,
                    *target_db,
                    *replace,
                    *move_keys,
                )?;
                if !spec.dry_run {
                    target.ensure_writable()?;
                }
                Worker::Copy(copier)
            }
            BulkAction::Export { path, format } => {
                Worker::Export(export::Exporter::create(path, *format, spec.dry_run).await?)
            }
        })
    }

    async fn run(&mut self, job: &mut Job<'_>, keys: &mut KeySource<'_>, token: &CancellationToken) -> AppResult<()> {
        loop {
            if token.is_cancelled() {
                return Err(AppError::cancelled());
            }
            let Some(chunk) = keys.next_chunk(&mut job.rep, token).await? else { return Ok(()) };
            match self {
                Worker::Delete => delete(job, chunk).await?,
                Worker::Expire { ttl_ms, only_without_ttl } => expire(job, chunk, *ttl_ms, *only_without_ttl).await?,
                Worker::Copy(copier) => copier.process(job, chunk).await?,
                Worker::Export(exporter) => exporter.process(job, chunk).await?,
                Worker::Rename { .. } => unreachable!("rename collects all keys first"),
            }
            job.rep.progress();
        }
    }

    /// Export dosyasını kapatır (iptalde de); yolunu döndürür
    async fn finish(self) -> AppResult<String> {
        match self {
            Worker::Export(exporter) => exporter.finish().await,
            _ => Ok(String::new()),
        }
    }
}

async fn delete(job: &mut Job<'_>, keys: Vec<Vec<u8>>) -> AppResult<()> {
    if job.dry_run() {
        for key in keys {
            job.rep.plan(key, None, note::NONE);
        }
        return Ok(());
    }
    let replies = job.pipeline(key_cmds(&keys, job.unlink_name())).await?;
    for (key, reply) in keys.iter().zip(replies) {
        job.rep.record(key, int_outcome(reply));
    }
    Ok(())
}

async fn expire(job: &mut Job<'_>, keys: Vec<Vec<u8>>, ttl_ms: i64, only_without_ttl: bool) -> AppResult<()> {
    let use_nx = only_without_ttl && ttl_ms > 0 && !job.dry_run() && job.session.version_at_least(7, 0);
    let keys = if only_without_ttl && !use_nx { without_ttl(job, keys).await? } else { keys };
    if job.dry_run() {
        for key in keys {
            job.rep.plan(key, None, note::NONE);
        }
        return Ok(());
    }
    let items = keys
        .iter()
        .map(|key| {
            let mut cmd = key_cmd(if ttl_ms > 0 { "PEXPIRE" } else { "PERSIST" }, key);
            if ttl_ms > 0 {
                cmd.arg(ttl_ms);
            }
            if use_nx {
                cmd.arg("NX");
            }
            (key.clone(), cmd)
        })
        .collect();
    let replies = job.pipeline(items).await?;
    for (key, reply) in keys.iter().zip(replies) {
        job.rep.record(key, int_outcome(reply));
    }
    Ok(())
}

/// PTTL ile süresi olan (ya da artık olmayan) anahtarları ayıklar
async fn without_ttl(job: &mut Job<'_>, keys: Vec<Vec<u8>>) -> AppResult<Vec<Vec<u8>>> {
    let replies = job.pipeline(key_cmds(&keys, "PTTL")).await?;
    let mut keep = Vec::with_capacity(keys.len());
    for (key, reply) in keys.into_iter().zip(replies) {
        match reply.map(|v| int_of(&v)) {
            Ok(Some(-1)) => keep.push(key),
            Ok(Some(-2)) => job.rep.skip(key, note::NONE),
            Ok(_) => job.rep.skip(key, note::HAS_TTL),
            Err(err) => job.rep.record(&key, Outcome::Failed(err.message)),
        }
    }
    Ok(keep)
}

pub(crate) fn key_cmd(name: &str, key: &[u8]) -> redis::Cmd {
    let mut cmd = redis::cmd(name);
    cmd.arg(key);
    cmd
}

pub(crate) fn key_cmds(keys: &[Vec<u8>], name: &str) -> Vec<(Vec<u8>, redis::Cmd)> {
    keys.iter().map(|key| (key.clone(), key_cmd(name, key))).collect()
}

/// Tamsayı yanıt: > 0 yapıldı, 0 atlandı
pub(crate) fn int_outcome(reply: AppResult<Value>) -> Outcome {
    match reply {
        Ok(value) if int_of(&value).unwrap_or(0) > 0 => Outcome::Done,
        Ok(_) => Outcome::Skipped,
        Err(err) => Outcome::Failed(err.message),
    }
}

pub(crate) fn int_of(value: &Value) -> Option<i64> {
    redis::from_redis_value_ref(value).ok()
}

/// Tekil yanıtın baytları; nil ve kapsayıcılar None
pub(crate) fn bytes_of(value: Value) -> Option<Vec<u8>> {
    match value {
        Value::BulkString(bytes) => Some(bytes),
        Value::SimpleString(text) | Value::VerbatimString { text, .. } => Some(text.into_bytes()),
        Value::Okay => Some(b"OK".to_vec()),
        Value::Int(n) => Some(n.to_string().into_bytes()),
        Value::Double(n) => Some(n.to_string().into_bytes()),
        _ => None,
    }
}

pub(crate) fn is_busy_key(err: &AppError) -> bool {
    err.message.contains("BUSYKEY")
}

// ───────────────────────────── Anahtar kaynağı ─────────────────────────────

pub(crate) enum KeySource<'a> {
    Keys(std::vec::IntoIter<Vec<u8>>),
    Scan { scanner: Box<Scanner<'a>>, buffer: Vec<Vec<u8>> },
}

impl<'a> KeySource<'a> {
    async fn new(session: &'a Session, spec: &BulkSpec) -> AppResult<KeySource<'a>> {
        Ok(match &spec.source {
            BulkSource::Keys { keys } => {
                KeySource::Keys(keys.iter().map(|k| k.0.clone()).collect::<Vec<_>>().into_iter())
            }
            BulkSource::Filter { filter } => KeySource::Scan {
                scanner: Box::new(Scanner::new(session, spec.db, filter, "").await?),
                buffer: Vec::new(),
            },
        })
    }

    /// En fazla `CHUNK` anahtar; kaynak bitince None. Tarama turları arasında iptal edilir.
    pub async fn next_chunk(
        &mut self,
        rep: &mut Reporter<'_>,
        token: &CancellationToken,
    ) -> AppResult<Option<Vec<Vec<u8>>>> {
        let chunk: Vec<Vec<u8>> = match self {
            KeySource::Keys(iter) => iter.by_ref().take(CHUNK).collect(),
            KeySource::Scan { scanner, buffer } => {
                while buffer.len() < CHUNK && !scanner.is_done() {
                    if token.is_cancelled() {
                        return Err(AppError::cancelled());
                    }
                    buffer.extend(scanner.next_round().await?);
                    rep.scanned = scanner.scanned;
                    rep.progress();
                }
                let rest = buffer.split_off(buffer.len().min(CHUNK));
                std::mem::replace(buffer, rest)
            }
        };
        if chunk.is_empty() {
            return Ok(None);
        }
        rep.matched += chunk.len() as u64;
        if matches!(self, KeySource::Keys(_)) {
            rep.scanned = rep.matched;
        }
        Ok(Some(chunk))
    }

    /// Tüm eşleşenler, sıralı ve tekrarsız (SCAN aynı anahtarı iki kez döndürebilir)
    pub async fn collect_all(&mut self, rep: &mut Reporter<'_>, token: &CancellationToken) -> AppResult<Vec<Vec<u8>>> {
        let mut all = Vec::new();
        while let Some(chunk) = self.next_chunk(rep, token).await? {
            all.extend(chunk);
        }
        all.sort_unstable();
        all.dedup();
        rep.matched = all.len() as u64;
        Ok(all)
    }
}

// ───────────────────────────── Olaylar ─────────────────────────────

pub(crate) struct Reporter<'e> {
    emit: Emit<'e>,
    started: Instant,
    last_progress: Option<Instant>,
    total: Option<u64>,
    pub dry_run: bool,
    errors: u32,
    samples: Vec<BulkSampleItem>,
    sampled: usize,
    pub scanned: u64,
    pub matched: u64,
    pub processed: u64,
    pub succeeded: u64,
    pub failed: u64,
    pub skipped: u64,
}

impl<'e> Reporter<'e> {
    pub fn new(emit: Emit<'e>, total: Option<u64>, dry_run: bool) -> Reporter<'e> {
        Reporter {
            emit,
            started: Instant::now(),
            last_progress: None,
            total,
            dry_run,
            errors: 0,
            samples: Vec::new(),
            sampled: 0,
            scanned: 0,
            matched: 0,
            processed: 0,
            succeeded: 0,
            failed: 0,
            skipped: 0,
        }
    }

    pub fn record(&mut self, key: &[u8], outcome: Outcome) {
        self.processed += 1;
        match outcome {
            Outcome::Done => self.succeeded += 1,
            Outcome::Skipped => self.skipped += 1,
            Outcome::Failed(message) => {
                self.failed += 1;
                if self.errors < MAX_ERRORS {
                    self.errors += 1;
                    (self.emit)(BulkEvent::Error { key: RBytes::from(key), message });
                }
            }
        }
    }

    /// Atlanan anahtar; dry run'da örnek olarak da gider
    pub fn skip(&mut self, key: Vec<u8>, note: &'static str) {
        if self.dry_run {
            self.plan(key, None, note);
        } else {
            self.record(&key, Outcome::Skipped);
        }
    }

    /// Dry run kaydı: not varsa atlanmış sayılır
    pub fn plan(&mut self, key: Vec<u8>, new_key: Option<Vec<u8>>, note: &'static str) {
        self.processed += 1;
        if !note.is_empty() {
            self.skipped += 1;
        }
        if self.sampled < MAX_SAMPLES {
            self.sampled += 1;
            self.samples.push(BulkSampleItem { key: RBytes(key), new_key: new_key.map(RBytes), note: note.into() });
            if self.samples.len() >= SAMPLE_BATCH {
                self.flush_samples();
            }
        }
    }

    fn flush_samples(&mut self) {
        if !self.samples.is_empty() {
            (self.emit)(BulkEvent::Sample { items: std::mem::take(&mut self.samples) });
        }
    }

    /// En fazla ~10/sn
    pub fn progress(&mut self) {
        if self.last_progress.is_some_and(|at| at.elapsed() < PROGRESS_INTERVAL) {
            return;
        }
        self.last_progress = Some(Instant::now());
        self.flush_samples();
        (self.emit)(self.progress_event());
    }

    fn progress_event(&self) -> BulkEvent {
        BulkEvent::Progress {
            scanned: self.scanned,
            matched: self.matched,
            processed: self.processed,
            succeeded: self.succeeded,
            failed: self.failed,
            skipped: self.skipped,
            total: self.total,
        }
    }

    pub fn finish(mut self, cancelled: bool, output_path: String) -> BulkSummary {
        self.flush_samples();
        (self.emit)(self.progress_event());
        let summary = BulkSummary {
            scanned: self.scanned,
            matched: self.matched,
            succeeded: self.succeeded,
            failed: self.failed,
            skipped: self.skipped,
            elapsed_ms: self.started.elapsed().as_millis() as u64,
            cancelled,
            dry_run: self.dry_run,
            output_path,
        };
        (self.emit)(BulkEvent::Done { summary: summary.clone() });
        summary
    }
}
