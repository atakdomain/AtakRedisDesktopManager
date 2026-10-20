//! Cluster slot tablosu: `CLUSTER SLOTS` ayrıştırma, CRC16 (XMODEM) ve hash tag.

use super::NodeAddr;
use crate::model::NodeInfo;
use redis::Value;

pub const SLOT_COUNT: usize = 16384;
const UNASSIGNED: u16 = u16::MAX;

pub fn crc16(data: &[u8]) -> u16 {
    let mut crc: u16 = 0;
    for &byte in data {
        crc ^= u16::from(byte) << 8;
        for _ in 0..8 {
            crc = if crc & 0x8000 != 0 { (crc << 1) ^ 0x1021 } else { crc << 1 };
        }
    }
    crc
}

/// `{…}` içi boş değilse yalnızca o kısım hash'lenir
pub fn key_slot(key: &[u8]) -> u16 {
    let hashed = key
        .iter()
        .position(|&b| b == b'{')
        .and_then(|open| {
            let rest = &key[open + 1..];
            rest.iter().position(|&b| b == b'}').filter(|&close| close > 0).map(|close| &rest[..close])
        })
        .unwrap_or(key);
    crc16(hashed) % SLOT_COUNT as u16
}

pub struct Shard {
    pub master: NodeAddr,
    pub replicas: Vec<NodeAddr>,
    pub ranges: Vec<(u16, u16)>,
}

pub struct SlotTable {
    shards: Vec<Shard>,
    owner: Vec<u16>,
}

impl Default for SlotTable {
    fn default() -> Self {
        SlotTable { shards: Vec::new(), owner: vec![UNASSIGNED; SLOT_COUNT] }
    }
}

impl SlotTable {
    /// `asked`: yanıtı veren düğüm; boş/"?" host onun host'uyla doldurulur
    pub fn parse(reply: &Value, asked: &NodeAddr) -> Option<SlotTable> {
        let Value::Array(ranges) = reply else { return None };
        let mut table = SlotTable::default();
        for range in ranges {
            let Value::Array(parts) = range else { return None };
            let (Some(start), Some(end)) = (parts.first().and_then(as_int), parts.get(1).and_then(as_int)) else {
                return None;
            };
            let mut nodes = parts.iter().skip(2).filter_map(|n| node_of(n, asked));
            let master = nodes.next()?;
            let replicas: Vec<_> = nodes.collect();
            table.assign(start as u16, end as u16, master, replicas);
        }
        table.shards.sort_by_key(|s| s.ranges.iter().map(|r| r.0).min());
        let mut owner = vec![UNASSIGNED; SLOT_COUNT];
        for (index, shard) in table.shards.iter().enumerate() {
            for &(start, end) in &shard.ranges {
                for slot in start..=end.min(SLOT_COUNT as u16 - 1) {
                    owner[slot as usize] = index as u16;
                }
            }
        }
        table.owner = owner;
        Some(table)
    }

    fn assign(&mut self, start: u16, end: u16, master: NodeAddr, replicas: Vec<NodeAddr>) {
        match self.shards.iter_mut().find(|s| s.master == master) {
            Some(shard) => shard.ranges.push((start, end)),
            None => self.shards.push(Shard { master, replicas, ranges: vec![(start, end)] }),
        }
    }

    pub fn master_for(&self, slot: u16) -> Option<&NodeAddr> {
        let index = *self.owner.get(slot as usize)?;
        self.shards.get(index as usize).map(|s| &s.master)
    }

    /// MOVED ile öğrenilen sahibi tablo yenilenene dek kullanılır
    pub fn set_owner(&mut self, slot: u16, master: NodeAddr) {
        let index = match self.shards.iter().position(|s| s.master == master) {
            Some(index) => index,
            None => {
                self.shards.push(Shard { master, replicas: Vec::new(), ranges: Vec::new() });
                self.shards.len() - 1
            }
        };
        if let Some(owner) = self.owner.get_mut(slot as usize) {
            *owner = index as u16;
        }
    }

    pub fn masters(&self) -> Vec<NodeAddr> {
        self.shards.iter().filter(|s| !s.ranges.is_empty()).map(|s| s.master.clone()).collect()
    }

    pub fn nodes(&self) -> Vec<NodeInfo> {
        let mut nodes = Vec::new();
        for shard in &self.shards {
            let slots = shard
                .ranges
                .iter()
                .map(|&(a, b)| if a == b { a.to_string() } else { format!("{a}-{b}") })
                .collect::<Vec<_>>()
                .join(",");
            nodes.push(NodeInfo { addr: shard.master.to_string(), role: "master".into(), slots: slots.clone() });
            for replica in &shard.replicas {
                nodes.push(NodeInfo { addr: replica.to_string(), role: "replica".into(), slots: slots.clone() });
            }
        }
        nodes
    }
}

fn as_int(value: &Value) -> Option<i64> {
    match value {
        Value::Int(n) => Some(*n),
        _ => None,
    }
}

fn node_of(value: &Value, asked: &NodeAddr) -> Option<NodeAddr> {
    let Value::Array(parts) = value else { return None };
    let host = match parts.first()? {
        Value::BulkString(bytes) => String::from_utf8_lossy(bytes).into_owned(),
        Value::SimpleString(s) => s.clone(),
        _ => return None,
    };
    let port = as_int(parts.get(1)?)?;
    let host = if host.is_empty() || host == "?" { asked.host.clone() } else { host };
    Some(NodeAddr { host, port: port as u16 })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn crc16_matches_reference() {
        assert_eq!(crc16(b"123456789"), 0x31C3);
        assert_eq!(key_slot(b"foo"), 12182);
        assert_eq!(key_slot(b"{user1000}.following"), key_slot(b"{user1000}.followers"));
        assert_eq!(key_slot(b"foo{}{bar}"), crc16(b"foo{}{bar}") % 16384);
        assert_eq!(key_slot(b"foo{{bar}}zap"), crc16(b"{bar") % 16384);
        assert_eq!(key_slot(b"foo{bar}{zap}"), crc16(b"bar") % 16384);
    }

    #[test]
    fn parses_cluster_slots() {
        let node = |host: &str, port: i64| Value::Array(vec![Value::BulkString(host.into()), Value::Int(port), Value::BulkString(b"id".to_vec())]);
        let reply = Value::Array(vec![
            Value::Array(vec![Value::Int(5461), Value::Int(16383), node("10.0.0.2", 7002), node("10.0.0.3", 7003)]),
            Value::Array(vec![Value::Int(0), Value::Int(5460), node("", 7001)]),
        ]);
        let asked = NodeAddr { host: "seed".into(), port: 7001 };
        let table = SlotTable::parse(&reply, &asked).unwrap();
        assert_eq!(table.master_for(0).unwrap().to_string(), "seed:7001");
        assert_eq!(table.master_for(16383).unwrap().to_string(), "10.0.0.2:7002");
        assert_eq!(table.masters().len(), 2);
        let nodes = table.nodes();
        assert_eq!(nodes[0].slots, "0-5460");
        assert_eq!(nodes[2].role, "replica");
    }
}
