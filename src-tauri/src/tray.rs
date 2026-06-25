use tauri::{
    menu::{Menu, MenuItem, PredefinedMenuItem},
    tray::{MouseButton, TrayIconBuilder, TrayIconEvent},
    AppHandle, Emitter, Manager, Runtime,
};

pub fn setup<R: Runtime>(app: &AppHandle<R>) -> tauri::Result<()> {
    // Best-effort load of branding so we can render quick launch entries
    // directly in the tray menu - falls back gracefully if not available.
    let branding = app
        .path()
        .resource_dir()
        .ok()
        .and_then(|d| crate::branding::load(&d).ok());

    let product_name = branding
        .as_ref()
        .map(|b| b.product.name.clone())
        .unwrap_or_else(|| "Secure Access".to_string());

    let header_label = branding
        .as_ref()
        .map(|b| format!("{}  ·  v{}", b.product.name, b.product.version))
        .unwrap_or_else(|| product_name.clone());

    let header = MenuItem::with_id(app, "header", &header_label, false, None::<&str>)?;
    let sep1 = PredefinedMenuItem::separator(app)?;

    // Only show the DEFAULT quick launch item in tray (TS2).
    // TS1 is rarely used and available from the main window.
    let launch_items: Vec<MenuItem<R>> = branding
        .as_ref()
        .map(|b| {
            b.quick_launch
                .iter()
                .enumerate()
                .filter(|(_, e)| e.kind == "rdp" && e.default)
                .filter_map(|(i, e)| {
                    let label = format!("→  {} öffnen", e.label);
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

    let icon = match app.default_window_icon().cloned() {
        Some(i) => i,
        None => {
            tracing::warn!(
                "default_window_icon() returned None - Tray wird ohne Icon registriert."
            );
            // Tauri requires SOMETHING - a 1x1 transparent pixel as last resort.
            // The tray will appear as an invisible 1x1 dot rather than crashing the app.
            tauri::image::Image::new_owned(vec![0, 0, 0, 0], 1, 1)
        }
    };

    let _tray = TrayIconBuilder::with_id("main-tray")
        .tooltip(&product_name)
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
                    // Disconnect VPN before quitting
                    if let Some(state) = app.try_state::<crate::commands::AppState>() {
                        let nb = state.netbird.clone();
                        let app_quit = app.clone();
                        tauri::async_runtime::spawn(async move {
                            let _ = tokio::time::timeout(
                                std::time::Duration::from_secs(5),
                                nb.down(),
                            ).await;
                            app_quit.exit(0);
                        });
                    } else {
                        app.exit(0);
                    }
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

pub(crate) fn open_main_window<R: Runtime>(app: &AppHandle<R>) -> tauri::Result<()> {
    if let Some(window) = app.get_webview_window("main") {
        ensure_on_screen(&window);
        let _ = window.show();
        let _ = window.unminimize();
        let _ = window.set_focus();
    }
    Ok(())
}

// Pull the window back to center if it ended up entirely off every monitor -
// e.g. a screen was unplugged while its saved position pointed there. Without
// this a "lost" window can't be clicked back, which matters on multi-monitor
// 24/7 desks.
fn ensure_on_screen<R: Runtime>(window: &tauri::WebviewWindow<R>) {
    let (Ok(pos), Ok(size)) = (window.outer_position(), window.outer_size()) else {
        return;
    };
    let monitors = match window.available_monitors() {
        Ok(m) => m,
        Err(_) => return,
    };
    let (wl, wt) = (pos.x, pos.y);
    let (wr, wb) = (pos.x + size.width as i32, pos.y + size.height as i32);
    let on_screen = monitors.iter().any(|m| {
        let mp = m.position();
        let ms = m.size();
        let (ml, mt) = (mp.x, mp.y);
        let (mr, mb) = (mp.x + ms.width as i32, mp.y + ms.height as i32);
        wl < mr && wr > ml && wt < mb && wb > mt
    });
    if !on_screen {
        let _ = window.center();
    }
}
