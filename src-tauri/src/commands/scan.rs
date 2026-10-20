#![allow(unused_variables)]
use super::not_implemented;
use crate::error::AppResult;
use crate::model::{KeyFilter, ScanBatch, ScanResult};
use crate::state::AppState;
use tauri::ipc::Channel;
use tauri::State;

#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub async fn keys_scan(
    state: State<'_, AppState>,
    connection_id: String,
    db: u32,
    filter: KeyFilter,
    cursor: String,
    limit: u32,
    scan_id: String,
    on_batch: Channel<ScanBatch>,
) -> AppResult<ScanResult> {
    not_implemented()
}

#[tauri::command]
pub async fn scan_cancel(state: State<'_, AppState>, scan_id: String) -> AppResult<()> {
    not_implemented()
}
