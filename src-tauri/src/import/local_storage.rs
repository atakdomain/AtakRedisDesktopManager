//! Electron/Chromium localStorage (LevelDB) okuyucu. Özgün klasör hiç açılmaz: ARDM çalışıyor olabilir ve
//! LevelDB'yi açmak sıkıştırma/yazma yapabilir. Klasör (LOCK hariç) geçici bir kopyaya alınır, kopya okunur, silinir.
//!
//! Kayıt anahtarı `_` + köken + `\0` + betik anahtarı; betik anahtarı ve değer ilk bayta göre
//! `\x01` → Latin-1, `\x00` → UTF-16LE.

use rusty_leveldb::{LdbIterator, Options, DB};
use std::fs;
use std::path::{Path, PathBuf};

const PREFERRED_ORIGIN: &str = "file://";

/// localStorage'daki `name` değeri. Birden çok kökende varsa `file://` ve sonra `rank`'i en yüksek olan seçilir.
pub fn read_value(dir: &Path, name: &str, rank: impl Fn(&str) -> usize) -> Result<Option<String>, String> {
    let copy = TempCopy::of(dir)?;
    let options = Options { create_if_missing: false, ..Options::default() };
    let mut db = DB::open(copy.path(), options).map_err(|e| e.to_string())?;
    let mut best: Option<((bool, usize), String)> = None;
    {
        let mut entries = db.new_iter().map_err(|e| e.to_string())?;
        while let Some((key, value)) = entries.next() {
            let Some((origin, script_key)) = parse_entry_key(&key) else { continue };
            if script_key != name {
                continue;
            }
            let Some(text) = decode_string(&value) else { continue };
            let score = (origin == PREFERRED_ORIGIN, rank(&text));
            if best.as_ref().is_none_or(|(current, _)| score > *current) {
                best = Some((score, text));
            }
        }
    }
    drop(db);
    Ok(best.map(|(_, text)| text))
}

fn parse_entry_key(key: &[u8]) -> Option<(String, String)> {
    let rest = key.strip_prefix(b"_")?;
    let split = rest.iter().position(|&b| b == 0)?;
    let origin = String::from_utf8_lossy(&rest[..split]).into_owned();
    Some((origin, decode_string(&rest[split + 1..])?))
}

fn decode_string(bytes: &[u8]) -> Option<String> {
    match bytes.split_first()? {
        (1, latin1) => Some(latin1.iter().map(|&b| char::from(b)).collect()),
        (0, utf16) if utf16.len() % 2 == 0 => {
            let units: Vec<u16> = utf16.chunks_exact(2).map(|pair| u16::from_le_bytes([pair[0], pair[1]])).collect();
            Some(String::from_utf16_lossy(&units))
        }
        _ => None,
    }
}

/// Geçici kopya; düşünce silinir
struct TempCopy(PathBuf);

impl TempCopy {
    fn of(dir: &Path) -> Result<TempCopy, String> {
        let copy = TempCopy(std::env::temp_dir().join(format!("atak-rdm-ardm-{}", uuid::Uuid::new_v4())));
        fs::create_dir_all(&copy.0).map_err(|e| e.to_string())?;
        for entry in fs::read_dir(dir).map_err(|e| e.to_string())? {
            let entry = entry.map_err(|e| e.to_string())?;
            if entry.file_name() == "LOCK" || !entry.file_type().map_err(|e| e.to_string())?.is_file() {
                continue;
            }
            fs::copy(entry.path(), copy.0.join(entry.file_name())).map_err(|e| e.to_string())?;
        }
        Ok(copy)
    }

    fn path(&self) -> &Path {
        &self.0
    }
}

impl Drop for TempCopy {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.0);
    }
}

#[cfg(test)]
pub(crate) mod tests {
    use super::*;

    pub fn latin1(text: &str) -> Vec<u8> {
        std::iter::once(1).chain(text.chars().map(|c| u8::try_from(u32::from(c)).expect("Latin-1 text"))).collect()
    }

    pub fn utf16(text: &str) -> Vec<u8> {
        std::iter::once(0).chain(text.encode_utf16().flat_map(u16::to_le_bytes)).collect()
    }

    pub fn entry_key(origin: &str, script_key: Vec<u8>) -> Vec<u8> {
        [b"_".as_slice(), origin.as_bytes(), b"\0", &script_key].concat()
    }

    /// Chromium biçiminde sahte localStorage
    pub fn write_db(dir: &Path, entries: &[(Vec<u8>, Vec<u8>)]) {
        let mut db = DB::open(dir, Options::default()).unwrap();
        db.put(b"VERSION", b"1").unwrap();
        db.put(b"META:file://", b"\x08\x80\x80\x80\x80\x10\x10\x05").unwrap();
        for (key, value) in entries {
            db.put(key, value).unwrap();
        }
        db.flush().unwrap();
    }

    pub fn temp_dir() -> PathBuf {
        let dir = std::env::temp_dir().join(format!("atak-rdm-test-{}", uuid::Uuid::new_v4()));
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn decodes_both_encodings_and_prefers_file_origin() {
        let dir = temp_dir();
        write_db(
            &dir,
            &[
                (entry_key("file://", latin1("connections")), latin1("{\"a\":1}")),
                (entry_key("https://x", utf16("connections")), utf16("{\"ş\":1,\"b\":2}")),
                (entry_key("file://", latin1("other")), latin1("x")),
            ],
        );
        let snapshot = || -> Vec<(std::ffi::OsString, u64, std::time::SystemTime)> {
            let mut files: Vec<_> = fs::read_dir(&dir)
                .unwrap()
                .map(|e| e.unwrap())
                .map(|e| (e.file_name(), e.metadata().unwrap().len(), e.metadata().unwrap().modified().unwrap()))
                .collect();
            files.sort();
            files
        };
        let before = snapshot();
        let value = read_value(&dir, "connections", |text| text.len()).unwrap();
        assert_eq!(value.as_deref(), Some("{\"a\":1}"));
        assert_eq!(read_value(&dir, "missing", |_| 0).unwrap(), None);
        assert_eq!(snapshot(), before, "the original folder must stay untouched");
        fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn rank_decides_between_same_origins() {
        let dir = temp_dir();
        write_db(
            &dir,
            &[
                (entry_key("https://a", utf16("connections")), utf16("short")),
                (entry_key("https://b", latin1("connections")), latin1("the longest")),
            ],
        );
        assert_eq!(read_value(&dir, "connections", |t| t.len()).unwrap().as_deref(), Some("the longest"));
        fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn rejects_malformed_values() {
        assert_eq!(decode_string(&[0, 0x41]), None);
        assert_eq!(decode_string(&[2, 0x41]), None);
        assert_eq!(decode_string(&[]), None);
        assert_eq!(decode_string(&utf16("İzmir")).as_deref(), Some("İzmir"));
        assert_eq!(parse_entry_key(b"VERSION"), None);
    }
}
