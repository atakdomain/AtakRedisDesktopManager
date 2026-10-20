use crate::error::{AppError, AppResult};
use crate::import;
use crate::model::{ArdmScan, ImportCandidate};
use crate::state::AppState;
use std::path::PathBuf;
use tauri::State;

/// ARDM'nin yerel verisini (Electron localStorage, LevelDB) bulup okur
#[tauri::command]
pub async fn ardm_detect(state: State<'_, AppState>) -> AppResult<ArdmScan> {
    let existing = state.store.list();
    tokio::task::spawn_blocking(move || import::detect(&existing))
        .await
        .map_err(|e| AppError::internal(e.to_string()))
}

/// ARDM "Export" dosyası (.ardm: base64 JSON) ya da düz JSON
#[tauri::command]
pub async fn ardm_read_file(state: State<'_, AppState>, path: String) -> AppResult<Vec<ImportCandidate>> {
    let existing = state.store.list();
    tokio::task::spawn_blocking(move || import::read_file(&PathBuf::from(path), &existing))
        .await
        .map_err(|e| AppError::internal(e.to_string()))?
}
