use crate::bytes::RBytes;
use crate::error::AppResult;
use crate::model::{HashEntry, HashPage, KeyFilter, ListPage, SetPage, StreamGroup, StreamPage, StringValue, ZSetPage};
use crate::session::Session;
use crate::state::AppState;
use std::sync::Arc;
use tauri::State;

type S<'a> = State<'a, AppState>;

async fn session(state: &AppState, connection_id: &str) -> AppResult<Arc<Session>> {
    state.sessions.get(&state.store, connection_id).await
}

// ── string ──

#[tauri::command]
pub async fn string_get(state: S<'_>, connection_id: String, db: u32, key: RBytes) -> AppResult<StringValue> {
    session(&state, &connection_id).await?.string_get(db, key.as_slice()).await
}

/// TTL korunur
#[tauri::command]
pub async fn string_set(state: S<'_>, connection_id: String, db: u32, key: RBytes, value: RBytes) -> AppResult<()> {
    session(&state, &connection_id).await?.string_set(db, key.as_slice(), value.as_slice()).await
}

// ── hash ──

/// `filter.term` boşsa tümü; HSCAN MATCH desenini `pattern` modülü üretir
#[tauri::command]
pub async fn hash_scan(state: S<'_>, connection_id: String, db: u32, key: RBytes, cursor: String, filter: KeyFilter, count: u32) -> AppResult<HashPage> {
    session(&state, &connection_id).await?.hash_scan(db, key.as_slice(), &cursor, &filter, count).await
}

/// `old_field` verilirse alan yeniden adlandırılır (MULTI içinde HSET + HDEL)
#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub async fn hash_set(state: S<'_>, connection_id: String, db: u32, key: RBytes, field: RBytes, value: RBytes, old_field: Option<RBytes>) -> AppResult<()> {
    let session = session(&state, &connection_id).await?;
    session.hash_set(db, key.as_slice(), field.as_slice(), value.as_slice(), old_field.as_ref().map(RBytes::as_slice)).await
}

#[tauri::command]
pub async fn hash_delete(state: S<'_>, connection_id: String, db: u32, key: RBytes, fields: Vec<RBytes>) -> AppResult<u64> {
    session(&state, &connection_id).await?.hash_delete(db, key.as_slice(), &fields).await
}

// ── list ──

#[tauri::command]
pub async fn list_range(state: S<'_>, connection_id: String, db: u32, key: RBytes, start: i64, count: u32) -> AppResult<ListPage> {
    session(&state, &connection_id).await?.list_range(db, key.as_slice(), start, count).await
}

#[tauri::command]
pub async fn list_set(state: S<'_>, connection_id: String, db: u32, key: RBytes, index: i64, value: RBytes) -> AppResult<()> {
    session(&state, &connection_id).await?.list_set(db, key.as_slice(), index, value.as_slice()).await
}

/// Yeni uzunluğu döndürür
#[tauri::command]
pub async fn list_push(state: S<'_>, connection_id: String, db: u32, key: RBytes, values: Vec<RBytes>, tail: bool) -> AppResult<u64> {
    session(&state, &connection_id).await?.list_push(db, key.as_slice(), &values, tail).await
}

/// Dizinlerdeki öğeleri siler (LSET ile işaretleyip LREM; MULTI içinde)
#[tauri::command]
pub async fn list_delete(state: S<'_>, connection_id: String, db: u32, key: RBytes, indexes: Vec<i64>) -> AppResult<u64> {
    session(&state, &connection_id).await?.list_delete(db, key.as_slice(), &indexes).await
}

// ── set ──

#[tauri::command]
pub async fn set_scan(state: S<'_>, connection_id: String, db: u32, key: RBytes, cursor: String, filter: KeyFilter, count: u32) -> AppResult<SetPage> {
    session(&state, &connection_id).await?.set_scan(db, key.as_slice(), &cursor, &filter, count).await
}

#[tauri::command]
pub async fn set_add(state: S<'_>, connection_id: String, db: u32, key: RBytes, members: Vec<RBytes>) -> AppResult<u64> {
    session(&state, &connection_id).await?.set_add(db, key.as_slice(), &members).await
}

#[tauri::command]
pub async fn set_delete(state: S<'_>, connection_id: String, db: u32, key: RBytes, members: Vec<RBytes>) -> AppResult<u64> {
    session(&state, &connection_id).await?.set_delete(db, key.as_slice(), &members).await
}

#[tauri::command]
pub async fn set_replace(state: S<'_>, connection_id: String, db: u32, key: RBytes, old_member: RBytes, new_member: RBytes) -> AppResult<()> {
    session(&state, &connection_id).await?.set_replace(db, key.as_slice(), old_member.as_slice(), new_member.as_slice()).await
}

// ── zset ──

#[tauri::command]
pub async fn zset_range(state: S<'_>, connection_id: String, db: u32, key: RBytes, start: i64, count: u32, desc: bool) -> AppResult<ZSetPage> {
    session(&state, &connection_id).await?.zset_range(db, key.as_slice(), start, count, desc).await
}

#[tauri::command]
pub async fn zset_scan(state: S<'_>, connection_id: String, db: u32, key: RBytes, cursor: String, filter: KeyFilter, count: u32) -> AppResult<ZSetPage> {
    session(&state, &connection_id).await?.zset_scan(db, key.as_slice(), &cursor, &filter, count).await
}

#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub async fn zset_add(state: S<'_>, connection_id: String, db: u32, key: RBytes, member: RBytes, score: f64, old_member: Option<RBytes>) -> AppResult<()> {
    let session = session(&state, &connection_id).await?;
    session.zset_add(db, key.as_slice(), member.as_slice(), score, old_member.as_ref().map(RBytes::as_slice)).await
}

#[tauri::command]
pub async fn zset_delete(state: S<'_>, connection_id: String, db: u32, key: RBytes, members: Vec<RBytes>) -> AppResult<u64> {
    session(&state, &connection_id).await?.zset_delete(db, key.as_slice(), &members).await
}

// ── stream ──

#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub async fn stream_range(state: S<'_>, connection_id: String, db: u32, key: RBytes, start: String, end: String, count: u32, desc: bool) -> AppResult<StreamPage> {
    session(&state, &connection_id).await?.stream_range(db, key.as_slice(), &start, &end, count, desc).await
}

/// Eklenen girdinin kimliği
#[tauri::command]
pub async fn stream_add(state: S<'_>, connection_id: String, db: u32, key: RBytes, id: String, fields: Vec<HashEntry>) -> AppResult<String> {
    session(&state, &connection_id).await?.stream_add(db, key.as_slice(), &id, &fields).await
}

#[tauri::command]
pub async fn stream_delete(state: S<'_>, connection_id: String, db: u32, key: RBytes, ids: Vec<String>) -> AppResult<u64> {
    session(&state, &connection_id).await?.stream_delete(db, key.as_slice(), &ids).await
}

#[tauri::command]
pub async fn stream_groups(state: S<'_>, connection_id: String, db: u32, key: RBytes) -> AppResult<Vec<StreamGroup>> {
    session(&state, &connection_id).await?.stream_groups(db, key.as_slice()).await
}

// ── ReJSON ──

#[tauri::command]
pub async fn json_get(state: S<'_>, connection_id: String, db: u32, key: RBytes) -> AppResult<String> {
    session(&state, &connection_id).await?.json_get(db, key.as_slice()).await
}

#[tauri::command]
pub async fn json_set(state: S<'_>, connection_id: String, db: u32, key: RBytes, value: String) -> AppResult<()> {
    session(&state, &connection_id).await?.json_set(db, key.as_slice(), &value).await
}
