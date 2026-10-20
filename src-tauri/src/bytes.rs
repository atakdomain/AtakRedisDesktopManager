use base64::engine::general_purpose::STANDARD;
use base64::Engine;
use serde::de::{self, MapAccess, Visitor};
use serde::ser::SerializeMap;
use serde::{Deserialize, Deserializer, Serialize, Serializer};
use std::fmt;

/// İkili-güvenli bayt dizisi. Geçerli UTF-8 ise JSON'da düz metin,
/// değilse `{"$b": "<base64>"}` olarak taşınır.
#[derive(Clone, Debug, Default, PartialEq, Eq, Hash, PartialOrd, Ord)]
pub struct RBytes(pub Vec<u8>);

impl RBytes {
    pub fn as_slice(&self) -> &[u8] {
        &self.0
    }

    pub fn into_vec(self) -> Vec<u8> {
        self.0
    }
}

impl From<Vec<u8>> for RBytes {
    fn from(v: Vec<u8>) -> Self {
        RBytes(v)
    }
}

impl From<&[u8]> for RBytes {
    fn from(v: &[u8]) -> Self {
        RBytes(v.to_vec())
    }
}

impl From<String> for RBytes {
    fn from(v: String) -> Self {
        RBytes(v.into_bytes())
    }
}

impl From<&str> for RBytes {
    fn from(v: &str) -> Self {
        RBytes(v.as_bytes().to_vec())
    }
}

impl AsRef<[u8]> for RBytes {
    fn as_ref(&self) -> &[u8] {
        &self.0
    }
}

impl Serialize for RBytes {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        match std::str::from_utf8(&self.0) {
            Ok(text) => serializer.serialize_str(text),
            Err(_) => {
                let mut map = serializer.serialize_map(Some(1))?;
                map.serialize_entry("$b", &STANDARD.encode(&self.0))?;
                map.end()
            }
        }
    }
}

impl<'de> Deserialize<'de> for RBytes {
    fn deserialize<D: Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        struct RBytesVisitor;

        impl<'de> Visitor<'de> for RBytesVisitor {
            type Value = RBytes;

            fn expecting(&self, f: &mut fmt::Formatter) -> fmt::Result {
                f.write_str("a string or {\"$b\": base64}")
            }

            fn visit_str<E: de::Error>(self, v: &str) -> Result<RBytes, E> {
                Ok(RBytes(v.as_bytes().to_vec()))
            }

            fn visit_string<E: de::Error>(self, v: String) -> Result<RBytes, E> {
                Ok(RBytes(v.into_bytes()))
            }

            fn visit_map<A: MapAccess<'de>>(self, mut map: A) -> Result<RBytes, A::Error> {
                let mut out = None;
                while let Some(key) = map.next_key::<String>()? {
                    if key == "$b" {
                        let encoded: String = map.next_value()?;
                        out = Some(STANDARD.decode(encoded).map_err(de::Error::custom)?);
                    } else {
                        map.next_value::<de::IgnoredAny>()?;
                    }
                }
                out.map(RBytes).ok_or_else(|| de::Error::missing_field("$b"))
            }
        }

        deserializer.deserialize_any(RBytesVisitor)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn utf8_round_trips_as_plain_string() {
        let value = RBytes::from("kullanıcı:1");
        let json = serde_json::to_string(&value).unwrap();
        assert_eq!(json, "\"kullanıcı:1\"");
        assert_eq!(serde_json::from_str::<RBytes>(&json).unwrap(), value);
    }

    #[test]
    fn binary_round_trips_as_base64_object() {
        let value = RBytes(vec![0xff, 0x00, 0x41]);
        let json = serde_json::to_string(&value).unwrap();
        assert_eq!(json, "{\"$b\":\"/wBB\"}");
        assert_eq!(serde_json::from_str::<RBytes>(&json).unwrap(), value);
    }
}
