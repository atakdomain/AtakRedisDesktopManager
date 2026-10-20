#![allow(unused_variables)]
use super::not_implemented;
use crate::error::AppResult;
use crate::model::{ArdmScan, ImportCandidate};
use crate::state::AppState;
use tauri::State;

/// ARDM'nin yerel verisini (Electron localStorage, LevelDB) bulup okur
#[tauri::command]
pub async fn ardm_detect(state: State<'_, AppState>) -> AppResult<ArdmScan> {
    not_implemented()
}

/// ARDM "Export" dosyası (.ardm: base64 JSON) ya da düz JSON
#[tauri::command]
pub async fn ardm_read_file(state: State<'_, AppState>, path: String) -> AppResult<Vec<ImportCandidate>> {
    not_implemented()
}
