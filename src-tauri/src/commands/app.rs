#![allow(unused_variables)]
use super::not_implemented;
use crate::error::AppResult;
use crate::model::AppInfo;
use crate::state::AppState;
use tauri::State;

#[tauri::command]
pub async fn app_info(state: State<'_, AppState>) -> AppResult<AppInfo> {
    not_implemented()
}

#[tauri::command]
pub async fn store_get(state: State<'_, AppState>, name: String) -> AppResult<serde_json::Value> {
    not_implemented()
}

#[tauri::command]
pub async fn store_set(state: State<'_, AppState>, name: String, value: serde_json::Value) -> AppResult<()> {
    not_implemented()
}
