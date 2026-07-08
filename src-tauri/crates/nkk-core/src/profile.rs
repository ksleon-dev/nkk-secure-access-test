//! Profil-/Rollen-Logik und App-Datenpfade, geteilt zwischen Desktop-App und CLI.
//!
//! Hier lebt alles, was BEIDE brauchen: das opake Profil-Token-Mapping, der
//! Bootstrap-Dateipfad (Install-Zeit-Profil) und die identifier-basierten
//! App-Datenpfade (app-settings.json, user-disconnected.flag). Eine
//! Implementierung, kein Drift zwischen GUI und CLI.

use std::path::PathBuf;

/// Tauri-App-Identifier. MUSS mit `identifier` in `src-tauri/tauri.conf.json`
/// uebereinstimmen (der Unit-Test unten erzwingt das): daraus leiten sich die
/// App-Datenpfade ab, die die CLI ohne Tauri-Runtime berechnen muss.
pub const APP_IDENTIFIER: &str = "de.kronsolutions.nkksecureaccess";

/// Opakes Profil-Token -> Rolle. Der Onboarding-One-Liner (und die CLI) tragen
/// bewusst NICHT die Klartext-Rolle (sonst koennte ein Nutzer sie ablesen oder
/// sich auf it_admin umschreiben), sondern ein festes, nicht-erratbares Token
/// pro Rolle. MUSS synchron mit admin-panel/src/lib/profiles.ts (PROFILE_TOKENS)
/// bleiben. WICHTIG: Das Token steuert NUR die angezeigten Kacheln - der echte
/// Netzwerkzugriff wird IMMER durch die NetBird-Gruppe (ueber den Setup-Key
/// kryptografisch vergeben) begrenzt.
pub fn role_for_token(token: &str) -> Option<&'static str> {
    match token.trim() {
        "hK7pR2xW" => Some("manager"),
        "zB4nT9qL" => Some("it_admin"),
        "vY6cF3mP" => Some("infact"),
        _ => None,
    }
}

/// Install-Zeit-Profil-Bootstrap: der Onboarding-One-Liner (oder die CLI) legt
/// eine Datei mit dem gewuenschten Profil-Token ab; die App konsumiert sie beim
/// naechsten Start EINMALIG. Bewusst ein fixer, plattform-einheitlicher Pfad,
/// den Skripte OHNE Kenntnis des Tauri-Identifiers beschreiben koennen
/// (Windows: %APPDATA%\nkk-secure-access\profile, sonst
/// ~/.config/nkk-secure-access/profile - dieselbe Konvention wie die
/// setup-key-Datei auf macOS).
pub fn profile_bootstrap_path() -> Option<PathBuf> {
    #[cfg(target_os = "windows")]
    {
        let base = std::env::var("APPDATA").ok()?;
        Some(PathBuf::from(base).join("nkk-secure-access").join("profile"))
    }
    #[cfg(not(target_os = "windows"))]
    {
        let home = std::env::var("HOME").ok()?;
        Some(
            PathBuf::from(home)
                .join(".config")
                .join("nkk-secure-access")
                .join("profile"),
        )
    }
}

/// App-Datenverzeichnis der Desktop-App, OHNE Tauri-Runtime berechnet - exakt
/// die Konvention von Tauris `app_data_dir()` je Plattform. Die CLI liest hier
/// app-settings.json (Rolle) und schreibt den user-disconnected-Marker, damit
/// GUI und CLI denselben Zustand sehen.
pub fn app_data_dir() -> Option<PathBuf> {
    #[cfg(target_os = "windows")]
    {
        let base = std::env::var("APPDATA").ok()?;
        Some(PathBuf::from(base).join(APP_IDENTIFIER))
    }
    #[cfg(target_os = "macos")]
    {
        let home = std::env::var("HOME").ok()?;
        Some(
            PathBuf::from(home)
                .join("Library")
                .join("Application Support")
                .join(APP_IDENTIFIER),
        )
    }
    #[cfg(all(unix, not(target_os = "macos")))]
    {
        // Tauris app_data_dir() nutzt auf Linux dirs::data_dir() = $XDG_DATA_HOME
        // bzw. ~/.local/share (NICHT ~/.config). Exakt spiegeln, damit CLI und ein
        // etwaiger Linux-GUI denselben Marker/Settings-Pfad sehen. (Headless-CLI
        // hat heute keinen GUI-Gegenpart, aber wir bleiben driftfrei.)
        if let Ok(x) = std::env::var("XDG_DATA_HOME") {
            if !x.is_empty() {
                return Some(PathBuf::from(x).join(APP_IDENTIFIER));
            }
        }
        let home = std::env::var("HOME").ok()?;
        Some(
            PathBuf::from(home)
                .join(".local")
                .join("share")
                .join(APP_IDENTIFIER),
        )
    }
}

/// Pfad des "bewusst getrennt"-Markers (identisch zur GUI-Logik in commands.rs).
pub fn user_disconnected_marker_path() -> Option<PathBuf> {
    app_data_dir().map(|d| d.join("user-disconnected.flag"))
}

/// Marker lesen: existiert die Datei, hat der Nutzer bewusst getrennt.
pub fn read_user_disconnected_marker() -> bool {
    user_disconnected_marker_path()
        .map(|p| p.exists())
        .unwrap_or(false)
}

/// Marker setzen/loeschen (Fehler bewusst still: der Marker ist Komfort, ein
/// Schreibfehler darf Connect/Disconnect nie scheitern lassen).
pub fn set_user_disconnected_marker(disconnected: bool) {
    let Some(path) = user_disconnected_marker_path() else {
        return;
    };
    if disconnected {
        if let Some(parent) = path.parent() {
            let _ = std::fs::create_dir_all(parent);
        }
        let _ = std::fs::write(&path, b"1");
    } else {
        let _ = std::fs::remove_file(&path);
    }
}

/// Aktuell gesetzte Anzeige-Rolle aus app-settings.json (Fallback "user").
/// Nur lesend - geschrieben wird die Rolle ausschliesslich von der App
/// (Settings) bzw. ueber den Bootstrap-Mechanismus.
pub fn current_role() -> String {
    let role = app_data_dir()
        .map(|d| d.join("app-settings.json"))
        .and_then(|p| std::fs::read_to_string(p).ok())
        .and_then(|s| serde_json::from_str::<serde_json::Value>(&s).ok())
        .and_then(|v| v.get("role").and_then(|r| r.as_str()).map(String::from));
    role.unwrap_or_else(|| "user".to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn token_mapping() {
        assert_eq!(role_for_token("vY6cF3mP"), Some("infact"));
        assert_eq!(role_for_token("zB4nT9qL"), Some("it_admin"));
        assert_eq!(role_for_token("hK7pR2xW"), Some("manager"));
        assert_eq!(role_for_token("  vY6cF3mP  "), Some("infact"));
        assert_eq!(role_for_token("it_admin"), None); // Klartext bewusst NICHT
        assert_eq!(role_for_token(""), None);
    }

    /// Drift-Schutz: der hartkodierte Identifier muss dem in tauri.conf.json
    /// entsprechen - sonst zeigen CLI-Pfade auf ein falsches Verzeichnis.
    #[test]
    fn identifier_matches_tauri_conf() {
        let conf = include_str!("../../../tauri.conf.json");
        let v: serde_json::Value = serde_json::from_str(conf).expect("tauri.conf.json parsebar");
        assert_eq!(
            v.get("identifier").and_then(|i| i.as_str()),
            Some(APP_IDENTIFIER),
            "APP_IDENTIFIER driftet von tauri.conf.json"
        );
    }
}
