//! Tauri komutları. Her dosyanın sahibi tek bir ajandır (bkz. docs/architecture.md).
use crate::error::{AppError, AppResult};

pub mod app;
pub mod bulk;
pub mod codec;
pub mod connections;
pub mod console;
pub mod import;
pub mod keys;
pub mod scan;
pub mod server;
pub mod sessions;
pub mod values;

/// İskelet gövdesi; gerçek uygulama gelince kaldırılır.
pub(crate) fn not_implemented<T>() -> AppResult<T> {
    Err(AppError::internal("not implemented"))
}
