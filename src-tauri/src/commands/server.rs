//! `node` boş = varsayılan düğüm, değilse `SessionInfo.nodes` içindeki "host:port"
use crate::error::AppResult;
use crate::model::{ConfigItem, SlowlogEntry};
use crate::session::Session;
use crate::state::AppState;
use std::sync::Arc;
use tauri::State;

async fn session(state: &AppState, connection_id: &str) -> AppResult<Arc<Session>> {
    state.sessions.get(&state.store, connection_id).await
}

#[tauri::command]
pub async fn server_info(state: State<'_, AppState>, connection_id: String, node: String) -> AppResult<String> {
    session(&state, &connection_id).await?.server_info(&node).await
}

#[tauri::command]
pub async fn server_slowlog(state: State<'_, AppState>, connection_id: String, node: String, count: u32) -> AppResult<Vec<SlowlogEntry>> {
    session(&state, &connection_id).await?.server_slowlog(&node, count).await
}

#[tauri::command]
pub async fn server_slowlog_reset(state: State<'_, AppState>, connection_id: String, node: String) -> AppResult<()> {
    session(&state, &connection_id).await?.server_slowlog_reset(&node).await
}

#[tauri::command]
pub async fn server_clients(state: State<'_, AppState>, connection_id: String, node: String) -> AppResult<String> {
    session(&state, &connection_id).await?.server_clients(&node).await
}

/// Boş desen "*"
#[tauri::command]
pub async fn server_config(state: State<'_, AppState>, connection_id: String, node: String, pattern: String) -> AppResult<Vec<ConfigItem>> {
    session(&state, &connection_id).await?.server_config(&node, &pattern).await
}

#[tauri::command]
pub async fn server_config_set(state: State<'_, AppState>, connection_id: String, node: String, name: String, value: String) -> AppResult<()> {
    session(&state, &connection_id).await?.server_config_set(&node, &name, &value).await
}
