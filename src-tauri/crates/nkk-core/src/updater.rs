//! Updater-Konstanten, geteilt und gegen tauri.conf.json driftgesichert.
//!
//! Die Desktop-App nutzt Tauris eigenen Updater (liest tauri.conf.json direkt).
//! Die headless Linux-CLI hat keinen Tauri-Updater und braucht denselben
//! Pubkey + Manifest-Endpoint fest eingebacken, um ihr Self-Update mit exakt
//! derselben minisign-Kette zu verifizieren. Diese Konstanten MUESSEN mit
//! tauri.conf.json (plugins.updater) uebereinstimmen - der Test unten erzwingt
//! das und laeuft als Lib-Test in der CI mit (`cargo test --lib`).

/// Base64 des minisign-Public-Keys (identisch zu plugins.updater.pubkey).
pub const UPDATER_PUBKEY_B64: &str = "dW50cnVzdGVkIGNvbW1lbnQ6IG1pbmlzaWduIHB1YmxpYyBrZXk6IEM3NjcxMDgzMzFCRjhGQUQKUldTdGo3OHhneEJueC9KdmFYM0VhK3pSeWkyWXY3WDdVeUU0K1RNblBLZ0M1YzZLMFRUcFVzYmsK";

/// Update-Manifest (identisch zu plugins.updater.endpoints[0]).
pub const UPDATER_MANIFEST_URL: &str =
    "https://github.com/ksleon-dev/nkk-secure-access-test/releases/latest/download/latest.json";

#[cfg(test)]
mod tests {
    use super::*;

    /// Drift-Guard: eingebackene Updater-Konstanten == tauri.conf.json. Sonst
    /// verifiziert das Linux-Self-Update gegen falschen Key / falschen Endpoint.
    #[test]
    fn updater_consts_match_tauri_conf() {
        let conf = include_str!("../../../tauri.conf.json");
        let v: serde_json::Value = serde_json::from_str(conf).expect("tauri.conf.json parsebar");
        let up = &v["plugins"]["updater"];
        assert_eq!(
            up["pubkey"].as_str(),
            Some(UPDATER_PUBKEY_B64),
            "UPDATER_PUBKEY_B64 driftet von tauri.conf.json"
        );
        assert_eq!(
            up["endpoints"][0].as_str(),
            Some(UPDATER_MANIFEST_URL),
            "UPDATER_MANIFEST_URL driftet von tauri.conf.json"
        );
    }
}
