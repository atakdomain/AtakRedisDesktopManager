use crate::error::AppResult;
use crate::model::{DbInfo, SessionInfo};
use crate::state::AppState;
use tauri::State;

/// Açıksa kapatıp yeniden bağlanır
#[tauri::command]
pub async fn session_open(state: State<'_, AppState>, connection_id: String) -> AppResult<SessionInfo> {
    Ok(state.sessions.open(&state.store, &connection_id).await?.info())
}

#[tauri::command]
pub async fn session_close(state: State<'_, AppState>, connection_id: String) -> AppResult<()> {
    state.sessions.close(&connection_id).await;
    Ok(())
}

#[tauri::command]
pub async fn db_list(state: State<'_, AppState>, connection_id: String) -> AppResult<Vec<DbInfo>> {
    state.sessions.get(&state.store, &connection_id).await?.db_list().await
}
