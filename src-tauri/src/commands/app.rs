use crate::error::AppResult;
use crate::model::AppInfo;
use crate::state::AppState;
use tauri::{AppHandle, State};

#[tauri::command]
pub async fn app_info(app: AppHandle, state: State<'_, AppState>) -> AppResult<AppInfo> {
    let platform = match std::env::consts::OS {
        "windows" => "windows",
        "macos" => "macos",
        "linux" => "linux",
        other => other,
    };
    Ok(AppInfo {
        version: app.package_info().version.to_string(),
        platform: platform.into(),
        config_dir: state.store.config_dir().display().to_string(),
        secure_storage: state.store.secure_storage(),
    })
}

#[tauri::command]
pub async fn store_get(state: State<'_, AppState>, name: String) -> AppResult<serde_json::Value> {
    state.store.doc_get(&name)
}

#[tauri::command]
pub async fn store_set(state: State<'_, AppState>, name: String, value: serde_json::Value) -> AppResult<()> {
    state.store.doc_set(&name, &value)
}
