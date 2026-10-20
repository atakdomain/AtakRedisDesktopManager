//! Anahtar düzeyi işlemler: tür/TTL, bilgi, oluşturma, silme, yeniden adlandırma, süre.

use super::{key_slot, reply, Session};
use crate::bytes::RBytes;
use crate::error::{AppError, AppResult, ErrorKind};
use crate::model::{KeyInfo, KeyMeta, NewKey};
use redis::{cmd, Cmd, Value};

impl Session {
    /// Görünen satırlar için TYPE + PTTL; anahtar başına sunucu hatası "none"/-2 olur
    pub async fn keys_meta(&self, db: u32, keys: Vec<RBytes>) -> AppResult<Vec<KeyMeta>> {
        let mut items = Vec::with_capacity(keys.len() * 2);
        for key in keys {
            let key = key.into_vec();
            items.push((key.clone(), cmd("TYPE").arg(&key).clone()));
            items.push((key.clone(), cmd("PTTL").arg(&key).clone()));
        }
        let mut replies = self.pipeline_keys(db, items).await?.into_iter();
        let mut metas = Vec::with_capacity(replies.len() / 2);
        while let (Some(key_type), Some(ttl)) = (replies.next(), replies.next()) {
            metas.push(KeyMeta {
                key_type: tolerate(key_type)?.map_or_else(|| "none".into(), |v| reply::text(&v)),
                ttl: tolerate(ttl)?.and_then(|v| reply::int(&v)).unwrap_or(-2),
            });
        }
        Ok(metas)
    }

    pub async fn key_info(&self, db: u32, key: &[u8]) -> AppResult<KeyInfo> {
        let items = vec![
            (key.to_vec(), cmd("TYPE").arg(key).clone()),
            (key.to_vec(), cmd("PTTL").arg(key).clone()),
            (key.to_vec(), cmd("MEMORY").arg("USAGE").arg(key).clone()),
            (key.to_vec(), cmd("OBJECT").arg("ENCODING").arg(key).clone()),
        ];
        let mut replies = self.pipeline_keys(db, items).await?.into_iter();
        let mut next = || replies.next().unwrap_or_else(|| Err(AppError::internal("missing reply")));
        let key_type = reply::text(&next()?);
        if key_type == "none" {
            return Err(AppError::not_found("key does not exist"));
        }
        let ttl = reply::int(&next()?).unwrap_or(-2);
        let memory = next().ok().and_then(|v| reply::int(&v)).map(|n| n as u64);
        let encoding = next().map(|v| reply::text(&v)).unwrap_or_default();
        let length = match length_command(&key_type) {
            Some(name) => self.query_key(db, key, cmd(name).arg(key)).await?,
            None => 0,
        };
        Ok(KeyInfo { key_type, ttl, length, memory, encoding })
    }

    pub async fn key_create(&self, db: u32, spec: NewKey) -> AppResult<()> {
        self.ensure_writable()?;
        let key = spec.key.as_slice();
        if key.is_empty() {
            return Err(AppError::invalid("key name is empty"));
        }
        if spec.key_type == "string" {
            // SET NX tek komutta hem varlık denetimi hem süre
            let mut set = cmd("SET");
            set.arg(key).arg(spec.value.as_slice()).arg("NX");
            if spec.ttl_ms > 0 {
                set.arg("PX").arg(spec.ttl_ms);
            }
            return match self.query_key::<Value>(db, key, &set).await? {
                Value::Nil => Err(key_exists()),
                _ => Ok(()),
            };
        }
        let create = create_command(&spec)?;
        if self.query_key::<bool>(db, key, cmd("EXISTS").arg(key)).await? {
            return Err(key_exists());
        }
        let mut pipe = redis::pipe();
        pipe.add_command(create);
        if spec.ttl_ms > 0 {
            pipe.cmd("PEXPIRE").arg(key).arg(spec.ttl_ms);
        }
        self.atomic_key(db, key, pipe).await?;
        Ok(())
    }

    /// UNLINK (4.0 öncesi DEL); silinen sayısı
    pub async fn key_delete(&self, db: u32, keys: Vec<RBytes>) -> AppResult<u64> {
        self.ensure_writable()?;
        let name = if self.version_at_least(4, 0) { "UNLINK" } else { "DEL" };
        let items = keys
            .into_iter()
            .map(|key| {
                let key = key.into_vec();
                let delete = cmd(name).arg(&key).clone();
                (key, delete)
            })
            .collect();
        let mut deleted = 0;
        for result in self.pipeline_keys(db, items).await? {
            deleted += reply::int(&result?).unwrap_or(0) as u64;
        }
        Ok(deleted)
    }

    pub async fn key_rename(&self, db: u32, key: &[u8], new_key: &[u8], overwrite: bool) -> AppResult<()> {
        self.ensure_writable()?;
        if key == new_key {
            return Ok(());
        }
        if self.is_cluster() && key_slot(key) != key_slot(new_key) {
            return self.move_key_across_slots(key, new_key, overwrite).await;
        }
        if overwrite {
            self.query_key::<Value>(db, key, cmd("RENAME").arg(key).arg(new_key)).await?;
        } else if !self.query_key::<bool>(db, key, cmd("RENAMENX").arg(key).arg(new_key)).await? {
            return Err(key_exists());
        }
        Ok(())
    }

    /// Cluster'da farklı slotlar: DUMP + PTTL → RESTORE → DEL
    async fn move_key_across_slots(&self, key: &[u8], new_key: &[u8], overwrite: bool) -> AppResult<()> {
        if !overwrite && self.query_key::<bool>(0, new_key, cmd("EXISTS").arg(new_key)).await? {
            return Err(key_exists());
        }
        let items = vec![(key.to_vec(), cmd("DUMP").arg(key).clone()), (key.to_vec(), cmd("PTTL").arg(key).clone())];
        let mut replies = self.pipeline_keys(0, items).await?.into_iter();
        let dump = match replies.next().transpose()? {
            Some(Value::BulkString(dump)) => dump,
            _ => return Err(AppError::not_found("key does not exist")),
        };
        let ttl = replies.next().transpose()?.and_then(|v| reply::int(&v)).unwrap_or(0).max(0);
        let mut restore = cmd("RESTORE");
        restore.arg(new_key).arg(ttl).arg(dump);
        if overwrite {
            restore.arg("REPLACE");
        }
        match self.query_key::<Value>(0, new_key, &restore).await {
            Err(err) if err.message.starts_with("BUSYKEY") => return Err(key_exists()),
            other => other?,
        };
        self.query_key::<i64>(0, key, cmd("DEL").arg(key)).await?;
        Ok(())
    }

    /// `ttl_ms` <= 0 → PERSIST
    pub async fn key_expire(&self, db: u32, key: &[u8], ttl_ms: i64) -> AppResult<()> {
        self.ensure_writable()?;
        if ttl_ms <= 0 {
            self.query_key::<i64>(db, key, cmd("PERSIST").arg(key)).await?;
        } else if !self.query_key::<bool>(db, key, cmd("PEXPIRE").arg(key).arg(ttl_ms)).await? {
            return Err(AppError::not_found("key does not exist"));
        }
        Ok(())
    }
}

fn key_exists() -> AppError {
    AppError::exists("key already exists")
}

/// Bağlantı hataları geçer; anahtara özgü sunucu hatası `None` olur
fn tolerate(result: AppResult<Value>) -> AppResult<Option<Value>> {
    match result {
        Ok(value) => Ok(Some(value)),
        Err(err) if matches!(err.kind, ErrorKind::Redis | ErrorKind::Auth) => Ok(None),
        Err(err) => Err(err),
    }
}

fn length_command(key_type: &str) -> Option<&'static str> {
    Some(match key_type {
        "string" => "STRLEN",
        "hash" => "HLEN",
        "list" => "LLEN",
        "set" => "SCARD",
        "zset" => "ZCARD",
        "stream" => "XLEN",
        _ => return None,
    })
}

fn create_command(spec: &NewKey) -> AppResult<Cmd> {
    let key = spec.key.as_slice();
    let value = spec.value.as_slice();
    Ok(match spec.key_type.as_str() {
        "hash" => cmd("HSET").arg(key).arg(spec.field.as_slice()).arg(value).clone(),
        "list" => cmd("RPUSH").arg(key).arg(value).clone(),
        "set" => cmd("SADD").arg(key).arg(value).clone(),
        "zset" => cmd("ZADD").arg(key).arg(spec.score).arg(value).clone(),
        "ReJSON-RL" => cmd("JSON.SET").arg(key).arg("$").arg(value).clone(),
        "stream" => {
            if spec.entries.is_empty() {
                return Err(AppError::invalid("a stream entry needs at least one field"));
            }
            let id = if spec.stream_id.is_empty() { "*" } else { spec.stream_id.as_str() };
            let mut xadd = cmd("XADD");
            xadd.arg(key).arg(id);
            for entry in &spec.entries {
                xadd.arg(entry.field.as_slice()).arg(entry.value.as_slice());
            }
            xadd
        }
        other => return Err(AppError::invalid(format!("unsupported key type: {other}"))),
    })
}
