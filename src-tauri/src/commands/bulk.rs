use crate::bulk;
use crate::error::AppResult;
use crate::model::{BulkAction, BulkEvent, BulkSpec, BulkSummary};
use crate::state::AppState;
use tauri::ipc::Channel;
use tauri::State;

/// İş bitene dek bekler; olaylar kanala akar
#[tauri::command]
pub async fn bulk_start(
    state: State<'_, AppState>,
    spec: BulkSpec,
    job_id: String,
    on_event: Channel<BulkEvent>,
) -> AppResult<BulkSummary> {
    let handle = state.tasks.register(&job_id);
    let result = async {
        let source = state.sessions.get(&state.store, &spec.connection_id).await?;
        let target = match &spec.action {
            BulkAction::Copy { target_connection_id, .. }
                if !target_connection_id.is_empty() && *target_connection_id != spec.connection_id =>
            {
                state.sessions.get(&state.store, target_connection_id).await?
            }
            _ => source.clone(),
        };
        let emit = |event| {
            let _ = on_event.send(event);
        };
        bulk::run(&source, &target, &spec, &handle.token, &emit).await
    }
    .await;
    state.tasks.finish(&job_id, &handle);
    result
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
    let handle = state.tasks.register(&job_id);
    let result = async {
        let session = state.sessions.get(&state.store, &connection_id).await?;
        let emit = |event| {
            let _ = on_event.send(event);
        };
        bulk::import_file(&session, db, &path, replace, &handle.token, &emit).await
    }
    .await;
    state.tasks.finish(&job_id, &handle);
    result
}

#[tauri::command]
pub async fn bulk_cancel(state: State<'_, AppState>, job_id: String) -> AppResult<()> {
    state.tasks.cancel(&job_id);
    Ok(())
}
