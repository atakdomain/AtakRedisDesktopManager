use crate::error::AppResult;
use crate::model::{KeyFilter, ScanBatch, ScanResult};
use crate::scan;
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
    let handle = state.tasks.register(&scan_id);
    let result = async {
        let session = state.sessions.get(&state.store, &connection_id).await?;
        let on_batch = |batch| {
            let _ = on_batch.send(batch);
        };
        scan::scan_page(&session, db, &filter, &cursor, limit, &handle.token, on_batch).await
    }
    .await;
    state.tasks.finish(&scan_id, &handle);
    result
}

#[tauri::command]
pub async fn scan_cancel(state: State<'_, AppState>, scan_id: String) -> AppResult<()> {
    state.tasks.cancel(&scan_id);
    Ok(())
}
