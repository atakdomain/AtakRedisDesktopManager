#![allow(unused_variables)]
use super::not_implemented;
use crate::error::AppResult;
use crate::model::{BulkEvent, BulkSpec, BulkSummary};
use crate::state::AppState;
use tauri::ipc::Channel;
use tauri::State;

/// İş bitene dek bekler; olaylar kanala akar
#[tauri::command]
pub async fn bulk_start(state: State<'_, AppState>, spec: BulkSpec, job_id: String, on_event: Channel<BulkEvent>) -> AppResult<BulkSummary> {
    not_implemented()
}

/// Export dosyasını (dump ya da json) geri yükler
#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub async fn bulk_import(
    state: State<'_, AppState>,
    connection_id: String,
    db: u32,
    path: String,
    replace: bool,
    job_id: String,
    on_event: Channel<BulkEvent>,
) -> AppResult<BulkSummary> {
    not_implemented()
}

#[tauri::command]
pub async fn bulk_cancel(state: State<'_, AppState>, job_id: String) -> AppResult<()> {
    not_implemented()
}
