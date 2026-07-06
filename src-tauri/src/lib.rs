mod commands;
mod tray;

// The Tauri-free core now lives in the nkk-core crate. Re-export its modules at
// the crate root so the rest of the app keeps referring to crate::netbird,
// crate::branding, crate::error and crate::logging unchanged - no drift, one
// implementation shared with the headless CLI.
pub use nkk_core::{branding, error, logging, netbird};

use tauri::{Emitter, Manager};

struct TrayAvailable(bool);

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    logging::init();
    // Panic-Hook: ein Panic im Backend landet so IMMER in der Logdatei, statt still
    // einen Thread zu killen - erleichtert die Ferndiagnose auf den 24/7-Clients.
    let default_panic = std::panic::take_hook();
    std::panic::set_hook(Box::new(move |info| {
        tracing::error!("PANIC: {}", info);
        default_panic(info);
    }));
    tracing::info!(
        "NKK Secure Access {} startet …",
        env!("CARGO_PKG_VERSION")
    );

    let result = tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_autostart::init(
            // LaunchAgent is the robust choice for a silent 24/7 background
            // client on macOS: a ~/Library/LaunchAgents plist that survives
            // updates and does not fire the AppleScript automation TCC prompt.
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            None,
        ))
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            // Second instance tried to start → bring the existing window forward,
            // re-centering it first if it drifted off every monitor.
            let _ = tray::open_main_window(app);
        }))
        .manage(commands::AppState::new())
        .setup(|app| {
            // Tray setup is non-fatal - if it fails the user can still use
            // the main window and the rest of the app keeps working.
            let tray_ok = tray::setup(app.handle()).is_ok();
            if !tray_ok {
                tracing::warn!("Tray Icon konnte nicht erstellt werden - Close-to-tray deaktiviert");
            }
            // Store whether tray is available for the close handler
            app.manage(TrayAvailable(tray_ok));

            // Eagerly load branding so a missing/broken branding.json shows up in
            // the logs at startup, and collect the RDP + SMB targets so stale-
            // credential cleanup is driven by branding instead of hardcoded IPs.
            let mut rdp_targets: Vec<String> = Vec::new();
            let mut smb_targets: Vec<String> = Vec::new();
            match app.path().resource_dir() {
                Ok(resource_dir) => match branding::load(&resource_dir) {
                    Ok(b) => {
                        rdp_targets = b
                            .quick_launch
                            .iter()
                            .filter(|q| q.kind == "rdp")
                            .map(|q| q.target.clone())
                            .collect();
                        smb_targets = b
                            .quick_launch
                            .iter()
                            .filter(|q| q.kind == "smb")
                            .map(|q| q.target.clone())
                            .collect();
                    }
                    Err(e) => {
                        tracing::warn!(
                            "Branding konnte nicht geladen werden ({}). \
                             App nutzt Fallback Werte.",
                            e
                        );
                    }
                },
                Err(e) => {
                    tracing::warn!("resource_dir() fehlgeschlagen: {}", e);
                }
            }

            // Honour a persisted "Trennen" before the poller starts, so a
            // deliberate disconnect is not auto-reconnected after a restart.
            commands::init_user_disconnected(app.handle());
            commands::cleanup_stale_credentials(&rdp_targets, &smb_targets);
            commands::start_status_polling(app.handle().clone());
            // RDP-Vertrauen (Zertifikat + Registry) im Hintergrund einrichten, damit der
            // erste Terminalserver-Klick keine Windows-Warnung zeigt und nicht traege ist.
            commands::warm_rdp_trust();

            // Load admin settings into the runtime, and honour "connect on start"
            // by triggering the same path the tray uses, unless the user has
            // deliberately stayed disconnected.
            let app_settings = commands::init_app_settings(app.handle());
            if app_settings.connect_on_start {
                let app_h = app.handle().clone();
                tauri::async_runtime::spawn(async move {
                    tokio::time::sleep(std::time::Duration::from_secs(3)).await;
                    if let Some(state) = app_h.try_state::<commands::AppState>() {
                        if !state
                            .user_disconnected
                            .load(std::sync::atomic::Ordering::Relaxed)
                        {
                            let _ = app_h.emit("tray-connect", ());
                        }
                    }
                });
            }

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::nb_connect,
            commands::nb_disconnect,
            commands::nb_status,
            commands::nb_is_enrolled,
            commands::has_cached_setup_key,
            commands::nb_reset_enrollment,
            commands::nb_logs,
            commands::open_rdp,
            commands::open_smb,
            commands::open_url,
            commands::open_ssh,
            commands::check_target,
            commands::check_targets,
            commands::rdp_settings_get,
            commands::rdp_settings_save,
            commands::app_settings_get,
            commands::app_settings_save,
            commands::create_desktop_rdp_shortcut,
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
            commands::run_ping_test,
            commands::run_speed_test,
            commands::smart_debug,
            commands::check_netbird_setup,
            commands::install_netbird,
            commands::get_health_history,
            commands::get_inventory,
            commands::export_support_bundle,
            commands::check_connectivity,
            commands::detect_onsite,
            commands::detect_network_context,
            commands::probe_mtu,
            commands::measure_link_quality,
            commands::dualhoming_prefer_wired,
            commands::dualhoming_restore,
            commands::admin_unlock,
            commands::admin_is_unlocked,
            commands::admin_open_log_folder,
            commands::admin_force_reconnect,
            commands::admin_open_app_data,
            commands::admin_restart_app,
            commands::relaunch_app,
            commands::report_version,
            commands::admin_restart_service,
            commands::admin_check_netbird_version,
            commands::admin_update_netbird,
            commands::admin_list_levels,
            commands::admin_run_level,
        ])
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                // Only hide to tray if tray is available - otherwise let the
                // window close normally so the user isn't soft-locked.
                let has_tray = window.app_handle()
                    .try_state::<TrayAvailable>()
                    .map(|t| t.0)
                    .unwrap_or(false);
                if has_tray {
                    let _ = window.hide();
                    api.prevent_close();
                    // Einmal pro Sitzung erklaeren, dass die App (und damit das VPN) im
                    // Hintergrund weiterlaeuft - sonst denkt der Nutzer beim X-Klick, er
                    // sei getrennt, und der Tunnel bleibt unbemerkt offen.
                    use std::sync::atomic::{AtomicBool, Ordering};
                    static TRAY_HINT_SHOWN: AtomicBool = AtomicBool::new(false);
                    if !TRAY_HINT_SHOWN.swap(true, Ordering::Relaxed) {
                        let _ = tauri_plugin_notification::NotificationExt::notification(
                            window.app_handle(),
                        )
                        .builder()
                        .title("NKK Secure Access laeuft weiter")
                        .body(
                            "Die Verbindung bleibt im Hintergrund aktiv. Zum vollstaendigen \
                             Beenden: Tray-Symbol unten rechts, dann Beenden.",
                        )
                        .show();
                    }
                } else {
                    // No tray - real close. Disconnect VPN first, then quit.
                    api.prevent_close();
                    if let Some(state) = window.app_handle().try_state::<commands::AppState>() {
                        let nb = state.netbird.clone();
                        let app_handle = window.app_handle().clone();
                        tauri::async_runtime::spawn(async move {
                            let _ = tokio::time::timeout(
                                std::time::Duration::from_secs(5),
                                nb.down(),
                            ).await;
                            app_handle.exit(0);
                        });
                    } else {
                        window.app_handle().exit(0);
                    }
                }
            }
        })
        .run(tauri::generate_context!());

    if let Err(e) = result {
        tracing::error!("Tauri Runtime ist abgestürzt: {}", e);
        // Exit with a non-zero code so the OS / launcher knows it failed.
        std::process::exit(1);
    }
}
