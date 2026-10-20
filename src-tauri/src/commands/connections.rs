#![allow(unused_variables)]
use super::not_implemented;
use crate::error::AppResult;
use crate::model::{ConnectionConfig, TestResult};
use crate::state::AppState;
use tauri::State;

#[tauri::command]
pub async fn connections_list(state: State<'_, AppState>) -> AppResult<Vec<ConnectionConfig>> {
    not_implemented()
}

#[tauri::command]
pub async fn connection_save(state: State<'_, AppState>, config: ConnectionConfig) -> AppResult<ConnectionConfig> {
    not_implemented()
}

#[tauri::command]
pub async fn connections_save_many(state: State<'_, AppState>, configs: Vec<ConnectionConfig>) -> AppResult<Vec<ConnectionConfig>> {
    not_implemented()
}

#[tauri::command]
pub async fn connection_delete(state: State<'_, AppState>, id: String) -> AppResult<()> {
    not_implemented()
}

#[tauri::command]
pub async fn connections_reorder(state: State<'_, AppState>, ids: Vec<String>) -> AppResult<()> {
    not_implemented()
}

#[tauri::command]
pub async fn connection_test(state: State<'_, AppState>, config: ConnectionConfig) -> AppResult<TestResult> {
    not_implemented()
}
