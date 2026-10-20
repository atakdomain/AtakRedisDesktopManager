use crate::bytes::RBytes;
use crate::error::AppResult;
use crate::model::{KeyInfo, KeyMeta, NewKey};
use crate::state::AppState;
use tauri::State;

#[tauri::command]
pub async fn keys_meta(state: State<'_, AppState>, connection_id: String, db: u32, keys: Vec<RBytes>) -> AppResult<Vec<KeyMeta>> {
    state.sessions.get(&state.store, &connection_id).await?.keys_meta(db, keys).await
}

#[tauri::command]
pub async fn key_info(state: State<'_, AppState>, connection_id: String, db: u32, key: RBytes) -> AppResult<KeyInfo> {
    state.sessions.get(&state.store, &connection_id).await?.key_info(db, key.as_slice()).await
}

/// Anahtar varsa `exists` hatası
#[tauri::command]
pub async fn key_create(state: State<'_, AppState>, connection_id: String, db: u32, spec: NewKey) -> AppResult<()> {
    state.sessions.get(&state.store, &connection_id).await?.key_create(db, spec).await
}

#[tauri::command]
pub async fn key_delete(state: State<'_, AppState>, connection_id: String, db: u32, keys: Vec<RBytes>) -> AppResult<u64> {
    state.sessions.get(&state.store, &connection_id).await?.key_delete(db, keys).await
}

/// `overwrite` değilse hedef varken `exists` hatası
#[tauri::command]
pub async fn key_rename(
    state: State<'_, AppState>,
    connection_id: String,
    db: u32,
    key: RBytes,
    new_key: RBytes,
    overwrite: bool,
) -> AppResult<()> {
    let session = state.sessions.get(&state.store, &connection_id).await?;
    session.key_rename(db, key.as_slice(), new_key.as_slice(), overwrite).await
}

/// Aynı veritabanında yeni ada kopya (TTL korunur)
#[tauri::command]
pub async fn key_copy(
    state: State<'_, AppState>,
    connection_id: String,
    db: u32,
    key: RBytes,
    new_key: RBytes,
    overwrite: bool,
) -> AppResult<()> {
    let session = state.sessions.get(&state.store, &connection_id).await?;
    session.key_copy(db, key.as_slice(), new_key.as_slice(), overwrite).await
}

#[tauri::command]
pub async fn key_expire(state: State<'_, AppState>, connection_id: String, db: u32, key: RBytes, ttl_ms: i64) -> AppResult<()> {
    state.sessions.get(&state.store, &connection_id).await?.key_expire(db, key.as_slice(), ttl_ms).await
}
