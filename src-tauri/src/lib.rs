mod branding;
mod commands;
mod error;
mod logging;
mod netbird;
mod tray;

use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    logging::init();
    tracing::info!(
        "NKK Secure Access {} startet …",
        env!("CARGO_PKG_VERSION")
    );

    let result = tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::AppleScript,
            None,
        ))
        .manage(commands::AppState::new())
        .setup(|app| {
            // Tray setup is non-fatal — if it fails the user can still use
            // the main window and the rest of the app keeps working.
            if let Err(e) = tray::setup(app.handle()) {
                tracing::warn!("Tray Icon konnte nicht erstellt werden: {}", e);
            }

            commands::start_status_polling(app.handle().clone());

            // Eagerly load branding so a missing/broken branding.json shows
            // up in the logs at startup, not on first user interaction.
            match app.path().resource_dir() {
                Ok(resource_dir) => {
                    if let Err(e) = branding::load(&resource_dir) {
                        tracing::warn!(
                            "Branding konnte nicht geladen werden ({}). \
                             App nutzt Fallback Werte.",
                            e
                        );
                    }
                }
                Err(e) => {
                    tracing::warn!("resource_dir() fehlgeschlagen: {}", e);
                }
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::nb_connect,
            commands::nb_disconnect,
            commands::nb_status,
            commands::nb_is_enrolled,
            commands::nb_reset_enrollment,
            commands::nb_logs,
            commands::open_rdp,
            commands::open_smb,
            commands::open_url,
            commands::get_branding,
            commands::set_autostart,
            commands::is_autostart_enabled,
            commands::quit_app,
            commands::creds_list,
            commands::creds_save,
            commands::creds_delete,
            commands::creds_test,
            commands::creds_default_username,
            commands::get_debug_info,
            commands::run_speed_test,
            commands::smart_debug,
        ])
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                // Hide to tray instead of closing
                let _ = window.hide();
                api.prevent_close();
            }
        })
        .run(tauri::generate_context!());

    if let Err(e) = result {
        tracing::error!("Tauri Runtime ist abgestürzt: {}", e);
        // Exit with a non-zero code so the OS / launcher knows it failed.
        std::process::exit(1);
    }
}
