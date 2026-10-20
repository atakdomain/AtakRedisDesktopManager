#![allow(unused_variables)]
use super::not_implemented;
use crate::bytes::RBytes;
use crate::error::AppResult;

/// format: gzip / deflate / zlib / brotli
#[tauri::command]
pub async fn codec_decode(data: RBytes, format: String) -> AppResult<RBytes> {
    not_implemented()
}

#[tauri::command]
pub async fn codec_encode(data: RBytes, format: String) -> AppResult<RBytes> {
    not_implemented()
}
