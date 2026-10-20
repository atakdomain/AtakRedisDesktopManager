#![allow(unused_variables)]
use super::not_implemented;
use crate::bytes::RBytes;
use crate::error::AppResult;
use crate::model::{HashEntry, HashPage, KeyFilter, ListPage, SetPage, StreamGroup, StreamPage, StringValue, ZSetPage};
use crate::state::AppState;
use tauri::State;

type S<'a> = State<'a, AppState>;

// ── string ──

#[tauri::command]
pub async fn string_get(state: S<'_>, connection_id: String, db: u32, key: RBytes) -> AppResult<StringValue> {
    not_implemented()
}

/// TTL korunur
#[tauri::command]
pub async fn string_set(state: S<'_>, connection_id: String, db: u32, key: RBytes, value: RBytes) -> AppResult<()> {
    not_implemented()
}

// ── hash ──

/// `filter.term` boşsa tümü; HSCAN MATCH desenini `pattern` modülü üretir
#[tauri::command]
pub async fn hash_scan(state: S<'_>, connection_id: String, db: u32, key: RBytes, cursor: String, filter: KeyFilter, count: u32) -> AppResult<HashPage> {
    not_implemented()
}

/// `old_field` verilirse alan yeniden adlandırılır (MULTI içinde HSET + HDEL)
#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub async fn hash_set(state: S<'_>, connection_id: String, db: u32, key: RBytes, field: RBytes, value: RBytes, old_field: Option<RBytes>) -> AppResult<()> {
    not_implemented()
}

#[tauri::command]
pub async fn hash_delete(state: S<'_>, connection_id: String, db: u32, key: RBytes, fields: Vec<RBytes>) -> AppResult<u64> {
    not_implemented()
}

// ── list ──

#[tauri::command]
pub async fn list_range(state: S<'_>, connection_id: String, db: u32, key: RBytes, start: i64, count: u32) -> AppResult<ListPage> {
    not_implemented()
}

#[tauri::command]
pub async fn list_set(state: S<'_>, connection_id: String, db: u32, key: RBytes, index: i64, value: RBytes) -> AppResult<()> {
    not_implemented()
}

/// Yeni uzunluğu döndürür
#[tauri::command]
pub async fn list_push(state: S<'_>, connection_id: String, db: u32, key: RBytes, values: Vec<RBytes>, tail: bool) -> AppResult<u64> {
    not_implemented()
}

/// Dizinlerdeki öğeleri siler (LSET ile işaretleyip LREM; MULTI içinde)
#[tauri::command]
pub async fn list_delete(state: S<'_>, connection_id: String, db: u32, key: RBytes, indexes: Vec<i64>) -> AppResult<u64> {
    not_implemented()
}

// ── set ──

#[tauri::command]
pub async fn set_scan(state: S<'_>, connection_id: String, db: u32, key: RBytes, cursor: String, filter: KeyFilter, count: u32) -> AppResult<SetPage> {
    not_implemented()
}

#[tauri::command]
pub async fn set_add(state: S<'_>, connection_id: String, db: u32, key: RBytes, members: Vec<RBytes>) -> AppResult<u64> {
    not_implemented()
}

#[tauri::command]
pub async fn set_delete(state: S<'_>, connection_id: String, db: u32, key: RBytes, members: Vec<RBytes>) -> AppResult<u64> {
    not_implemented()
}

#[tauri::command]
pub async fn set_replace(state: S<'_>, connection_id: String, db: u32, key: RBytes, old_member: RBytes, new_member: RBytes) -> AppResult<()> {
    not_implemented()
}

// ── zset ──

#[tauri::command]
pub async fn zset_range(state: S<'_>, connection_id: String, db: u32, key: RBytes, start: i64, count: u32, desc: bool) -> AppResult<ZSetPage> {
    not_implemented()
}

#[tauri::command]
pub async fn zset_scan(state: S<'_>, connection_id: String, db: u32, key: RBytes, cursor: String, filter: KeyFilter, count: u32) -> AppResult<ZSetPage> {
    not_implemented()
}

#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub async fn zset_add(state: S<'_>, connection_id: String, db: u32, key: RBytes, member: RBytes, score: f64, old_member: Option<RBytes>) -> AppResult<()> {
    not_implemented()
}

#[tauri::command]
pub async fn zset_delete(state: S<'_>, connection_id: String, db: u32, key: RBytes, members: Vec<RBytes>) -> AppResult<u64> {
    not_implemented()
}

// ── stream ──

#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub async fn stream_range(state: S<'_>, connection_id: String, db: u32, key: RBytes, start: String, end: String, count: u32, desc: bool) -> AppResult<StreamPage> {
    not_implemented()
}

/// Eklenen girdinin kimliği
#[tauri::command]
pub async fn stream_add(state: S<'_>, connection_id: String, db: u32, key: RBytes, id: String, fields: Vec<HashEntry>) -> AppResult<String> {
    not_implemented()
}

#[tauri::command]
pub async fn stream_delete(state: S<'_>, connection_id: String, db: u32, key: RBytes, ids: Vec<String>) -> AppResult<u64> {
    not_implemented()
}

#[tauri::command]
pub async fn stream_groups(state: S<'_>, connection_id: String, db: u32, key: RBytes) -> AppResult<Vec<StreamGroup>> {
    not_implemented()
}

// ── ReJSON ──

#[tauri::command]
pub async fn json_get(state: S<'_>, connection_id: String, db: u32, key: RBytes) -> AppResult<String> {
    not_implemented()
}

#[tauri::command]
pub async fn json_set(state: S<'_>, connection_id: String, db: u32, key: RBytes, value: String) -> AppResult<()> {
    not_implemented()
}
