mod bulk;
mod bytes;
mod commands;
mod console;
mod error;
mod import;
mod model;
mod net;
mod pattern;
mod scan;
mod session;
mod state;
mod store;

use state::{AppState, TaskRegistry};
use tauri::Manager;

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_window_state::Builder::default().build())
        .plugin(tauri_plugin_clipboard_manager::init())
        .setup(|app| {
            // Taşınabilir kullanım ve uçtan uca testler için yapılandırma klasörü değiştirilebilir
            let dir = match std::env::var_os("ATAK_RDM_CONFIG_DIR") {
                Some(dir) => std::path::PathBuf::from(dir),
                None => app.path().app_config_dir()?,
            };
            std::fs::create_dir_all(&dir)?;
            app.manage(AppState {
                store: store::Store::load(dir)?,
                sessions: session::SessionManager::default(),
                tasks: TaskRegistry::default(),
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::app::app_info,
            commands::app::store_get,
            commands::app::store_set,
            commands::connections::connections_list,
            commands::connections::connection_save,
            commands::connections::connections_save_many,
            commands::connections::connection_delete,
            commands::connections::connections_reorder,
            commands::connections::connection_test,
            commands::sessions::session_open,
            commands::sessions::session_close,
            commands::sessions::db_list,
            commands::scan::keys_scan,
            commands::scan::scan_cancel,
            commands::keys::keys_meta,
            commands::keys::key_info,
            commands::keys::key_create,
            commands::keys::key_delete,
            commands::keys::key_rename,
            commands::keys::key_copy,
            commands::keys::key_expire,
            commands::values::string_get,
            commands::values::string_set,
            commands::values::hash_scan,
            commands::values::hash_set,
            commands::values::hash_delete,
            commands::values::list_range,
            commands::values::list_set,
            commands::values::list_push,
            commands::values::list_delete,
            commands::values::set_scan,
            commands::values::set_add,
            commands::values::set_delete,
            commands::values::set_replace,
            commands::values::zset_range,
            commands::values::zset_scan,
            commands::values::zset_add,
            commands::values::zset_delete,
            commands::values::stream_range,
            commands::values::stream_add,
            commands::values::stream_delete,
            commands::values::stream_groups,
            commands::values::json_get,
            commands::values::json_set,
            commands::console::console_exec,
            commands::console::pubsub_subscribe,
            commands::console::monitor_start,
            commands::console::subscription_stop,
            commands::server::server_info,
            commands::server::server_slowlog,
            commands::server::server_slowlog_reset,
            commands::server::server_clients,
            commands::server::server_config,
            commands::server::server_config_set,
            commands::bulk::bulk_start,
            commands::bulk::bulk_import,
            commands::bulk::bulk_cancel,
            commands::import::ardm_detect,
            commands::import::ardm_read_file,
            commands::codec::codec_decode,
            commands::codec::codec_encode,
        ])
        .run(tauri::generate_context!())
        .expect("uygulama başlatılamadı");
}
