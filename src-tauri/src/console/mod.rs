//! Konsol: redis-cli sözdizimi, salt okunur denetimi, cluster yönlendirmesi; Pub/Sub ve MONITOR akışları.

mod parse;
mod stream;

pub use parse::{to_rvalue, tokenize};
pub use stream::{monitor, subscribe};

use crate::error::{AppError, AppResult, ErrorKind};
use crate::model::{ConsoleReply, RValue};
use crate::session::reply;
use crate::session::{Lane, NodeAddr, Route, Session};
use redis::{cmd, Value};
use std::collections::HashMap;
use std::sync::Mutex;
use std::time::Instant;

/// `COMMAND INFO` özeti
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct CommandSpec {
    write: bool,
    movable_keys: bool,
    first_key: i64,
}

/// Oturum başına komut adı → özet; `None` = sunucu tanımıyor ya da COMMAND INFO kapalı
#[derive(Default)]
pub struct CommandCache(Mutex<HashMap<String, Option<CommandSpec>>>);

pub async fn exec(session: &Session, db: u32, line: &str, node: &str) -> AppResult<ConsoleReply> {
    let started = Instant::now();
    let args = tokenize(line).map_err(AppError::invalid)?;
    let Some(first) = args.first() else {
        return Err(AppError::invalid("empty command"));
    };
    let name = String::from_utf8_lossy(first).to_ascii_uppercase();
    let sub = args.get(1).map(|a| String::from_utf8_lossy(a).to_ascii_uppercase()).unwrap_or_default();
    let elapsed = || started.elapsed().as_secs_f64() * 1000.0;

    if name == "SELECT" {
        let (value, db) = select(session, db, &args);
        return Ok(ConsoleReply { value, db, elapsed_ms: elapsed() });
    }
    if let Some(reason) = unsupported(&name, &sub) {
        return Err(AppError::invalid(reason));
    }
    let spec = command_spec(session, &name).await;
    if session.config.read_only && blocked_when_read_only(&name, &sub, spec) {
        return Err(AppError::read_only());
    }

    let mut command = redis::Cmd::new();
    for arg in &args {
        command.arg(arg.as_slice());
    }
    let value = if node.is_empty() {
        let key = cluster_key(session, &args, spec).await;
        let route = key.as_deref().map_or(Route::Default, Route::Key);
        session.query_raw(db, Lane::Console, &route, &command).await?
    } else {
        session.query_raw(db, Lane::Console, &Route::Node(NodeAddr::parse(node)?), &command).await?
    };
    Ok(ConsoleReply { value: to_rvalue(value), db, elapsed_ms: elapsed() })
}

/// Sunucuya gitmez; konsolun veritabanını değiştirir
fn select(session: &Session, db: u32, args: &[Vec<u8>]) -> (RValue, u32) {
    let error = |text: &str| (RValue::Err(text.into()), db);
    if args.len() != 2 {
        return error("ERR wrong number of arguments for 'select' command");
    }
    if session.is_cluster() {
        return error("ERR SELECT is not allowed in cluster mode");
    }
    match std::str::from_utf8(&args[1]).ok().and_then(|s| s.parse::<u32>().ok()) {
        Some(index) if index < session.db_count() => (RValue::Status("OK".into()), index),
        Some(_) => error("ERR DB index is out of range"),
        None => error("ERR value is not an integer or out of range"),
    }
}

/// Paylaşılan konsol bağlantısının durumunu bozacak komutlar
fn unsupported(name: &str, sub: &str) -> Option<&'static str> {
    match (name, sub) {
        ("SUBSCRIBE" | "PSUBSCRIBE" | "SSUBSCRIBE" | "UNSUBSCRIBE" | "PUNSUBSCRIBE" | "SUNSUBSCRIBE", _) => {
            Some("use the Pub/Sub panel to subscribe")
        }
        ("MONITOR", _) => Some("use the Monitor panel"),
        ("SYNC" | "PSYNC" | "HELLO" | "RESET", _) | ("CLIENT", "REPLY") => Some("this command is not supported in the console"),
        _ => None,
    }
}

async fn command_spec(session: &Session, name: &str) -> Option<CommandSpec> {
    if let Some(spec) = session.commands.0.lock().unwrap().get(name) {
        return *spec;
    }
    let info = session.query_raw(session.home_db(), Lane::Main, &Route::Default, cmd("COMMAND").arg("INFO").arg(name)).await;
    let spec = match info {
        Ok(value) => parse_command_info(value),
        // bağlantı sorunu geçicidir; önbelleğe alınmaz
        Err(err) if matches!(err.kind, ErrorKind::Connection | ErrorKind::Timeout) => return None,
        Err(_) => None,
    };
    session.commands.0.lock().unwrap().insert(name.to_string(), spec);
    spec
}

fn parse_command_info(value: Value) -> Option<CommandSpec> {
    let mut parts = reply::items(reply::items(value).into_iter().next()?).into_iter();
    let flags: Vec<String> = reply::items(parts.nth(2)?).iter().map(reply::text).collect();
    let first_key = reply::int(&parts.next()?)?;
    Some(CommandSpec {
        write: flags.iter().any(|f| f == "write"),
        movable_keys: flags.iter().any(|f| f == "movablekeys"),
        first_key,
    })
}

/// Cluster'da komutun ilk anahtarı; bulunamazsa varsayılan düğüm (MOVED yine izlenir)
async fn cluster_key(session: &Session, args: &[Vec<u8>], spec: Option<CommandSpec>) -> Option<Vec<u8>> {
    if !session.is_cluster() || args.len() < 2 {
        return None;
    }
    match spec {
        Some(spec) if !spec.movable_keys => {
            let index = usize::try_from(spec.first_key).ok().filter(|&i| i > 0)?;
            args.get(index).cloned()
        }
        _ => {
            let mut getkeys = cmd("COMMAND");
            getkeys.arg("GETKEYS");
            for arg in args {
                getkeys.arg(arg.as_slice());
            }
            let keys = session.query_raw(0, Lane::Main, &Route::Default, &getkeys).await.ok()?;
            reply::items(keys).into_iter().next().map(reply::bytes)
        }
    }
}

fn blocked_when_read_only(name: &str, sub: &str, spec: Option<CommandSpec>) -> bool {
    let write = match spec {
        Some(spec) => spec.write,
        None => WRITE_COMMANDS.contains(&name),
    };
    write || mutating_admin(name, sub)
}

/// "write" bayrağı taşımayan ama veri ya da sunucu durumunu değiştiren komutlar
fn mutating_admin(name: &str, sub: &str) -> bool {
    match name {
        "EVAL" | "EVALSHA" | "FCALL" | "SHUTDOWN" | "REPLICAOF" | "SLAVEOF" | "FAILOVER" | "DEBUG" | "SAVE" | "BGSAVE" | "BGREWRITEAOF"
        | "MIGRATE" => true,
        "SCRIPT" => sub != "EXISTS",
        "FUNCTION" => !matches!(sub, "LIST" | "DUMP" | "STATS" | "HELP"),
        "MODULE" => !matches!(sub, "LIST" | "HELP"),
        "CONFIG" => !matches!(sub, "GET" | "HELP"),
        "ACL" => !matches!(sub, "CAT" | "GETUSER" | "LIST" | "USERS" | "WHOAMI" | "LOG" | "HELP" | "DRYRUN" | "GENPASS"),
        "CLIENT" => matches!(sub, "KILL" | "PAUSE"),
        "SLOWLOG" => sub == "RESET",
        "CLUSTER" => !matches!(
            sub,
            "INFO" | "NODES" | "SLOTS" | "SHARDS" | "KEYSLOT" | "COUNTKEYSINSLOT" | "GETKEYSINSLOT" | "MYID" | "MYSHARDID" | "LINKS" | "REPLICAS" | "SLAVES" | "HELP"
        ),
        _ => false,
    }
}

/// COMMAND INFO alınamazsa kullanılan yazma komutları
const WRITE_COMMANDS: &[&str] = &[
    "APPEND", "BITFIELD", "BITOP", "BLMOVE", "BLMPOP", "BLPOP", "BRPOP", "BRPOPLPUSH", "BZMPOP", "BZPOPMAX", "BZPOPMIN", "COPY", "DECR",
    "DECRBY", "DEL", "EXPIRE", "EXPIREAT", "FLUSHALL", "FLUSHDB", "GEOADD", "GEORADIUS", "GEORADIUSBYMEMBER", "GEOSEARCHSTORE", "GETDEL",
    "GETEX", "GETSET", "HDEL", "HINCRBY", "HINCRBYFLOAT", "HMSET", "HSET", "HSETNX", "INCR", "INCRBY", "INCRBYFLOAT", "LINSERT", "LMOVE",
    "LMPOP", "LPOP", "LPUSH", "LPUSHX", "LREM", "LSET", "LTRIM", "MOVE", "MSET", "MSETNX", "PERSIST", "PEXPIRE", "PEXPIREAT", "PFADD",
    "PFMERGE", "PSETEX", "RENAME", "RENAMENX", "RESTORE", "RPOP", "RPOPLPUSH", "RPUSH", "RPUSHX", "SADD", "SDIFFSTORE", "SET", "SETBIT",
    "SETEX", "SETNX", "SETRANGE", "SINTERSTORE", "SMOVE", "SORT", "SPOP", "SREM", "SUNIONSTORE", "SWAPDB", "UNLINK", "XACK", "XADD",
    "XAUTOCLAIM", "XCLAIM", "XDEL", "XGROUP", "XREADGROUP", "XSETID", "XTRIM", "ZADD", "ZDIFFSTORE", "ZINCRBY", "ZINTERSTORE", "ZMPOP",
    "ZPOPMAX", "ZPOPMIN", "ZRANGESTORE", "ZREM", "ZREMRANGEBYLEX", "ZREMRANGEBYRANK", "ZREMRANGEBYSCORE", "ZUNIONSTORE", "JSON.SET",
    "JSON.DEL", "JSON.FORGET", "JSON.MSET", "JSON.MERGE", "JSON.ARRAPPEND", "JSON.ARRINSERT", "JSON.ARRPOP", "JSON.ARRTRIM",
    "JSON.NUMINCRBY", "JSON.NUMMULTBY", "JSON.STRAPPEND", "JSON.TOGGLE", "JSON.CLEAR",
];

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn read_only_blocks_writes_and_mutating_admin() {
        let write = Some(CommandSpec { write: true, movable_keys: false, first_key: 1 });
        let read = Some(CommandSpec { write: false, movable_keys: false, first_key: 1 });
        assert!(blocked_when_read_only("SET", "", write));
        assert!(!blocked_when_read_only("GET", "", read));
        assert!(blocked_when_read_only("HSET", "", None));
        assert!(!blocked_when_read_only("HGETALL", "", None));
        assert!(blocked_when_read_only("CONFIG", "SET", read));
        assert!(!blocked_when_read_only("CONFIG", "GET", read));
        assert!(blocked_when_read_only("EVAL", "", read));
    }

    #[test]
    fn parses_command_info() {
        let status = |s: &str| Value::SimpleString(s.into());
        let info = Value::Array(vec![Value::Array(vec![
            Value::BulkString(b"set".to_vec()),
            Value::Int(-3),
            Value::Array(vec![status("write"), status("denyoom")]),
            Value::Int(1),
            Value::Int(1),
            Value::Int(1),
        ])]);
        assert_eq!(parse_command_info(info), Some(CommandSpec { write: true, movable_keys: false, first_key: 1 }));
        assert_eq!(parse_command_info(Value::Array(vec![Value::Nil])), None);
    }
}
