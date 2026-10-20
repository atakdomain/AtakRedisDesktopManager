use crate::console;
use crate::error::AppResult;
use crate::model::{ConsoleReply, PubSubMessage};
use crate::state::AppState;
use tauri::ipc::Channel;
use tauri::State;

/// `node` boş = otomatik yönlendirme
#[tauri::command]
pub async fn console_exec(state: State<'_, AppState>, connection_id: String, db: u32, line: String, node: String) -> AppResult<ConsoleReply> {
    let session = state.sessions.get(&state.store, &connection_id).await?;
    console::exec(&session, db, &line, &node).await
}

/// Abonelik `subscription_stop` gelene dek sürer
#[tauri::command]
pub async fn pubsub_subscribe(
    state: State<'_, AppState>,
    connection_id: String,
    channels: Vec<String>,
    patterns: Vec<String>,
    sub_id: String,
    on_message: Channel<PubSubMessage>,
) -> AppResult<()> {
    let session = state.sessions.get(&state.store, &connection_id).await?;
    let task = state.tasks.register(&sub_id);
    let result = console::subscribe(&session, &channels, &patterns, task.token.clone(), |message| on_message.send(message).is_ok()).await;
    state.tasks.finish(&sub_id, &task);
    result
}

#[tauri::command]
pub async fn monitor_start(state: State<'_, AppState>, connection_id: String, node: String, sub_id: String, on_line: Channel<String>) -> AppResult<()> {
    let session = state.sessions.get(&state.store, &connection_id).await?;
    let task = state.tasks.register(&sub_id);
    let result = console::monitor(&session, &node, task.token.clone(), |line| on_line.send(line).is_ok()).await;
    state.tasks.finish(&sub_id, &task);
    result
}

#[tauri::command]
pub async fn subscription_stop(state: State<'_, AppState>, sub_id: String) -> AppResult<()> {
    state.tasks.cancel(&sub_id);
    Ok(())
}
