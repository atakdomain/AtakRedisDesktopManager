#![allow(unused_variables)]
use super::not_implemented;
use crate::error::AppResult;
use crate::model::{ConsoleReply, PubSubMessage};
use crate::state::AppState;
use tauri::ipc::Channel;
use tauri::State;

/// `node` boş = otomatik yönlendirme
#[tauri::command]
pub async fn console_exec(state: State<'_, AppState>, connection_id: String, db: u32, line: String, node: String) -> AppResult<ConsoleReply> {
    not_implemented()
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
    not_implemented()
}

#[tauri::command]
pub async fn monitor_start(state: State<'_, AppState>, connection_id: String, node: String, sub_id: String, on_line: Channel<String>) -> AppResult<()> {
    not_implemented()
}

#[tauri::command]
pub async fn subscription_stop(state: State<'_, AppState>, sub_id: String) -> AppResult<()> {
    not_implemented()
}
