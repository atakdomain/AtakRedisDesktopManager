use crate::bytes::RBytes;
use crate::error::{AppError, AppResult};
use std::io::{Read, Write};

#[derive(Clone, Copy)]
enum Format {
    Gzip,
    /// Ham deflate (başlıksız)
    Deflate,
    Zlib,
    Brotli,
}

fn format(name: &str) -> AppResult<Format> {
    match name {
        "gzip" => Ok(Format::Gzip),
        "deflate" => Ok(Format::Deflate),
        "zlib" => Ok(Format::Zlib),
        "brotli" => Ok(Format::Brotli),
        other => Err(AppError::invalid(format!("unknown codec: {other}"))),
    }
}

fn decode(data: &[u8], format: Format) -> std::io::Result<Vec<u8>> {
    let mut out = Vec::new();
    match format {
        Format::Gzip => flate2::read::GzDecoder::new(data).read_to_end(&mut out)?,
        Format::Deflate => flate2::read::DeflateDecoder::new(data).read_to_end(&mut out)?,
        Format::Zlib => flate2::read::ZlibDecoder::new(data).read_to_end(&mut out)?,
        Format::Brotli => brotli::Decompressor::new(data, 4096).read_to_end(&mut out)?,
    };
    Ok(out)
}

fn encode(data: &[u8], format: Format) -> std::io::Result<Vec<u8>> {
    let level = flate2::Compression::default();
    match format {
        Format::Gzip => {
            let mut encoder = flate2::write::GzEncoder::new(Vec::new(), level);
            encoder.write_all(data)?;
            encoder.finish()
        }
        Format::Deflate => {
            let mut encoder = flate2::write::DeflateEncoder::new(Vec::new(), level);
            encoder.write_all(data)?;
            encoder.finish()
        }
        Format::Zlib => {
            let mut encoder = flate2::write::ZlibEncoder::new(Vec::new(), level);
            encoder.write_all(data)?;
            encoder.finish()
        }
        Format::Brotli => {
            let mut out = Vec::new();
            {
                let mut encoder = brotli::CompressorWriter::new(&mut out, 4096, 9, 22);
                encoder.write_all(data)?;
            }
            Ok(out)
        }
    }
}

/// format: gzip / deflate / zlib / brotli
#[tauri::command]
pub async fn codec_decode(data: RBytes, format: String) -> AppResult<RBytes> {
    let format = self::format(&format)?;
    let decoded = tokio::task::spawn_blocking(move || decode(data.as_slice(), format))
        .await
        .map_err(|err| AppError::internal(err.to_string()))?;
    decoded.map(RBytes).map_err(|err| AppError::invalid(format!("cannot decode: {err}")))
}

#[tauri::command]
pub async fn codec_encode(data: RBytes, format: String) -> AppResult<RBytes> {
    let format = self::format(&format)?;
    let encoded = tokio::task::spawn_blocking(move || encode(data.as_slice(), format))
        .await
        .map_err(|err| AppError::internal(err.to_string()))?;
    encoded.map(RBytes).map_err(|err| AppError::invalid(format!("cannot encode: {err}")))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn round_trips_every_format() {
        let data = "merhaba dünya ".repeat(50).into_bytes();
        for name in ["gzip", "deflate", "zlib", "brotli"] {
            let format = format(name).unwrap();
            let packed = encode(&data, format).unwrap();
            assert!(packed.len() < data.len(), "{name}");
            assert_eq!(decode(&packed, format).unwrap(), data, "{name}");
        }
    }

    #[test]
    fn rejects_unknown_format_and_corrupt_data() {
        assert!(format("lz4").is_err());
        assert!(decode(b"not gzip at all", Format::Gzip).is_err());
        assert!(decode(b"\xff\xff\xff", Format::Brotli).is_err());
    }
}
