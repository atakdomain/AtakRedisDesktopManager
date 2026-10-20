//! Sunucu paneli ve oturum özetleri: INFO, SLOWLOG, CLIENT LIST, CONFIG, veritabanı listesi, bağlantı testi.

use super::{reply, Lane, Route, Session};
use crate::bytes::RBytes;
use crate::error::AppResult;
use crate::model::{ConfigItem, DbInfo, SlowlogEntry, TestResult};
use redis::{cmd, Value};
use std::time::Instant;

impl Session {
    pub async fn server_info(&self, node: &str) -> AppResult<String> {
        self.query_node(node, self.home_db(), &cmd("INFO")).await
    }

    pub async fn server_slowlog(&self, node: &str, count: u32) -> AppResult<Vec<SlowlogEntry>> {
        let entries: Value = self.query_node(node, self.home_db(), cmd("SLOWLOG").arg("GET").arg(count)).await?;
        Ok(reply::items(entries).into_iter().map(slowlog_entry).collect())
    }

    /// Konsoldaki salt okunur kuralıyla aynı: SLOWLOG RESET de engellenir
    pub async fn server_slowlog_reset(&self, node: &str) -> AppResult<()> {
        self.ensure_writable()?;
        self.query_node::<Value>(node, self.home_db(), cmd("SLOWLOG").arg("RESET")).await?;
        Ok(())
    }

    pub async fn server_clients(&self, node: &str) -> AppResult<String> {
        self.query_node(node, self.home_db(), cmd("CLIENT").arg("LIST")).await
    }

    /// Ada göre sıralı; boş desen "*"
    pub async fn server_config(&self, node: &str, pattern: &str) -> AppResult<Vec<ConfigItem>> {
        let pattern = if pattern.is_empty() { "*" } else { pattern };
        let reply: Value = self.query_node(node, self.home_db(), cmd("CONFIG").arg("GET").arg(pattern)).await?;
        let mut items: Vec<ConfigItem> = reply::pairs(reply).into_iter().map(|(name, value)| ConfigItem { name, value: reply::text(&value) }).collect();
        items.sort_by(|a, b| a.name.cmp(&b.name));
        Ok(items)
    }

    pub async fn server_config_set(&self, node: &str, name: &str, value: &str) -> AppResult<()> {
        self.ensure_writable()?;
        self.query_node::<Value>(node, self.home_db(), cmd("CONFIG").arg("SET").arg(name).arg(value)).await?;
        Ok(())
    }

    /// 0..db_count, `INFO keyspace`'te olmayanlar sıfır; cluster'da tüm master'ların toplamı
    pub async fn db_list(&self) -> AppResult<Vec<DbInfo>> {
        let mut dbs: Vec<DbInfo> = (0..self.db_count).map(|index| DbInfo { index, keys: 0, expires: 0 }).collect();
        let nodes = self.scan_nodes().await?;
        let infos = futures_util::future::join_all(nodes.into_iter().map(|node| async move {
            self.query_raw(self.home_db(), Lane::Main, &Route::Node(node), cmd("INFO").arg("keyspace")).await
        }))
        .await;
        for info in infos {
            for (index, keys, expires) in parse_keyspace(&reply::text(&info?)) {
                if let Some(db) = dbs.get_mut(index as usize) {
                    db.keys += keys;
                    db.expires += expires;
                }
            }
        }
        Ok(dbs)
    }

    /// Bağlantı testi: PING gecikmesi + INFO özeti
    pub async fn test(&self) -> AppResult<TestResult> {
        let started = Instant::now();
        self.query_node::<String>("", self.home_db(), &cmd("PING")).await?;
        let latency_ms = started.elapsed().as_secs_f64() * 1000.0;
        let info: String = self.query_node("", self.home_db(), &cmd("INFO")).await?;
        let field = |name: &str| reply::info_field(&info, name).unwrap_or_default().to_string();
        let role = match field("role").as_str() {
            "slave" => "replica".to_string(),
            role => role.to_string(),
        };
        Ok(TestResult { latency_ms, server_version: field("redis_version"), redis_mode: field("redis_mode"), role })
    }
}

/// "db0:keys=3,expires=1,avg_ttl=0"
fn parse_keyspace(info: &str) -> Vec<(u32, u64, u64)> {
    info.lines()
        .filter_map(|line| {
            let (db, stats) = line.trim().strip_prefix("db")?.split_once(':')?;
            let stat = |name: &str| {
                stats.split(',').find_map(|kv| kv.strip_prefix(name)?.strip_prefix('=')?.parse().ok()).unwrap_or(0)
            };
            Some((db.parse().ok()?, stat("keys"), stat("expires")))
        })
        .collect()
}

fn slowlog_entry(value: Value) -> SlowlogEntry {
    let mut parts = reply::items(value).into_iter();
    let mut next_int = || parts.next().and_then(|v| reply::int(&v)).unwrap_or(0);
    let id = next_int() as u64;
    let timestamp = next_int();
    let duration_us = next_int() as u64;
    let args = parts.next().map(reply::items).unwrap_or_default().into_iter().map(|v| RBytes::from(reply::bytes(v))).collect();
    let client = parts.next().map(|v| reply::text(&v)).unwrap_or_default();
    let client_name = parts.next().map(|v| reply::text(&v)).unwrap_or_default();
    SlowlogEntry { id, timestamp, duration_us, args, client, client_name }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::BTreeMap;

    #[test]
    fn parses_keyspace() {
        let info = "# Keyspace\r\ndb0:keys=3,expires=1,avg_ttl=0\r\ndb12:keys=7,expires=0,avg_ttl=0\r\n";
        let mut totals: BTreeMap<u32, (u64, u64)> = BTreeMap::new();
        for (db, keys, expires) in parse_keyspace(info) {
            totals.insert(db, (keys, expires));
        }
        assert_eq!(totals[&0], (3, 1));
        assert_eq!(totals[&12], (7, 0));
    }
}
