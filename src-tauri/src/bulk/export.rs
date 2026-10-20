//! Dışa aktarma. `dump`: JSON Lines, satır başına {key, type, ttl, dump(base64)}; `json`: okunabilir JSON dizisi
//! {key, type, ttl, value}. Dosyaya parça parça akar; bellekte yalnızca o anki parça durur.

use super::{bytes_of, int_of, key_cmd, note, Job, Outcome};
use crate::bytes::RBytes;
use crate::error::{AppError, AppResult};
use crate::model::{ExportFormat, HashEntry};
use base64::engine::general_purpose::STANDARD;
use base64::Engine;
use redis::Value;
use serde::{Deserialize, Serialize};
use tokio::io::{AsyncWriteExt, BufWriter};

#[derive(Serialize, Deserialize, Debug, PartialEq)]
pub(crate) struct DumpRecord {
    pub key: RBytes,
    #[serde(rename = "type")]
    pub key_type: String,
    /// ms; -1 süresiz
    pub ttl: i64,
    pub dump: String,
}

#[derive(Serialize)]
pub(crate) struct JsonRecord {
    pub key: RBytes,
    #[serde(rename = "type")]
    pub key_type: String,
    pub ttl: i64,
    pub value: KeyValue,
}

#[derive(Serialize, Debug)]
#[serde(untagged)]
pub(crate) enum KeyValue {
    String(RBytes),
    Hash(Vec<HashEntry>),
    List(Vec<RBytes>),
    Set(Vec<RBytes>),
    ZSet(Vec<ZItem>),
    Stream(Vec<StreamItem>),
    /// ReJSON-RL: JSON metni
    Json(String),
}

#[derive(Serialize, Deserialize, Debug, PartialEq)]
pub(crate) struct ZItem {
    pub member: RBytes,
    #[serde(with = "score")]
    pub score: f64,
}

#[derive(Serialize, Deserialize, Debug)]
pub(crate) struct StreamItem {
    pub id: String,
    pub fields: Vec<HashEntry>,
}

/// ±inf JSON sayısı olamaz; "inf" / "-inf" metni olarak yazılır
mod score {
    use serde::{de, Deserialize, Deserializer, Serializer};

    pub fn serialize<S: Serializer>(score: &f64, serializer: S) -> Result<S::Ok, S::Error> {
        if score.is_finite() {
            serializer.serialize_f64(*score)
        } else {
            serializer.serialize_str(if *score > 0.0 { "inf" } else { "-inf" })
        }
    }

    pub fn deserialize<'de, D: Deserializer<'de>>(deserializer: D) -> Result<f64, D::Error> {
        #[derive(Deserialize)]
        #[serde(untagged)]
        enum Score {
            Number(f64),
            Text(String),
        }
        match Score::deserialize(deserializer)? {
            Score::Number(n) => Ok(n),
            Score::Text(t) => t.parse().map_err(|_| de::Error::custom(format!("invalid score {t:?}"))),
        }
    }
}

impl KeyValue {
    pub fn is_empty(&self) -> bool {
        match self {
            KeyValue::String(_) | KeyValue::Json(_) => false,
            KeyValue::Hash(v) => v.is_empty(),
            KeyValue::List(v) | KeyValue::Set(v) => v.is_empty(),
            KeyValue::ZSet(v) => v.is_empty(),
            KeyValue::Stream(v) => v.is_empty(),
        }
    }

    /// İçe aktarmada `type` alanına göre çözümleme
    pub fn parse(key_type: &str, value: serde_json::Value) -> Result<KeyValue, String> {
        use serde_json::from_value;
        let parsed = match key_type {
            "string" => from_value(value).map(KeyValue::String),
            "hash" => from_value(value).map(KeyValue::Hash),
            "list" => from_value(value).map(KeyValue::List),
            "set" => from_value(value).map(KeyValue::Set),
            "zset" => from_value(value).map(KeyValue::ZSet),
            "stream" => from_value(value).map(KeyValue::Stream),
            "ReJSON-RL" => from_value(value).map(KeyValue::Json),
            other => return Err(format!("unsupported type {other:?}")),
        };
        parsed.map_err(|e| format!("{key_type} value: {e}"))
    }
}

/// Sunucu yanıtından JSON değeri; yazılamayan tipte Err
fn key_value(key_type: &str, reply: Value) -> Result<KeyValue, String> {
    let bytes = |v: Value| RBytes(bytes_of(v).unwrap_or_default());
    let entry = |pair: &mut dyn Iterator<Item = Value>| HashEntry {
        field: bytes(pair.next().unwrap_or_default()),
        value: bytes(pair.next().unwrap_or_default()),
    };
    Ok(match key_type {
        "string" => KeyValue::String(bytes(reply)),
        "ReJSON-RL" => KeyValue::Json(text_of(reply)),
        "list" => KeyValue::List(items(reply).into_iter().map(bytes).collect()),
        "set" => KeyValue::Set(items(reply).into_iter().map(bytes).collect()),
        "hash" => {
            let mut flat = flatten(reply).into_iter();
            let mut out = Vec::new();
            while flat.len() > 0 {
                out.push(entry(&mut flat));
            }
            KeyValue::Hash(out)
        }
        "zset" => {
            let mut flat = flatten(reply).into_iter();
            let mut out = Vec::new();
            while let (Some(member), Some(score)) = (flat.next(), flat.next()) {
                out.push(ZItem { member: bytes(member), score: score_of(score)? });
            }
            KeyValue::ZSet(out)
        }
        "stream" => KeyValue::Stream(
            items(reply)
                .into_iter()
                .map(|entry_reply| {
                    let mut parts = items(entry_reply).into_iter();
                    let id = text_of(parts.next().unwrap_or_default());
                    let mut flat = flatten(parts.next().unwrap_or_default()).into_iter();
                    let mut fields = Vec::new();
                    while flat.len() > 0 {
                        fields.push(entry(&mut flat));
                    }
                    StreamItem { id, fields }
                })
                .collect(),
        ),
        other => return Err(no_json_form(other)),
    })
}

fn no_json_form(key_type: &str) -> String {
    format!("type {key_type} has no JSON form; export it in dump format")
}

fn text_of(value: Value) -> String {
    String::from_utf8_lossy(&bytes_of(value).unwrap_or_default()).into_owned()
}

fn items(value: Value) -> Vec<Value> {
    match value {
        Value::Array(items) | Value::Set(items) => items,
        Value::Map(pairs) => pairs.into_iter().flat_map(|(k, v)| [k, v]).collect(),
        Value::Nil => Vec::new(),
        other => vec![other],
    }
}

/// RESP2 düz dizi ya da RESP3 çift dizisi/haritası → düz dizi
fn flatten(value: Value) -> Vec<Value> {
    items(value)
        .into_iter()
        .flat_map(|item| match item {
            Value::Array(inner) => inner,
            other => vec![other],
        })
        .collect()
}

fn score_of(value: Value) -> Result<f64, String> {
    if let Value::Double(score) = value {
        return Ok(score);
    }
    let text = bytes_of(value).unwrap_or_default();
    let text = String::from_utf8_lossy(&text);
    text.parse().map_err(|_| format!("invalid score {text:?}"))
}

/// JSON metninde sorgu komutu; tipe göre
fn fetch_cmd(key_type: &str, key: &[u8]) -> Option<redis::Cmd> {
    let cmd = match key_type {
        "string" => key_cmd("GET", key),
        "hash" => key_cmd("HGETALL", key),
        "list" => {
            let mut cmd = key_cmd("LRANGE", key);
            cmd.arg(0).arg(-1);
            cmd
        }
        "set" => key_cmd("SMEMBERS", key),
        "zset" => {
            let mut cmd = key_cmd("ZRANGE", key);
            cmd.arg(0).arg(-1).arg("WITHSCORES");
            cmd
        }
        "stream" => {
            let mut cmd = key_cmd("XRANGE", key);
            cmd.arg("-").arg("+");
            cmd
        }
        "ReJSON-RL" => key_cmd("JSON.GET", key),
        _ => return None,
    };
    Some(cmd)
}

pub(crate) struct Exporter {
    path: String,
    format: ExportFormat,
    /// Dry run'da dosya açılmaz
    out: Option<BufWriter<tokio::fs::File>>,
    written: u64,
}

impl Exporter {
    pub async fn create(path: &str, format: ExportFormat, dry_run: bool) -> AppResult<Exporter> {
        if path.is_empty() {
            return Err(AppError::invalid("export path is empty"));
        }
        let mut out = None;
        if !dry_run {
            let mut file = BufWriter::new(tokio::fs::File::create(path).await?);
            if format == ExportFormat::Json {
                file.write_all(b"[\n").await?;
            }
            out = Some(file);
        }
        Ok(Exporter { path: path.to_string(), format, out, written: 0 })
    }

    pub async fn process(&mut self, job: &mut Job<'_>, keys: Vec<Vec<u8>>) -> AppResult<()> {
        if self.out.is_none() {
            for key in keys {
                job.rep.plan(key, None, note::NONE);
            }
            return Ok(());
        }
        let meta = self.meta(job, &keys).await?;
        let lines = match self.format {
            ExportFormat::Dump => dump_lines(&keys, meta),
            ExportFormat::Json => json_lines(job, &keys, meta).await?,
        };
        let mut buffer = Vec::new();
        for (key, line) in keys.iter().zip(lines) {
            match line {
                Ok(Some(line)) => {
                    if self.format == ExportFormat::Json && self.written > 0 {
                        buffer.extend_from_slice(b",\n");
                    }
                    buffer.extend_from_slice(&line);
                    if self.format == ExportFormat::Dump {
                        buffer.push(b'\n');
                    }
                    self.written += 1;
                    job.rep.record(key, Outcome::Done);
                }
                Ok(None) => job.rep.record(key, Outcome::Skipped),
                Err(message) => job.rep.record(key, Outcome::Failed(message)),
            }
        }
        if let Some(out) = &mut self.out {
            out.write_all(&buffer).await?;
        }
        Ok(())
    }

    /// TYPE + PTTL (+ dump biçiminde DUMP) tek pipeline'da
    async fn meta(&self, job: &Job<'_>, keys: &[Vec<u8>]) -> AppResult<Vec<KeyMeta>> {
        let names: &[&str] = match self.format {
            ExportFormat::Dump => &["TYPE", "PTTL", "DUMP"],
            ExportFormat::Json => &["TYPE", "PTTL"],
        };
        let items = keys.iter().flat_map(|key| names.iter().map(|name| (key.clone(), key_cmd(name, key)))).collect();
        let mut replies = job.pipeline(items).await?.into_iter();
        let mut meta = Vec::with_capacity(keys.len());
        for _ in keys {
            let mut next = || replies.next().unwrap_or_else(|| Err(AppError::internal("missing pipeline reply")));
            let (key_type, ttl) = (next(), next());
            let dump = if self.format == ExportFormat::Dump { next().map(bytes_of) } else { Ok(None) };
            meta.push(match (key_type, ttl, dump) {
                (Ok(key_type), Ok(ttl), Ok(dump)) => {
                    Ok(Meta { key_type: text_of(key_type), ttl: int_of(&ttl).unwrap_or(-1).max(-1), dump })
                }
                (Err(e), _, _) | (_, Err(e), _) | (_, _, Err(e)) => Err(e.message),
            });
        }
        Ok(meta)
    }

    /// JSON dizisini kapatıp dosyayı boşaltır; dry run'da yol boş döner
    pub async fn finish(self) -> AppResult<String> {
        let Some(mut out) = self.out else { return Ok(String::new()) };
        if self.format == ExportFormat::Json {
            out.write_all(if self.written > 0 { b"\n]\n" } else { b"]\n" }).await?;
        }
        out.flush().await?;
        Ok(self.path)
    }
}

/// TYPE, PTTL (-1 süresiz) ve dump biçiminde DUMP yükü
struct Meta {
    key_type: String,
    ttl: i64,
    dump: Option<Vec<u8>>,
}

type KeyMeta = Result<Meta, String>;
/// Yazılacak satır; None = anahtar artık yok
type Line = Result<Option<Vec<u8>>, String>;

fn dump_lines(keys: &[Vec<u8>], meta: Vec<KeyMeta>) -> Vec<Line> {
    keys.iter()
        .zip(meta)
        .map(|(key, meta)| {
            let Meta { key_type, ttl, dump } = meta?;
            let Some(payload) = dump else { return Ok(None) };
            let record = DumpRecord { key: RBytes::from(key.as_slice()), key_type, ttl, dump: STANDARD.encode(payload) };
            serde_json::to_vec(&record).map(Some).map_err(|e| e.to_string())
        })
        .collect()
}

async fn json_lines(job: &Job<'_>, keys: &[Vec<u8>], meta: Vec<KeyMeta>) -> AppResult<Vec<Line>> {
    let mut fetches = Vec::new();
    let mut lines: Vec<Line> = Vec::with_capacity(keys.len());
    let mut pending = Vec::new();
    for (index, (key, meta)) in keys.iter().zip(&meta).enumerate() {
        lines.push(match meta {
            Err(message) => Err(message.clone()),
            Ok(Meta { key_type, .. }) if key_type == "none" || key_type.is_empty() => Ok(None),
            Ok(Meta { key_type, .. }) => match fetch_cmd(key_type, key) {
                Some(cmd) => {
                    fetches.push((key.clone(), cmd));
                    pending.push(index);
                    Ok(None)
                }
                None => Err(no_json_form(key_type)),
            },
        });
    }
    if fetches.is_empty() {
        return Ok(lines);
    }
    for (index, reply) in pending.into_iter().zip(job.pipeline(fetches).await?) {
        let Ok(Meta { key_type, ttl, .. }) = &meta[index] else { continue };
        lines[index] = match reply {
            Err(err) => Err(err.message),
            Ok(Value::Nil) => Ok(None),
            Ok(reply) => key_value(key_type, reply).and_then(|value| {
                let key = RBytes::from(keys[index].as_slice());
                let record = JsonRecord { key, key_type: key_type.clone(), ttl: *ttl, value };
                serde_json::to_vec(&record).map(Some).map_err(|e| e.to_string())
            }),
        };
    }
    Ok(lines)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn bulk(text: &str) -> Value {
        Value::BulkString(text.as_bytes().to_vec())
    }

    fn record_json(key_type: &str, reply: Value) -> String {
        let value = key_value(key_type, reply).unwrap();
        let record = JsonRecord { key: RBytes::from("k"), key_type: key_type.into(), ttl: -1, value };
        serde_json::to_string(&record).unwrap()
    }

    #[test]
    fn json_records_per_type() {
        assert_eq!(record_json("string", bulk("v")), r#"{"key":"k","type":"string","ttl":-1,"value":"v"}"#);
        assert_eq!(
            record_json("string", Value::BulkString(vec![0xff])),
            r#"{"key":"k","type":"string","ttl":-1,"value":{"$b":"/w=="}}"#
        );
        assert_eq!(
            record_json("hash", Value::Array(vec![bulk("f"), bulk("v"), bulk("g"), bulk("w")])),
            r#"{"key":"k","type":"hash","ttl":-1,"value":[{"field":"f","value":"v"},{"field":"g","value":"w"}]}"#
        );
        assert_eq!(
            record_json("hash", Value::Map(vec![(bulk("f"), bulk("v"))])),
            r#"{"key":"k","type":"hash","ttl":-1,"value":[{"field":"f","value":"v"}]}"#
        );
        assert_eq!(record_json("list", Value::Array(vec![bulk("a"), bulk("b")])), r#"{"key":"k","type":"list","ttl":-1,"value":["a","b"]}"#);
        assert_eq!(record_json("set", Value::Set(vec![bulk("a")])), r#"{"key":"k","type":"set","ttl":-1,"value":["a"]}"#);
        assert_eq!(
            record_json("zset", Value::Array(vec![bulk("m"), bulk("1.5"), bulk("n"), bulk("inf"), bulk("o"), bulk("-inf")])),
            r#"{"key":"k","type":"zset","ttl":-1,"value":[{"member":"m","score":1.5},{"member":"n","score":"inf"},{"member":"o","score":"-inf"}]}"#
        );
        assert_eq!(
            record_json("zset", Value::Array(vec![Value::Array(vec![bulk("m"), Value::Double(2.0)])])),
            r#"{"key":"k","type":"zset","ttl":-1,"value":[{"member":"m","score":2.0}]}"#
        );
        assert_eq!(
            record_json(
                "stream",
                Value::Array(vec![Value::Array(vec![bulk("1-0"), Value::Array(vec![bulk("f"), bulk("v")])])])
            ),
            r#"{"key":"k","type":"stream","ttl":-1,"value":[{"id":"1-0","fields":[{"field":"f","value":"v"}]}]}"#
        );
        assert_eq!(record_json("ReJSON-RL", bulk(r#"{"a":1}"#)), r#"{"key":"k","type":"ReJSON-RL","ttl":-1,"value":"{\"a\":1}"}"#);
        assert!(key_value("TSDB-TYPE", Value::Nil).is_err());
    }

    #[test]
    fn json_values_round_trip_through_parse() {
        let replies = [
            ("string", bulk("v")),
            ("hash", Value::Array(vec![bulk("f"), Value::BulkString(vec![0, 0xff])])),
            ("list", Value::Array(vec![bulk("a"), bulk("ş")])),
            ("set", Value::Array(vec![bulk("a")])),
            ("zset", Value::Array(vec![bulk("m"), bulk("-inf"), bulk("n"), bulk("3")])),
            ("stream", Value::Array(vec![Value::Array(vec![bulk("5-1"), Value::Array(vec![bulk("f"), bulk("v")])])])),
            ("ReJSON-RL", bulk(r#"[1,"x"]"#)),
        ];
        for (key_type, reply) in replies {
            let value = key_value(key_type, reply).unwrap();
            let json = serde_json::to_value(&value).unwrap();
            let parsed = KeyValue::parse(key_type, json.clone()).unwrap();
            assert_eq!(serde_json::to_value(&parsed).unwrap(), json, "{key_type}");
        }
        assert!(KeyValue::parse("zset", serde_json::json!([{"member": "m", "score": "abc"}])).is_err());
        assert!(KeyValue::parse("bogus", serde_json::json!("x")).is_err());
    }

    #[test]
    fn dump_record_line() {
        let meta = vec![
            Ok(Meta { key_type: "hash".into(), ttl: 1500, dump: Some(vec![1, 2, 3]) }),
            Ok(Meta { key_type: "none".into(), ttl: -1, dump: None }),
        ];
        let lines = dump_lines(&[b"k".to_vec(), b"gone".to_vec()], meta);
        assert_eq!(String::from_utf8(lines[0].clone().unwrap().unwrap()).unwrap(), r#"{"key":"k","type":"hash","ttl":1500,"dump":"AQID"}"#);
        assert!(matches!(lines[1], Ok(None)));
        let parsed: DumpRecord = serde_json::from_str(r#"{"key":{"$b":"/w=="},"type":"string","ttl":-1,"dump":"AQID"}"#).unwrap();
        assert_eq!(parsed.key, RBytes(vec![0xff]));
    }
}
