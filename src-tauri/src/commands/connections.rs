use crate::error::AppResult;
use crate::model::{ConnectionConfig, TestResult};
use crate::session;
use crate::state::AppState;
use tauri::State;

/// Kaydetme/silme anahtar zincirine dokunur (bloklayıcı)
fn blocking<T>(f: impl FnOnce() -> T) -> T {
    tokio::task::block_in_place(f)
}

#[tauri::command]
pub async fn connections_list(state: State<'_, AppState>) -> AppResult<Vec<ConnectionConfig>> {
    Ok(state.store.list())
}

/// Açık oturum eski yapılandırmayla kalmasın diye kapatılır
#[tauri::command]
pub async fn connection_save(state: State<'_, AppState>, config: ConnectionConfig) -> AppResult<ConnectionConfig> {
    let saved = blocking(|| state.store.save(config))?;
    state.sessions.close(&saved.id).await;
    Ok(saved)
}

#[tauri::command]
pub async fn connections_save_many(state: State<'_, AppState>, configs: Vec<ConnectionConfig>) -> AppResult<Vec<ConnectionConfig>> {
    let saved = blocking(|| state.store.save_many(configs))?;
    for config in &saved {
        state.sessions.close(&config.id).await;
    }
    Ok(saved)
}

#[tauri::command]
pub async fn connection_delete(state: State<'_, AppState>, id: String) -> AppResult<()> {
    state.sessions.close(&id).await;
    blocking(|| state.store.delete(&id))
}

#[tauri::command]
pub async fn connections_reorder(state: State<'_, AppState>, ids: Vec<String>) -> AppResult<()> {
    blocking(|| state.store.reorder(&ids))
}

/// Bir kez bağlanır, PING + INFO, kapatır; hiçbir şey saklanmaz
#[tauri::command]
pub async fn connection_test(state: State<'_, AppState>, config: ConnectionConfig) -> AppResult<TestResult> {
    let session = state.sessions.connect_once(&config).await?;
    let result = session.test().await;
    session::dispose(session).await;
    result
}
