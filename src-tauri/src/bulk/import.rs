//! Export dosyasını geri yükler. Biçim ilk boşluk olmayan karakterden anlaşılır: `[` json, `{` dump satırları.
//! Dosya ayrı bir iş parçacığında akarak okunur; kayıtlar sınırlı bir kanaldan parça parça gelir.

use super::copy::restore_ttl;
use super::export::{DumpRecord, KeyValue};
use super::{int_of, is_busy_key, key_cmd, key_cmds, Emit, Job, Outcome, Reporter, CHUNK};
use crate::bytes::RBytes;
use crate::error::{AppError, AppResult, ErrorKind};
use crate::model::BulkSummary;
use crate::session::Session;
use base64::engine::general_purpose::STANDARD;
use base64::Engine;
use serde::de::{self, SeqAccess, Visitor};
use serde::{Deserialize, Deserializer};
use std::fs::File;
use std::io::{BufRead, BufReader, Read};
use std::path::{Path, PathBuf};
use tokio::sync::mpsc;
use tokio_util::sync::CancellationToken;

/// Toplu komutlarda tek komuta konan en fazla öğe
const ARGS_PER_CMD: usize = 1000;

#[derive(Debug, PartialEq, Clone, Copy)]
enum Format {
    Json,
    Dump,
}

struct Record {
    key: Vec<u8>,
    ttl: i64,
    data: Data,
}

enum Data {
    Dump(Vec<u8>),
    Value(KeyValue),
}

/// Okunamayan kayıt; anahtarı biliniyorsa onunla
struct ReadError {
    key: Vec<u8>,
    message: String,
}

type Item = Result<Record, ReadError>;

pub async fn import_file(
    session: &Session,
    db: u32,
    path: &str,
    replace: bool,
    token: &CancellationToken,
    emit: Emit<'_>,
) -> AppResult<BulkSummary> {
    session.ensure_writable()?;
    if session.is_cluster() && db != 0 {
        return Err(AppError::invalid("cluster mode has only db 0"));
    }
    let format = detect_format(Path::new(path))?;
    let (tx, mut rx) = mpsc::channel(CHUNK * 2);
    let file = PathBuf::from(path);
    let reader = tokio::task::spawn_blocking(move || read_records(&file, format, &tx));
    let mut job = Job { session, db, rep: Reporter::new(emit, None, false) };
    let result = consume(&mut job, &mut rx, replace, token).await;
    drop(rx);
    let _ = reader.await;
    let cancelled = match result {
        Ok(()) => false,
        Err(err) if err.kind == ErrorKind::Cancelled => true,
        Err(err) => return Err(err),
    };
    Ok(job.rep.finish(cancelled, String::new()))
}

fn detect_format(path: &Path) -> AppResult<Format> {
    let mut file = File::open(path)?;
    let mut buffer = [0u8; 4096];
    loop {
        let read = file.read(&mut buffer)?;
        if read == 0 {
            return Err(AppError::invalid("the file is empty"));
        }
        for &byte in &buffer[..read] {
            match byte {
                b'[' => return Ok(Format::Json),
                b'{' => return Ok(Format::Dump),
                b' ' | b'\t' | b'\r' | b'\n' | 0xEF | 0xBB | 0xBF => {}
                _ => return Err(AppError::invalid("not an export file: expected a JSON array or JSON Lines")),
            }
        }
    }
}

fn read_records(path: &Path, format: Format, tx: &mpsc::Sender<Item>) {
    let result = File::open(path).map_err(|e| e.to_string()).and_then(|file| {
        let mut reader = BufReader::new(file);
        skip_bom(&mut reader)?;
        match format {
            Format::Json => read_json(reader, tx),
            Format::Dump => read_lines(reader, tx),
        }
    });
    if let Err(message) = result {
        let _ = tx.blocking_send(Err(ReadError { key: Vec::new(), message }));
    }
}

fn skip_bom(reader: &mut BufReader<File>) -> Result<(), String> {
    if reader.fill_buf().map_err(|e| e.to_string())?.starts_with(b"\xEF\xBB\xBF") {
        reader.consume(3);
    }
    Ok(())
}

fn read_lines(reader: BufReader<File>, tx: &mpsc::Sender<Item>) -> Result<(), String> {
    for (index, line) in reader.lines().enumerate() {
        let line = line.map_err(|e| format!("line {}: {e}", index + 1))?;
        if line.trim().is_empty() {
            continue;
        }
        let item = parse_dump_line(&line).map_err(|mut err| {
            err.message = format!("line {}: {}", index + 1, err.message);
            err
        });
        if tx.blocking_send(item).is_err() {
            break;
        }
    }
    Ok(())
}

fn parse_dump_line(line: &str) -> Item {
    let record: DumpRecord =
        serde_json::from_str(line).map_err(|e| ReadError { key: Vec::new(), message: e.to_string() })?;
    let key = record.key.into_vec();
    match STANDARD.decode(record.dump.as_bytes()) {
        Ok(payload) => Ok(Record { key, ttl: record.ttl, data: Data::Dump(payload) }),
        Err(err) => Err(ReadError { key, message: format!("dump is not base64: {err}") }),
    }
}

#[derive(Deserialize)]
struct RawRecord {
    key: RBytes,
    #[serde(rename = "type")]
    key_type: String,
    ttl: i64,
    value: serde_json::Value,
}

impl RawRecord {
    fn into_item(self) -> Item {
        let key = self.key.into_vec();
        match KeyValue::parse(&self.key_type, self.value) {
            Ok(value) => Ok(Record { key, ttl: self.ttl, data: Data::Value(value) }),
            Err(message) => Err(ReadError { key, message }),
        }
    }
}

/// JSON dizisinin öğelerini tek tek kanala gönderir; dizi bellekte toplanmaz
struct Elements<'a>(&'a mpsc::Sender<Item>);

impl<'de> Visitor<'de> for Elements<'_> {
    type Value = ();

    fn expecting(&self, f: &mut std::fmt::Formatter) -> std::fmt::Result {
        f.write_str("an array of exported keys")
    }

    fn visit_seq<A: SeqAccess<'de>>(self, mut seq: A) -> Result<(), A::Error> {
        while let Some(raw) = seq.next_element::<RawRecord>()? {
            if self.0.blocking_send(raw.into_item()).is_err() {
                return Err(de::Error::custom("import stopped"));
            }
        }
        Ok(())
    }
}

fn read_json(reader: BufReader<File>, tx: &mpsc::Sender<Item>) -> Result<(), String> {
    let mut json = serde_json::Deserializer::from_reader(reader);
    match (&mut json).deserialize_seq(Elements(tx)) {
        Ok(()) => json.end().map_err(|e| e.to_string()),
        Err(_) if tx.is_closed() => Ok(()),
        Err(err) => Err(err.to_string()),
    }
}

async fn consume(
    job: &mut Job<'_>,
    rx: &mut mpsc::Receiver<Item>,
    replace: bool,
    token: &CancellationToken,
) -> AppResult<()> {
    let mut chunk = Vec::with_capacity(CHUNK);
    loop {
        let received = tokio::select! {
            received = rx.recv_many(&mut chunk, CHUNK) => received,
            _ = token.cancelled() => return Err(AppError::cancelled()),
        };
        if received == 0 {
            return Ok(());
        }
        job.rep.scanned += received as u64;
        job.rep.matched += received as u64;
        let mut dumps = Vec::new();
        let mut values = Vec::new();
        for item in chunk.drain(..) {
            match item {
                Err(err) => job.rep.record(&err.key, Outcome::Failed(err.message)),
                Ok(Record { key, ttl, data: Data::Dump(payload) }) => dumps.push((key, ttl, payload)),
                Ok(Record { key, ttl, data: Data::Value(value) }) => values.push((key, ttl, value)),
            }
        }
        restore(job, dumps, replace).await?;
        recreate(job, values, replace).await?;
        job.rep.progress();
        if token.is_cancelled() {
            return Err(AppError::cancelled());
        }
    }
}

/// RESTORE; hedef varsa ve REPLACE yoksa BUSYKEY → atlanır
async fn restore(job: &mut Job<'_>, records: Vec<(Vec<u8>, i64, Vec<u8>)>, replace: bool) -> AppResult<()> {
    if records.is_empty() {
        return Ok(());
    }
    let mut keys = Vec::with_capacity(records.len());
    let mut items = Vec::with_capacity(records.len());
    for (key, ttl, payload) in records {
        let mut cmd = key_cmd("RESTORE", &key);
        cmd.arg(restore_ttl(ttl)).arg(payload);
        if replace {
            cmd.arg("REPLACE");
        }
        items.push((key.clone(), cmd));
        keys.push(key);
    }
    for (key, reply) in keys.iter().zip(job.pipeline(items).await?) {
        let outcome = match reply {
            Ok(_) => Outcome::Done,
            Err(err) if is_busy_key(&err) => Outcome::Skipped,
            Err(err) => Outcome::Failed(err.message),
        };
        job.rep.record(key, outcome);
    }
    Ok(())
}

/// Tipine göre yeniden oluşturur: varsa atlanır (replace'te önce silinir), sonra PEXPIRE
async fn recreate(job: &mut Job<'_>, records: Vec<(Vec<u8>, i64, KeyValue)>, replace: bool) -> AppResult<()> {
    let (empty, mut records): (Vec<_>, Vec<_>) = records.into_iter().partition(|(_, _, value)| value.is_empty());
    for (key, _, _) in empty {
        job.rep.record(&key, Outcome::Skipped);
    }
    if !replace && !records.is_empty() {
        let keys: Vec<Vec<u8>> = records.iter().map(|(key, _, _)| key.clone()).collect();
        let exists = job.pipeline(key_cmds(&keys, "EXISTS")).await?;
        let mut fresh = Vec::with_capacity(records.len());
        for (record, exists) in records.into_iter().zip(exists) {
            match exists {
                Ok(v) if int_of(&v).unwrap_or(0) > 0 => job.rep.record(&record.0, Outcome::Skipped),
                Ok(_) => fresh.push(record),
                Err(err) => job.rep.record(&record.0, Outcome::Failed(err.message)),
            }
        }
        records = fresh;
    }
    if records.is_empty() {
        return Ok(());
    }
    let multi_hset = job.session.version_at_least(4, 0);
    let mut items = Vec::new();
    let mut spans = Vec::with_capacity(records.len());
    for (key, ttl, value) in &records {
        let start = items.len();
        if replace {
            items.push((key.clone(), key_cmd(job.unlink_name(), key)));
        }
        items.extend(create_cmds(key, value, multi_hset).into_iter().map(|cmd| (key.clone(), cmd)));
        if *ttl >= 0 {
            let mut cmd = key_cmd("PEXPIRE", key);
            cmd.arg((*ttl).max(1));
            items.push((key.clone(), cmd));
        }
        spans.push(start..items.len());
    }
    let replies = job.pipeline(items).await?;
    for ((key, _, _), span) in records.iter().zip(spans) {
        let error = replies[span].iter().find_map(|reply| reply.as_ref().err());
        job.rep.record(key, error.map_or(Outcome::Done, |err| Outcome::Failed(err.message.clone())));
    }
    Ok(())
}

fn create_cmds(key: &[u8], value: &KeyValue, multi_hset: bool) -> Vec<redis::Cmd> {
    let batched = |name: &str, args: Vec<Vec<&[u8]>>| -> Vec<redis::Cmd> {
        args.chunks(ARGS_PER_CMD)
            .map(|group| {
                let mut cmd = key_cmd(name, key);
                for arg in group.iter().flatten() {
                    cmd.arg(*arg);
                }
                cmd
            })
            .collect()
    };
    match value {
        KeyValue::String(bytes) => {
            let mut cmd = key_cmd("SET", key);
            cmd.arg(bytes.as_slice());
            vec![cmd]
        }
        KeyValue::Json(text) => {
            let mut cmd = key_cmd("JSON.SET", key);
            cmd.arg(".").arg(text);
            vec![cmd]
        }
        KeyValue::Hash(entries) => batched(
            if multi_hset { "HSET" } else { "HMSET" },
            entries.iter().map(|e| vec![e.field.as_slice(), e.value.as_slice()]).collect(),
        ),
        KeyValue::List(items) => batched("RPUSH", items.iter().map(|i| vec![i.as_slice()]).collect()),
        KeyValue::Set(items) => batched("SADD", items.iter().map(|i| vec![i.as_slice()]).collect()),
        KeyValue::ZSet(items) => items
            .chunks(ARGS_PER_CMD)
            .map(|group| {
                let mut cmd = key_cmd("ZADD", key);
                for item in group {
                    cmd.arg(item.score).arg(item.member.as_slice());
                }
                cmd
            })
            .collect(),
        KeyValue::Stream(entries) => entries
            .iter()
            .map(|entry| {
                let mut cmd = key_cmd("XADD", key);
                cmd.arg(&entry.id);
                for field in &entry.fields {
                    cmd.arg(field.field.as_slice()).arg(field.value.as_slice());
                }
                cmd
            })
            .collect(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;

    fn temp_file(name: &str, content: &[u8]) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("atak-rdm-import-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join(name);
        std::fs::File::create(&path).unwrap().write_all(content).unwrap();
        path
    }

    fn read_all(path: &Path) -> Vec<Item> {
        let format = detect_format(path).unwrap();
        let (tx, mut rx) = mpsc::channel(1000);
        read_records(path, format, &tx);
        drop(tx);
        let mut out = Vec::new();
        while let Ok(item) = rx.try_recv() {
            out.push(item);
        }
        std::fs::remove_dir_all(path.parent().unwrap()).unwrap();
        out
    }

    #[test]
    fn detects_formats() {
        let cases: [(&[u8], Option<Format>); 4] = [
            (b"\xEF\xBB\xBF \n[]", Some(Format::Json)),
            (b"\r\n{\"key\":1}", Some(Format::Dump)),
            (b"  ", None),
            (b"key,value", None),
        ];
        for (content, want) in cases {
            let path = temp_file("f", content);
            assert_eq!(detect_format(&path).ok(), want, "{content:?}");
            std::fs::remove_dir_all(path.parent().unwrap()).unwrap();
        }
    }

    #[test]
    fn reads_dump_lines_with_per_line_errors() {
        let content = "{\"key\":\"a\",\"type\":\"string\",\"ttl\":-1,\"dump\":\"AQID\"}\r\n\n{broken\n{\"key\":{\"$b\":\"/w==\"},\"type\":\"hash\",\"ttl\":5,\"dump\":\"!!\"}\n{\"key\":\"ş\",\"type\":\"set\",\"ttl\":10,\"dump\":\"\"}\n";
        let items = read_all(&temp_file("x.jsonl", content.as_bytes()));
        assert_eq!(items.len(), 4);
        let Ok(Record { key, ttl: -1, data: Data::Dump(payload) }) = &items[0] else { panic!("first record") };
        assert_eq!((key.as_slice(), payload.as_slice()), (&b"a"[..], &[1u8, 2, 3][..]));
        assert!(matches!(&items[1], Err(e) if e.message.starts_with("line 3:") && e.key.is_empty()));
        assert!(matches!(&items[2], Err(e) if e.key == [0xff] && e.message.contains("base64")));
        assert!(matches!(&items[3], Ok(Record { ttl: 10, .. })));
    }

    #[test]
    fn reads_json_array_streaming() {
        let content = r#"[
{"key":"s","type":"string","ttl":-1,"value":"v"},
{"key":"h","type":"hash","ttl":100,"value":[{"field":"f","value":{"$b":"AP8="}}]},
{"key":"z","type":"zset","ttl":-1,"value":[{"member":"m","score":"-inf"}]},
{"key":"x","type":"hash","ttl":-1,"value":"not a list"},
{"key":"e","type":"stream","ttl":-1,"value":[]}
]"#;
        let items = read_all(&temp_file("x.json", content.as_bytes()));
        assert_eq!(items.len(), 5);
        assert!(matches!(&items[0], Ok(Record { data: Data::Value(KeyValue::String(v)), .. }) if v.as_slice() == b"v"));
        assert!(matches!(&items[1], Ok(Record { ttl: 100, data: Data::Value(KeyValue::Hash(h)), .. }) if h[0].value.as_slice() == [0, 0xff]));
        assert!(matches!(&items[2], Ok(Record { data: Data::Value(KeyValue::ZSet(z)), .. }) if z[0].score == f64::NEG_INFINITY));
        assert!(matches!(&items[3], Err(e) if e.key == b"x"));
        assert!(matches!(&items[4], Ok(Record { data: Data::Value(v), .. }) if v.is_empty()));
    }

    #[test]
    fn broken_json_array_reports_once() {
        let items = read_all(&temp_file("x.json", br#"[{"key":"s","type":"string","ttl":-1,"value":"v"}, {"key": "#));
        assert_eq!(items.len(), 2);
        assert!(items[0].is_ok());
        assert!(matches!(&items[1], Err(e) if e.key.is_empty()));
    }

    #[test]
    fn create_commands_are_batched() {
        let items: Vec<RBytes> = (0..2500).map(|i| RBytes::from(i.to_string())).collect();
        let cmds = create_cmds(b"k", &KeyValue::List(items), true);
        assert_eq!(cmds.len(), 3);
        assert_eq!(cmds[2].args_iter().count(), 2 + 500);
        let hash = KeyValue::Hash(vec![crate::model::HashEntry { field: "f".into(), value: "v".into() }]);
        let cmd = &create_cmds(b"k", &hash, false)[0];
        let args: Vec<&[u8]> = cmd
            .args_iter()
            .filter_map(|arg| match arg {
                redis::Arg::Simple(bytes) => Some(bytes),
                _ => None,
            })
            .collect();
        assert_eq!(args, [&b"HMSET"[..], b"k", b"f", b"v"]);
    }
}
