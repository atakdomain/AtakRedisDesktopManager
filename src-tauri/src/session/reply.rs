//! RESP2/RESP3 yanıtlarını gevşek okuyan küçük yardımcılar.

use redis::Value;

/// Metin benzeri yanıt; değilse boş
pub fn text(value: &Value) -> String {
    match value {
        Value::BulkString(bytes) => String::from_utf8_lossy(bytes).into_owned(),
        Value::SimpleString(s) => s.clone(),
        Value::VerbatimString { text, .. } => text.clone(),
        Value::Okay => "OK".into(),
        Value::Int(n) => n.to_string(),
        Value::Double(n) => n.to_string(),
        _ => String::new(),
    }
}

pub fn int(value: &Value) -> Option<i64> {
    match value {
        Value::Int(n) => Some(*n),
        Value::BulkString(_) | Value::SimpleString(_) => text(value).parse().ok(),
        _ => None,
    }
}

pub fn bytes(value: Value) -> Vec<u8> {
    match value {
        Value::BulkString(bytes) => bytes,
        Value::SimpleString(s) => s.into_bytes(),
        Value::VerbatimString { text, .. } => text.into_bytes(),
        other => text(&other).into_bytes(),
    }
}

pub fn items(value: Value) -> Vec<Value> {
    match value {
        Value::Array(items) | Value::Set(items) => items,
        Value::Map(pairs) => pairs.into_iter().flat_map(|(k, v)| [k, v]).collect(),
        Value::Nil => Vec::new(),
        other => vec![other],
    }
}

/// Düz [k, v, k, v] dizisi ya da RESP3 map → (anahtar, değer)
pub fn pairs(value: Value) -> Vec<(String, Value)> {
    let mut out = Vec::new();
    let mut iter = items(value).into_iter();
    while let (Some(key), Some(value)) = (iter.next(), iter.next()) {
        out.push((text(&key), value));
    }
    out
}

/// INFO metninde `name:value` satırı
pub fn info_field<'a>(info: &'a str, name: &str) -> Option<&'a str> {
    info.lines().find_map(|line| line.strip_prefix(name)?.strip_prefix(':')).map(str::trim)
}

/// CONFIG GET tek değer
pub fn config_value(value: &Value) -> Option<String> {
    pairs(value.clone()).into_iter().next().map(|(_, v)| text(&v))
}

/// MODULE LIST → ["ReJSON", "search", …]
pub fn module_names(value: &Value) -> Vec<String> {
    if matches!(value, Value::ServerError(_)) {
        return Vec::new();
    }
    items(value.clone())
        .into_iter()
        .filter_map(|module| pairs(module).into_iter().find(|(k, _)| k == "name").map(|(_, v)| text(&v)))
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_info_fields() {
        let info = "# Server\r\nredis_version:7.2.4\r\nredis_mode:standalone\r\n# Replication\r\nrole:master\r\n";
        assert_eq!(info_field(info, "redis_version"), Some("7.2.4"));
        assert_eq!(info_field(info, "role"), Some("master"));
        assert_eq!(info_field(info, "redis"), None);
    }

    #[test]
    fn reads_module_list() {
        let module = Value::Array(vec![
            Value::BulkString(b"name".to_vec()),
            Value::BulkString(b"ReJSON".to_vec()),
            Value::BulkString(b"ver".to_vec()),
            Value::Int(20000),
        ]);
        assert_eq!(module_names(&Value::Array(vec![module])), ["ReJSON"]);
    }
}
