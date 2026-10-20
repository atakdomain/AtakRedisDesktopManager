#![allow(unused_variables)]
use super::not_implemented;
use crate::bytes::RBytes;
use crate::error::AppResult;
use crate::model::{KeyInfo, KeyMeta, NewKey};
use crate::state::AppState;
use tauri::State;

#[tauri::command]
pub async fn keys_meta(state: State<'_, AppState>, connection_id: String, db: u32, keys: Vec<RBytes>) -> AppResult<Vec<KeyMeta>> {
    not_implemented()
}

#[tauri::command]
pub async fn key_info(state: State<'_, AppState>, connection_id: String, db: u32, key: RBytes) -> AppResult<KeyInfo> {
    not_implemented()
}

#[tauri::command]
pub async fn key_create(state: State<'_, AppState>, connection_id: String, db: u32, spec: NewKey) -> AppResult<()> {
    not_implemented()
}

#[tauri::command]
pub async fn key_delete(state: State<'_, AppState>, connection_id: String, db: u32, keys: Vec<RBytes>) -> AppResult<u64> {
    not_implemented()
}

#[tauri::command]
pub async fn key_rename(
    state: State<'_, AppState>,
    connection_id: String,
    db: u32,
    key: RBytes,
    new_key: RBytes,
    overwrite: bool,
) -> AppResult<()> {
    not_implemented()
}

#[tauri::command]
pub async fn key_expire(state: State<'_, AppState>, connection_id: String, db: u32, key: RBytes, ttl_ms: i64) -> AppResult<()> {
    not_implemented()
}
