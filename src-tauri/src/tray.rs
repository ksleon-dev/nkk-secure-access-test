use tauri::{
    menu::{Menu, MenuItem, PredefinedMenuItem},
    tray::{MouseButton, TrayIconBuilder, TrayIconEvent},
    AppHandle, Emitter, Manager, Runtime,
};

pub fn setup<R: Runtime>(app: &AppHandle<R>) -> tauri::Result<()> {
    // Best-effort load of branding so we can render quick launch entries
    // directly in the tray menu — falls back gracefully if not available.
    let branding = app
        .path()
        .resource_dir()
        .ok()
        .and_then(|d| crate::branding::load(&d).ok());

    let header_label = branding
        .as_ref()
        .map(|b| format!("{}  ·  v{}", b.product.name, b.product.version))
        .unwrap_or_else(|| "NKK Secure Access".to_string());

    let header = MenuItem::with_id(app, "header", &header_label, false, None::<&str>)?;
    let sep1 = PredefinedMenuItem::separator(app)?;

    // Build launch items from branding (only RDP entries)
    let launch_items: Vec<MenuItem<R>> = branding
        .as_ref()
        .map(|b| {
            b.quick_launch
                .iter()
                .enumerate()
                .filter(|(_, e)| e.kind == "rdp")
                .filter_map(|(i, e)| {
                    let label = if e.default {
                        format!("→  {}   ★", e.label)
                    } else {
                        format!("→  {}", e.label)
                    };
                    MenuItem::with_id(app, format!("launch_{}", i), &label, true, None::<&str>)
                        .ok()
                })
                .collect()
        })
        .unwrap_or_default();

    let sep2 = PredefinedMenuItem::separator(app)?;
    let connect_item = MenuItem::with_id(app, "connect", "VPN verbinden", true, None::<&str>)?;
    let disconnect_item =
        MenuItem::with_id(app, "disconnect", "VPN trennen", true, None::<&str>)?;

    let sep3 = PredefinedMenuItem::separator(app)?;
    let open_item = MenuItem::with_id(app, "open", "Hauptfenster öffnen", true, None::<&str>)?;
    let diagnose_item =
        MenuItem::with_id(app, "diagnose", "Diagnose & Support", true, None::<&str>)?;
    let settings_item =
        MenuItem::with_id(app, "settings", "Einstellungen", true, None::<&str>)?;

    let sep4 = PredefinedMenuItem::separator(app)?;
    let quit_item = MenuItem::with_id(app, "quit", "Beenden", true, None::<&str>)?;

    // Compose menu by appending in order
    let menu = Menu::new(app)?;
    menu.append(&header)?;
    menu.append(&sep1)?;
    for item in &launch_items {
        menu.append(item)?;
    }
    if !launch_items.is_empty() {
        menu.append(&sep2)?;
    }
    menu.append(&connect_item)?;
    menu.append(&disconnect_item)?;
    menu.append(&sep3)?;
    menu.append(&open_item)?;
    menu.append(&diagnose_item)?;
    menu.append(&settings_item)?;
    menu.append(&sep4)?;
    menu.append(&quit_item)?;

    let icon = app
        .default_window_icon()
        .cloned()
        .expect("default window icon must be configured in tauri.conf.json");

    let _tray = TrayIconBuilder::with_id("main-tray")
        .tooltip("NKK Secure Access")
        .icon(icon)
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| {
            let id = event.id.as_ref();
            if let Some(idx_str) = id.strip_prefix("launch_") {
                if let Ok(idx) = idx_str.parse::<usize>() {
                    let _ = app.emit("tray-launch-index", idx);
                }
                return;
            }
            match id {
                "open" => {
                    let _ = open_main_window(app);
                }
                "connect" => {
                    let _ = app.emit("tray-connect", ());
                }
                "disconnect" => {
                    let _ = app.emit("tray-disconnect", ());
                }
                "diagnose" => {
                    let _ = open_main_window(app);
                    let _ = app.emit("tray-open-diagnose", ());
                }
                "settings" => {
                    let _ = open_main_window(app);
                    let _ = app.emit("tray-open-settings", ());
                }
                "quit" => {
                    app.exit(0);
                }
                _ => {}
            }
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                ..
            } = event
            {
                let _ = open_main_window(tray.app_handle());
            }
        })
        .build(app)?;

    Ok(())
}

fn open_main_window<R: Runtime>(app: &AppHandle<R>) -> tauri::Result<()> {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.unminimize();
        let _ = window.set_focus();
    }
    Ok(())
}
