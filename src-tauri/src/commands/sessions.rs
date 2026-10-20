#![allow(unused_variables)]
use super::not_implemented;
use crate::error::AppResult;
use crate::model::{DbInfo, SessionInfo};
use crate::state::AppState;
use tauri::State;

#[tauri::command]
pub async fn session_open(state: State<'_, AppState>, connection_id: String) -> AppResult<SessionInfo> {
    not_implemented()
}

#[tauri::command]
pub async fn session_close(state: State<'_, AppState>, connection_id: String) -> AppResult<()> {
    not_implemented()
}

#[tauri::command]
pub async fn db_list(state: State<'_, AppState>, connection_id: String) -> AppResult<Vec<DbInfo>> {
    not_implemented()
}
