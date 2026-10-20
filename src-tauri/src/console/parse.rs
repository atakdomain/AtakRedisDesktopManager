//! redis-cli (`sdssplitargs`) sözdizimi ve `redis::Value` → `RValue`.

use crate::model::RValue;
use redis::Value;

fn is_space(b: u8) -> bool {
    matches!(b, b' ' | b'\n' | b'\r' | b'\t' | b'\0')
}

fn hex(b: u8) -> Option<u8> {
    char::from(b).to_digit(16).map(|d| d as u8)
}

/// Çift tırnakta `\n \r \t \b \a \" \\ \xNN` kaçışları; tek tırnak düzdür (yalnız `\'`).
/// Kapanan tırnaktan sonra boşluk ya da satır sonu gelmelidir.
pub fn tokenize(line: &str) -> Result<Vec<Vec<u8>>, String> {
    let bytes = line.as_bytes();
    let mut args = Vec::new();
    let mut i = 0;
    loop {
        while i < bytes.len() && is_space(bytes[i]) {
            i += 1;
        }
        if i >= bytes.len() {
            return Ok(args);
        }
        let mut current = Vec::new();
        let mut in_double = false;
        let mut in_single = false;
        loop {
            let Some(&c) = bytes.get(i) else {
                if in_double || in_single {
                    return Err("unbalanced quotes".into());
                }
                break;
            };
            if in_double {
                if c == b'\\' && i + 3 < bytes.len() && bytes[i + 1] == b'x' && hex(bytes[i + 2]).is_some() && hex(bytes[i + 3]).is_some() {
                    current.push(hex(bytes[i + 2]).unwrap() * 16 + hex(bytes[i + 3]).unwrap());
                    i += 3;
                } else if c == b'\\' && i + 1 < bytes.len() {
                    i += 1;
                    current.push(match bytes[i] {
                        b'n' => b'\n',
                        b'r' => b'\r',
                        b't' => b'\t',
                        b'b' => 0x08,
                        b'a' => 0x07,
                        other => other,
                    });
                } else if c == b'"' {
                    if bytes.get(i + 1).is_some_and(|&n| !is_space(n)) {
                        return Err("closing quote must be followed by a space".into());
                    }
                    in_double = false;
                } else {
                    current.push(c);
                }
            } else if in_single {
                if c == b'\\' && bytes.get(i + 1) == Some(&b'\'') {
                    i += 1;
                    current.push(b'\'');
                } else if c == b'\'' {
                    if bytes.get(i + 1).is_some_and(|&n| !is_space(n)) {
                        return Err("closing quote must be followed by a space".into());
                    }
                    in_single = false;
                } else {
                    current.push(c);
                }
            } else if is_space(c) {
                break;
            } else if c == b'"' {
                in_double = true;
            } else if c == b'\'' {
                in_single = true;
            } else {
                current.push(c);
            }
            i += 1;
        }
        args.push(current);
    }
}

/// "ERR unknown command …" biçiminde
pub fn error_text(err: &redis::ServerError) -> String {
    match err.details() {
        Some(detail) => format!("{} {}", err.code(), detail),
        None => err.code().to_string(),
    }
}

pub fn to_rvalue(value: Value) -> RValue {
    match value {
        Value::Nil => RValue::Nil,
        Value::Int(n) => RValue::Int(n),
        Value::BulkString(bytes) => RValue::Str(bytes.into()),
        Value::Array(items) => RValue::Arr(items.into_iter().map(to_rvalue).collect()),
        Value::SimpleString(text) => RValue::Status(text),
        Value::Okay => RValue::Status("OK".into()),
        Value::Map(pairs) => RValue::Map(pairs.into_iter().map(|(k, v)| (to_rvalue(k), to_rvalue(v))).collect()),
        Value::Attribute { data, .. } => to_rvalue(*data),
        Value::Set(items) => RValue::Set(items.into_iter().map(to_rvalue).collect()),
        Value::Double(n) => RValue::Dbl(n),
        Value::Boolean(b) => RValue::Bool(b),
        Value::VerbatimString { text, .. } => RValue::Verbatim(text),
        Value::BigNumber(digits) => RValue::Big(String::from_utf8_lossy(&digits).into_owned()),
        Value::Push { kind, data } => RValue::Arr(std::iter::once(RValue::Str(kind.to_string().into())).chain(data.into_iter().map(to_rvalue)).collect()),
        Value::ServerError(err) => RValue::Err(error_text(&err)),
        other => RValue::Status(format!("{other:?}")),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn args(line: &str) -> Vec<String> {
        tokenize(line).unwrap().into_iter().map(|a| String::from_utf8_lossy(&a).into_owned()).collect()
    }

    #[test]
    fn splits_on_whitespace() {
        assert_eq!(args("  SET  key\tvalue \n"), ["SET", "key", "value"]);
        assert!(tokenize("   ").unwrap().is_empty());
    }

    #[test]
    fn double_quotes_handle_escapes() {
        assert_eq!(args(r#"SET "a b" "line\nnext\t\"q\" \\""#), ["SET", "a b", "line\nnext\t\"q\" \\"]);
        assert_eq!(tokenize(r#"SET k "\xff\x00A""#).unwrap()[2], vec![0xff, 0x00, b'A']);
        assert_eq!(args(r#"SET k """#), ["SET", "k", ""]);
        // geçersiz \x dizisi harfi harfine kalır
        assert_eq!(args(r#""\xZZ""#), ["xZZ"]);
    }

    #[test]
    fn single_quotes_are_literal() {
        assert_eq!(args(r"SET 'a \n b' 'it\'s'"), ["SET", r"a \n b", "it's"]);
    }

    #[test]
    fn quotes_can_start_mid_token() {
        assert_eq!(args(r#"foo"bar baz" x"#), ["foobar baz", "x"]);
    }

    #[test]
    fn rejects_unbalanced_quotes() {
        assert!(tokenize(r#"SET "abc"#).is_err());
        assert!(tokenize("SET 'abc").is_err());
        assert!(tokenize(r#"SET "a"b"#).is_err());
    }

    #[test]
    fn converts_values() {
        let value = Value::Array(vec![Value::Okay, Value::Nil, Value::Int(3), Value::BulkString(vec![0xff])]);
        let json = serde_json::to_string(&to_rvalue(value)).unwrap();
        assert_eq!(json, r#"{"t":"arr","v":[{"t":"status","v":"OK"},{"t":"nil"},{"t":"int","v":3},{"t":"str","v":{"$b":"/w=="}}]}"#);
    }
}
