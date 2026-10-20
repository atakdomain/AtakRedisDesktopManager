//! Kopyala / taşı. Aynı bağlantıda başka db'ye ≥ 6.2 ise COPY, aksi hâlde DUMP + PTTL → RESTORE.

use super::{bytes_of, int_of, int_outcome, is_busy_key, key_cmd, key_cmds, note, unlink_name, Job, Outcome};
use crate::error::{AppError, AppResult};
use crate::session::Session;

pub(crate) struct Copier<'a> {
    target: &'a Session,
    target_db: u32,
    replace: bool,
    move_keys: bool,
    copy_command: bool,
}

impl<'a> Copier<'a> {
    pub fn new(
        source: &Session,
        target: &'a Session,
        same_connection: bool,
        db: u32,
        target_db: u32,
        replace: bool,
        move_keys: bool,
    ) -> AppResult<Copier<'a>> {
        if same_connection && source.is_cluster() {
            return Err(AppError::invalid("cluster mode has only db 0; copy to another connection instead"));
        }
        if same_connection && target_db == db {
            return Err(AppError::invalid("source and target database are the same"));
        }
        if target.is_cluster() && target_db != 0 {
            return Err(AppError::invalid("cluster mode has only db 0"));
        }
        let copy_command = same_connection && source.version_at_least(6, 2);
        Ok(Copier { target, target_db, replace, move_keys, copy_command })
    }

    pub async fn process(&mut self, job: &mut Job<'_>, keys: Vec<Vec<u8>>) -> AppResult<()> {
        if job.dry_run() {
            return self.plan(job, keys).await;
        }
        let mut outcomes = if self.copy_command {
            self.copy(job, &keys).await?
        } else {
            let moves: Vec<(&[u8], &[u8])> = keys.iter().map(|k| (k.as_slice(), k.as_slice())).collect();
            transfer(job.session, job.db, self.target, self.target_db, &moves, self.replace).await?
        };
        if self.move_keys {
            remove_sources(job.session, job.db, &keys, &mut outcomes).await?;
        }
        for (key, outcome) in keys.iter().zip(outcomes) {
            job.rep.record(key, outcome);
        }
        Ok(())
    }

    async fn plan(&self, job: &mut Job<'_>, keys: Vec<Vec<u8>>) -> AppResult<()> {
        let exists = if self.replace {
            vec![false; keys.len()]
        } else {
            let replies = self.target.pipeline_keys(self.target_db, key_cmds(&keys, "EXISTS")).await?;
            replies.into_iter().map(|r| r.ok().and_then(|v| int_of(&v)).unwrap_or(0) > 0).collect()
        };
        for (key, exists) in keys.into_iter().zip(exists) {
            let new_key = Some(key.clone());
            job.rep.plan(key, new_key, if exists { note::EXISTS } else { note::NONE });
        }
        Ok(())
    }

    async fn copy(&self, job: &Job<'_>, keys: &[Vec<u8>]) -> AppResult<Vec<Outcome>> {
        let items = keys
            .iter()
            .map(|key| {
                let mut cmd = key_cmd("COPY", key);
                cmd.arg(key).arg("DB").arg(self.target_db);
                if self.replace {
                    cmd.arg("REPLACE");
                }
                (key.clone(), cmd)
            })
            .collect();
        Ok(job.pipeline(items).await?.into_iter().map(int_outcome).collect())
    }
}

/// DUMP + PTTL kaynaktan, RESTORE hedefe. Kaynak yoksa atlanır, hedef varsa (REPLACE yoksa) BUSYKEY → atlanır.
pub(crate) async fn transfer(
    source: &Session,
    source_db: u32,
    target: &Session,
    target_db: u32,
    moves: &[(&[u8], &[u8])],
    replace: bool,
) -> AppResult<Vec<Outcome>> {
    let reads = moves
        .iter()
        .flat_map(|(src, _)| [(src.to_vec(), key_cmd("DUMP", src)), (src.to_vec(), key_cmd("PTTL", src))])
        .collect();
    let mut replies = source.pipeline_keys(source_db, reads).await?.into_iter();
    let mut outcomes = Vec::with_capacity(moves.len());
    let mut writes = Vec::new();
    let mut pending = Vec::new();
    for (_, dst) in moves {
        let (Some(dump), Some(pttl)) = (replies.next(), replies.next()) else {
            return Err(AppError::internal("pipeline returned fewer replies than commands"));
        };
        let outcome = match (dump, pttl) {
            (Err(err), _) | (_, Err(err)) => Outcome::Failed(err.message),
            (Ok(dump), Ok(pttl)) => match bytes_of(dump) {
                None => Outcome::Skipped,
                Some(payload) => {
                    let mut cmd = key_cmd("RESTORE", dst);
                    cmd.arg(restore_ttl(int_of(&pttl).unwrap_or(-1))).arg(payload);
                    if replace {
                        cmd.arg("REPLACE");
                    }
                    writes.push((dst.to_vec(), cmd));
                    pending.push(outcomes.len());
                    Outcome::Done
                }
            },
        };
        outcomes.push(outcome);
    }
    if !writes.is_empty() {
        for (index, result) in pending.into_iter().zip(target.pipeline_keys(target_db, writes).await?) {
            outcomes[index] = match result {
                Ok(_) => Outcome::Done,
                Err(err) if is_busy_key(&err) => Outcome::Skipped,
                Err(err) => Outcome::Failed(err.message),
            };
        }
    }
    Ok(outcomes)
}

/// PTTL → RESTORE ttl: süresiz 0, süreli en az 1 ms (0 RESTORE'da "süresiz" demektir)
pub(crate) fn restore_ttl(pttl: i64) -> i64 {
    if pttl >= 0 {
        pttl.max(1)
    } else {
        0
    }
}

/// Başarıyla kopyalananların kaynağını siler; silinemeyen hata olur
pub(crate) async fn remove_sources(
    session: &Session,
    db: u32,
    keys: &[Vec<u8>],
    outcomes: &mut [Outcome],
) -> AppResult<()> {
    let done: Vec<usize> = (0..keys.len()).filter(|&i| matches!(outcomes[i], Outcome::Done)).collect();
    if done.is_empty() {
        return Ok(());
    }
    let name = unlink_name(session);
    let items = done.iter().map(|&i| (keys[i].clone(), key_cmd(name, &keys[i]))).collect();
    for (index, reply) in done.into_iter().zip(session.pipeline_keys(db, items).await?) {
        if let Err(err) = reply {
            outcomes[index] = Outcome::Failed(format!("copied, but the source was not deleted: {}", err.message));
        }
    }
    Ok(())
}
