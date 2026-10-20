//! Değer düzenleyicilerinin işlemleri: string, hash, list, set, zset, stream, ReJSON.

use super::{reply, Session};
use crate::bytes::RBytes;
use crate::error::{AppError, AppResult};
use crate::model::{HashEntry, HashPage, KeyFilter, ListPage, SetPage, StreamEntry, StreamGroup, StreamPage, StringValue, ZEntry, ZSetPage};
use crate::pattern::CompiledFilter;
use redis::{cmd, Value};
use std::collections::HashSet;

const DEFAULT_COUNT: u32 = 100;

fn page_size(count: u32) -> u32 {
    if count == 0 {
        DEFAULT_COUNT
    } else {
        count
    }
}

fn into_pairs(flat: Vec<Vec<u8>>) -> impl Iterator<Item = (Vec<u8>, Vec<u8>)> {
    let mut iter = flat.into_iter();
    std::iter::from_fn(move || Some((iter.next()?, iter.next()?)))
}

fn parse_score(raw: &[u8]) -> f64 {
    std::str::from_utf8(raw).ok().and_then(|s| s.parse().ok()).unwrap_or(0.0)
}

fn args(items: &[RBytes]) -> Vec<&[u8]> {
    items.iter().map(RBytes::as_slice).collect()
}

/// *SCAN sayfası
struct ScanPage {
    cursor: String,
    elements: Vec<Vec<u8>>,
    total: u64,
}

impl Session {
    // ── string ──

    pub async fn string_get(&self, db: u32, key: &[u8]) -> AppResult<StringValue> {
        let value: Option<Vec<u8>> = self.query_key(db, key, cmd("GET").arg(key)).await?;
        let value = value.ok_or_else(|| AppError::not_found("key does not exist"))?;
        Ok(StringValue { size: value.len() as u64, value: value.into() })
    }

    /// TTL korunur: 6.0+ `SET … KEEPTTL`, öncesinde MULTI içinde SET + PEXPIRE
    pub async fn string_set(&self, db: u32, key: &[u8], value: &[u8]) -> AppResult<()> {
        self.ensure_writable()?;
        if self.version_at_least(6, 0) {
            self.query_key::<Value>(db, key, cmd("SET").arg(key).arg(value).arg("KEEPTTL")).await?;
            return Ok(());
        }
        let ttl: i64 = self.query_key(db, key, cmd("PTTL").arg(key)).await?;
        let mut pipe = redis::pipe();
        pipe.cmd("SET").arg(key).arg(value);
        if ttl > 0 {
            pipe.cmd("PEXPIRE").arg(key).arg(ttl);
        }
        self.atomic_key(db, key, pipe).await?;
        Ok(())
    }

    // ── hash ──

    pub async fn hash_scan(&self, db: u32, key: &[u8], cursor: &str, filter: &KeyFilter, count: u32) -> AppResult<HashPage> {
        let filter = CompiledFilter::compile(filter)?;
        let page = self.scan_page(db, key, ("HSCAN", "HLEN"), cursor, &filter, count).await?;
        let items = into_pairs(page.elements)
            .filter(|(field, _)| filter.matches(field))
            .map(|(field, value)| HashEntry { field: field.into(), value: value.into() })
            .collect();
        Ok(HashPage { cursor: page.cursor, total: page.total, items })
    }

    /// `old_field` farklıysa alan yeniden adlandırılır (MULTI içinde HSET + HDEL)
    pub async fn hash_set(&self, db: u32, key: &[u8], field: &[u8], value: &[u8], old_field: Option<&[u8]>) -> AppResult<()> {
        self.ensure_writable()?;
        match old_field.filter(|old| *old != field) {
            Some(old) => {
                let mut pipe = redis::pipe();
                pipe.cmd("HSET").arg(key).arg(field).arg(value).cmd("HDEL").arg(key).arg(old);
                self.atomic_key(db, key, pipe).await?;
            }
            None => {
                self.query_key::<i64>(db, key, cmd("HSET").arg(key).arg(field).arg(value)).await?;
            }
        }
        Ok(())
    }

    pub async fn hash_delete(&self, db: u32, key: &[u8], fields: &[RBytes]) -> AppResult<u64> {
        self.ensure_writable()?;
        if fields.is_empty() {
            return Ok(0);
        }
        self.query_key(db, key, cmd("HDEL").arg(key).arg(args(fields))).await
    }

    // ── list ──

    pub async fn list_range(&self, db: u32, key: &[u8], start: i64, count: u32) -> AppResult<ListPage> {
        let stop = start + i64::from(page_size(count)) - 1;
        let items = vec![
            (key.to_vec(), cmd("LRANGE").arg(key).arg(start).arg(stop).clone()),
            (key.to_vec(), cmd("LLEN").arg(key).clone()),
        ];
        let mut replies = self.pipeline_keys(db, items).await?.into_iter();
        let elements: Vec<Vec<u8>> = redis::from_redis_value(next_reply(&mut replies)?)?;
        let total = reply::int(&next_reply(&mut replies)?).unwrap_or(0) as u64;
        Ok(ListPage { total, start, items: elements.into_iter().map(RBytes::from).collect() })
    }

    pub async fn list_set(&self, db: u32, key: &[u8], index: i64, value: &[u8]) -> AppResult<()> {
        self.ensure_writable()?;
        self.query_key::<Value>(db, key, cmd("LSET").arg(key).arg(index).arg(value)).await?;
        Ok(())
    }

    /// Yeni uzunluk
    pub async fn list_push(&self, db: u32, key: &[u8], values: &[RBytes], tail: bool) -> AppResult<u64> {
        self.ensure_writable()?;
        if values.is_empty() {
            return Err(AppError::invalid("nothing to push"));
        }
        let name = if tail { "RPUSH" } else { "LPUSH" };
        self.query_key(db, key, cmd(name).arg(key).arg(args(values))).await
    }

    /// Dizinler işaret değeriyle LSET'lenip LREM ile silinir; hepsi tek MULTI'de
    pub async fn list_delete(&self, db: u32, key: &[u8], indexes: &[i64]) -> AppResult<u64> {
        self.ensure_writable()?;
        if indexes.is_empty() {
            return Ok(0);
        }
        let tombstone = format!("__ardm_deleted_{}__", uuid::Uuid::new_v4());
        let mut pipe = redis::pipe();
        let mut seen = HashSet::new();
        for &index in indexes {
            if seen.insert(index) {
                pipe.cmd("LSET").arg(key).arg(index).arg(&tombstone);
            }
        }
        pipe.cmd("LREM").arg(key).arg(0).arg(&tombstone);
        let replies = reply::items(self.atomic_key(db, key, pipe).await?);
        Ok(replies.last().and_then(reply::int).unwrap_or(0) as u64)
    }

    // ── set ──

    pub async fn set_scan(&self, db: u32, key: &[u8], cursor: &str, filter: &KeyFilter, count: u32) -> AppResult<SetPage> {
        let filter = CompiledFilter::compile(filter)?;
        let page = self.scan_page(db, key, ("SSCAN", "SCARD"), cursor, &filter, count).await?;
        let items = page.elements.into_iter().filter(|m| filter.matches(m)).map(RBytes::from).collect();
        Ok(SetPage { cursor: page.cursor, total: page.total, items })
    }

    pub async fn set_add(&self, db: u32, key: &[u8], members: &[RBytes]) -> AppResult<u64> {
        self.ensure_writable()?;
        if members.is_empty() {
            return Ok(0);
        }
        self.query_key(db, key, cmd("SADD").arg(key).arg(args(members))).await
    }

    pub async fn set_delete(&self, db: u32, key: &[u8], members: &[RBytes]) -> AppResult<u64> {
        self.ensure_writable()?;
        if members.is_empty() {
            return Ok(0);
        }
        self.query_key(db, key, cmd("SREM").arg(key).arg(args(members))).await
    }

    pub async fn set_replace(&self, db: u32, key: &[u8], old_member: &[u8], new_member: &[u8]) -> AppResult<()> {
        self.ensure_writable()?;
        if old_member == new_member {
            return Ok(());
        }
        let mut pipe = redis::pipe();
        pipe.cmd("SREM").arg(key).arg(old_member).cmd("SADD").arg(key).arg(new_member);
        self.atomic_key(db, key, pipe).await?;
        Ok(())
    }

    // ── zset ──

    /// Sıra tabanlı sayfa (WITHSCORES); `desc` → ZREVRANGE
    pub async fn zset_range(&self, db: u32, key: &[u8], start: i64, count: u32, desc: bool) -> AppResult<ZSetPage> {
        let stop = start + i64::from(page_size(count)) - 1;
        let name = if desc { "ZREVRANGE" } else { "ZRANGE" };
        let items = vec![
            (key.to_vec(), cmd(name).arg(key).arg(start).arg(stop).arg("WITHSCORES").clone()),
            (key.to_vec(), cmd("ZCARD").arg(key).clone()),
        ];
        let mut replies = self.pipeline_keys(db, items).await?.into_iter();
        let flat: Vec<Vec<u8>> = redis::from_redis_value(next_reply(&mut replies)?)?;
        let total = reply::int(&next_reply(&mut replies)?).unwrap_or(0) as u64;
        let items = into_pairs(flat).map(|(member, score)| ZEntry { member: member.into(), score: parse_score(&score) }).collect();
        Ok(ZSetPage { cursor: String::new(), total, items })
    }

    pub async fn zset_scan(&self, db: u32, key: &[u8], cursor: &str, filter: &KeyFilter, count: u32) -> AppResult<ZSetPage> {
        let filter = CompiledFilter::compile(filter)?;
        let page = self.scan_page(db, key, ("ZSCAN", "ZCARD"), cursor, &filter, count).await?;
        let items = into_pairs(page.elements)
            .filter(|(member, _)| filter.matches(member))
            .map(|(member, score)| ZEntry { member: member.into(), score: parse_score(&score) })
            .collect();
        Ok(ZSetPage { cursor: page.cursor, total: page.total, items })
    }

    /// `old_member` farklıysa üye yeniden adlandırılır (MULTI içinde ZREM + ZADD)
    pub async fn zset_add(&self, db: u32, key: &[u8], member: &[u8], score: f64, old_member: Option<&[u8]>) -> AppResult<()> {
        self.ensure_writable()?;
        match old_member.filter(|old| *old != member) {
            Some(old) => {
                let mut pipe = redis::pipe();
                pipe.cmd("ZREM").arg(key).arg(old).cmd("ZADD").arg(key).arg(score).arg(member);
                self.atomic_key(db, key, pipe).await?;
            }
            None => {
                self.query_key::<i64>(db, key, cmd("ZADD").arg(key).arg(score).arg(member)).await?;
            }
        }
        Ok(())
    }

    pub async fn zset_delete(&self, db: u32, key: &[u8], members: &[RBytes]) -> AppResult<u64> {
        self.ensure_writable()?;
        if members.is_empty() {
            return Ok(0);
        }
        self.query_key(db, key, cmd("ZREM").arg(key).arg(args(members))).await
    }

    // ── stream ──

    /// Artan: XRANGE start end; azalan: XREVRANGE end start. Boş sınır "-" / "+".
    pub async fn stream_range(&self, db: u32, key: &[u8], start: &str, end: &str, count: u32, desc: bool) -> AppResult<StreamPage> {
        let start = if start.is_empty() { "-" } else { start };
        let end = if end.is_empty() { "+" } else { end };
        let mut range = if desc { cmd("XREVRANGE").arg(key).arg(end).arg(start).clone() } else { cmd("XRANGE").arg(key).arg(start).arg(end).clone() };
        range.arg("COUNT").arg(page_size(count));
        let items = vec![(key.to_vec(), range), (key.to_vec(), cmd("XLEN").arg(key).clone())];
        let mut replies = self.pipeline_keys(db, items).await?.into_iter();
        let entries = reply::items(next_reply(&mut replies)?).into_iter().map(stream_entry).collect();
        let total = reply::int(&next_reply(&mut replies)?).unwrap_or(0) as u64;
        Ok(StreamPage { total, items: entries })
    }

    /// Eklenen girdinin kimliği; `id` boşsa "*"
    pub async fn stream_add(&self, db: u32, key: &[u8], id: &str, fields: &[HashEntry]) -> AppResult<String> {
        self.ensure_writable()?;
        if fields.is_empty() {
            return Err(AppError::invalid("a stream entry needs at least one field"));
        }
        let mut xadd = cmd("XADD");
        xadd.arg(key).arg(if id.is_empty() { "*" } else { id });
        for entry in fields {
            xadd.arg(entry.field.as_slice()).arg(entry.value.as_slice());
        }
        self.query_key(db, key, &xadd).await
    }

    pub async fn stream_delete(&self, db: u32, key: &[u8], ids: &[String]) -> AppResult<u64> {
        self.ensure_writable()?;
        if ids.is_empty() {
            return Ok(0);
        }
        self.query_key(db, key, cmd("XDEL").arg(key).arg(ids)).await
    }

    pub async fn stream_groups(&self, db: u32, key: &[u8]) -> AppResult<Vec<StreamGroup>> {
        let groups: Value = self.query_key(db, key, cmd("XINFO").arg("GROUPS").arg(key)).await?;
        Ok(reply::items(groups).into_iter().map(stream_group).collect())
    }

    // ── ReJSON ──

    pub async fn json_get(&self, db: u32, key: &[u8]) -> AppResult<String> {
        let json: Option<String> = self.query_key(db, key, cmd("JSON.GET").arg(key)).await?;
        json.ok_or_else(|| AppError::not_found("key does not exist"))
    }

    pub async fn json_set(&self, db: u32, key: &[u8], value: &str) -> AppResult<()> {
        self.ensure_writable()?;
        self.query_key::<Value>(db, key, cmd("JSON.SET").arg(key).arg("$").arg(value)).await?;
        Ok(())
    }

    /// Tek *SCAN adımı + toplam; sunucu imleci 0 ise `cursor` boş
    async fn scan_page(&self, db: u32, key: &[u8], (scan, len): (&str, &str), cursor: &str, filter: &CompiledFilter, count: u32) -> AppResult<ScanPage> {
        let mut scan = cmd(scan);
        scan.arg(key).arg(if cursor.is_empty() { "0" } else { cursor });
        if !filter.is_match_all() {
            scan.arg("MATCH").arg(filter.server_pattern());
        }
        scan.arg("COUNT").arg(page_size(count));
        let items = vec![(key.to_vec(), scan), (key.to_vec(), cmd(len).arg(key).clone())];
        let mut replies = self.pipeline_keys(db, items).await?.into_iter();
        let (next, elements): (String, Vec<Vec<u8>>) = redis::from_redis_value(next_reply(&mut replies)?)?;
        let total = reply::int(&next_reply(&mut replies)?).unwrap_or(0) as u64;
        let cursor = if next == "0" { String::new() } else { next };
        Ok(ScanPage { cursor, elements, total })
    }
}

fn next_reply(replies: &mut impl Iterator<Item = AppResult<Value>>) -> AppResult<Value> {
    replies.next().unwrap_or_else(|| Err(AppError::internal("missing reply")))
}

fn stream_entry(value: Value) -> StreamEntry {
    let mut parts = reply::items(value).into_iter();
    let id = parts.next().map(|v| reply::text(&v)).unwrap_or_default();
    let flat = parts.next().map(reply::items).unwrap_or_default().into_iter().map(reply::bytes).collect();
    let fields = into_pairs(flat).map(|(field, value)| HashEntry { field: field.into(), value: value.into() }).collect();
    StreamEntry { id, fields }
}

fn stream_group(value: Value) -> StreamGroup {
    let mut group = StreamGroup { name: String::new(), consumers: 0, pending: 0, last_delivered_id: String::new() };
    for (name, value) in reply::pairs(value) {
        match name.as_str() {
            "name" => group.name = reply::text(&value),
            "consumers" => group.consumers = reply::int(&value).unwrap_or(0) as u64,
            "pending" => group.pending = reply::int(&value).unwrap_or(0) as u64,
            "last-delivered-id" => group.last_delivered_id = reply::text(&value),
            _ => {}
        }
    }
    group
}
