#![allow(unused_variables)]
use super::not_implemented;
use crate::error::AppResult;
use crate::model::{ConfigItem, SlowlogEntry};
use crate::state::AppState;
use tauri::State;

#[tauri::command]
pub async fn server_info(state: State<'_, AppState>, connection_id: String, node: String) -> AppResult<String> {
    not_implemented()
}

#[tauri::command]
pub async fn server_slowlog(state: State<'_, AppState>, connection_id: String, node: String, count: u32) -> AppResult<Vec<SlowlogEntry>> {
    not_implemented()
}

#[tauri::command]
pub async fn server_slowlog_reset(state: State<'_, AppState>, connection_id: String, node: String) -> AppResult<()> {
    not_implemented()
}

#[tauri::command]
pub async fn server_clients(state: State<'_, AppState>, connection_id: String, node: String) -> AppResult<String> {
    not_implemented()
}

#[tauri::command]
pub async fn server_config(state: State<'_, AppState>, connection_id: String, node: String, pattern: String) -> AppResult<Vec<ConfigItem>> {
    not_implemented()
}

#[tauri::command]
pub async fn server_config_set(state: State<'_, AppState>, connection_id: String, node: String, name: String, value: String) -> AppResult<()> {
    not_implemented()
}
