use crate::branding::{self, BrandingDto};
use crate::error::{AppError, AppResult};
use crate::netbird::{ConnectionState, NetbirdClient, StatusDto};
use serde::{Deserialize, Serialize};
use std::sync::atomic::{AtomicBool, Ordering};
use tauri::{AppHandle, Emitter, Manager, State};
use tokio::process::Command as TokioCommand;
use tokio::sync::Mutex as AsyncMutex;
use tokio::time::{sleep, timeout, Duration};

#[cfg(not(target_os = "macos"))]
const KEYRING_SERVICE: &str = "nkk-secure-access";
#[cfg(not(target_os = "macos"))]
const KEYRING_USER: &str = "setup-key";
#[cfg(not(target_os = "macos"))]
const KEYRING_PROFILES: &str = "credential-profiles";
#[cfg(not(target_os = "macos"))]
const KEYRING_TEST: &str = "diagnostic-roundtrip";

/// A single stored credential profile (encrypted by the OS keystore).
#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct CredentialProfile {
    pub id: String,
    pub label: String,
    pub username: String,
    pub password: String,
    #[serde(default)]
    pub domain: Option<String>,
    #[serde(default)]
    pub created_at: String,
    #[serde(default)]
    pub updated_at: String,
}

/// Lightweight metadata variant for the frontend — never carries the password.
#[derive(Serialize, Clone, Debug)]
pub struct CredentialProfileMeta {
    pub id: String,
    pub label: String,
    pub username: String,
    pub domain: Option<String>,
    #[serde(rename = "hasPassword")]
    pub has_password: bool,
    #[serde(rename = "createdAt")]
    pub created_at: String,
    #[serde(rename = "updatedAt")]
    pub updated_at: String,
}

impl From<&CredentialProfile> for CredentialProfileMeta {
    fn from(p: &CredentialProfile) -> Self {
        Self {
            id: p.id.clone(),
            label: p.label.clone(),
            username: p.username.clone(),
            domain: p.domain.clone(),
            has_password: !p.password.is_empty(),
            created_at: p.created_at.clone(),
            updated_at: p.updated_at.clone(),
        }
    }
}

// ── Platform-aware credential storage ──
// Windows: Keyring (Credential Manager) — stores username + password (cmdkey can inject)
// macOS:   Local JSON file — stores username + domain only (no password, no Keychain prompts)

#[cfg(not(target_os = "macos"))]
fn profiles_entry() -> AppResult<keyring::Entry> {
    keyring::Entry::new(KEYRING_SERVICE, KEYRING_PROFILES).map_err(AppError::from)
}

#[cfg(not(target_os = "macos"))]
fn load_profiles() -> AppResult<Vec<CredentialProfile>> {
    let entry = profiles_entry()?;
    match entry.get_password() {
        Ok(s) => {
            let profiles: Vec<CredentialProfile> = serde_json::from_str(&s).unwrap_or_else(|e| {
                tracing::warn!("Credential-Daten beschädigt, starte leer: {}", e);
                vec![]
            });
            Ok(profiles)
        }
        Err(keyring::Error::NoEntry) => Ok(vec![]),
        Err(e) => Err(AppError::Keyring(e.to_string())),
    }
}

#[cfg(not(target_os = "macos"))]
fn store_profiles(profiles: &[CredentialProfile]) -> AppResult<()> {
    let json = serde_json::to_string(profiles)
        .map_err(|e| AppError::Internal(format!("profiles serialize: {}", e)))?;
    profiles_entry()?.set_password(&json)?;
    Ok(())
}

#[cfg(target_os = "macos")]
fn mac_profiles_path() -> std::path::PathBuf {
    let home = std::env::var("HOME").unwrap_or_else(|_| "/tmp".to_string());
    std::path::PathBuf::from(home)
        .join(".config")
        .join("nkk-secure-access")
        .join("profiles.json")
}

#[cfg(target_os = "macos")]
fn load_profiles() -> AppResult<Vec<CredentialProfile>> {
    let path = mac_profiles_path();
    if !path.exists() {
        return Ok(vec![]);
    }
    let content = std::fs::read_to_string(&path)
        .map_err(|e| AppError::Io(format!("profiles lesen: {}", e)))?;
    let mut profiles: Vec<CredentialProfile> = serde_json::from_str(&content).unwrap_or_else(|e| {
        tracing::warn!("Profildatei beschädigt, starte leer: {}", e);
        vec![]
    });
    // macOS: never store passwords — clear any that leaked in
    for p in &mut profiles {
        p.password.clear();
    }
    Ok(profiles)
}

#[cfg(target_os = "macos")]
fn store_profiles(profiles: &[CredentialProfile]) -> AppResult<()> {
    let path = mac_profiles_path();
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|e| AppError::Io(format!("profiles Ordner: {}", e)))?;
    }
    // Strip passwords before saving on macOS
    let clean: Vec<CredentialProfile> = profiles.iter().map(|p| CredentialProfile {
        id: p.id.clone(),
        label: p.label.clone(),
        username: p.username.clone(),
        domain: p.domain.clone(),
        password: String::new(),
        created_at: p.created_at.clone(),
        updated_at: p.updated_at.clone(),
    }).collect();
    let json = serde_json::to_string_pretty(&clean)
        .map_err(|e| AppError::Internal(format!("profiles serialize: {}", e)))?;
    std::fs::write(&path, json)
        .map_err(|e| AppError::Io(format!("profiles schreiben: {}", e)))?;
    Ok(())
}

fn now_iso() -> String {
    chrono::Utc::now().to_rfc3339()
}

fn random_id() -> String {
    // No external uuid dep — derive from current epoch + a small random nonce.
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    let pid = std::process::id();
    format!("p_{:x}_{:x}", now, pid)
}

/// Returns the cached profile list, populating the cache from the OS keystore
/// on first call. Every subsequent call within this app session avoids the
/// macOS Keychain prompt because we have the data in memory already.
async fn cached_profiles(state: &AppState) -> AppResult<Vec<CredentialProfile>> {
    let mut g = state.profiles_cache.lock().await;
    if let Some(p) = g.as_ref() {
        return Ok(p.clone());
    }
    let loaded = load_profiles()?;
    *g = Some(loaded.clone());
    Ok(loaded)
}

#[tauri::command]
pub async fn creds_list(state: State<'_, AppState>) -> AppResult<Vec<CredentialProfileMeta>> {
    let profiles = cached_profiles(&state).await?;
    Ok(profiles.iter().map(CredentialProfileMeta::from).collect())
}

#[tauri::command]
pub async fn creds_save(
    state: State<'_, AppState>,
    id: Option<String>,
    label: String,
    username: String,
    password: String,
    domain: Option<String>,
) -> AppResult<CredentialProfileMeta> {
    let username = username.trim().to_string();
    let label = if label.trim().is_empty() {
        username.clone()
    } else {
        label.trim().to_string()
    };
    if username.is_empty() {
        return Err(AppError::Internal(
            "Benutzername darf nicht leer sein.".into(),
        ));
    }
    // When editing an existing profile, empty password = "keep the current one"
    if password.is_empty() && id.as_ref().map_or(true, |s| s.is_empty()) {
        return Err(AppError::Internal("Passwort darf nicht leer sein.".into()));
    }
    let domain = domain.and_then(|d| {
        let t = d.trim();
        if t.is_empty() {
            None
        } else {
            Some(t.to_string())
        }
    });

    let mut cache = state.profiles_cache.lock().await;
    let mut profiles = match cache.take() {
        Some(p) => p,
        None => load_profiles()?, // First call this session
    };
    let now = now_iso();
    let saved_meta;

    if let Some(id) = id.filter(|s| !s.is_empty()) {
        let pos = profiles
            .iter()
            .position(|p| p.id == id)
            .ok_or_else(|| AppError::Internal(format!("Profil {} nicht gefunden", id)))?;
        let p = &mut profiles[pos];
        p.label = label;
        p.username = username;
        // Empty password on edit = "keep current" — don't overwrite with ""
        if !password.is_empty() {
            p.password = password;
        }
        p.domain = domain;
        p.updated_at = now;
        saved_meta = CredentialProfileMeta::from(&*p);
    } else {
        let new = CredentialProfile {
            id: random_id(),
            label,
            username,
            password,
            domain,
            created_at: now.clone(),
            updated_at: now,
        };
        saved_meta = CredentialProfileMeta::from(&new);
        profiles.push(new);
    }

    // Single keystore write — no round-trip verify (that triggered an extra
    // Keychain prompt on macOS for each save).
    store_profiles(&profiles)?;
    *cache = Some(profiles);

    Ok(saved_meta)
}

#[tauri::command]
pub async fn creds_delete(state: State<'_, AppState>, id: String) -> AppResult<()> {
    let mut cache = state.profiles_cache.lock().await;
    let mut profiles = match cache.take() {
        Some(p) => p,
        None => load_profiles()?,
    };
    let before = profiles.len();
    profiles.retain(|p| p.id != id);
    if profiles.len() == before {
        *cache = Some(profiles);
        return Ok(()); // already gone
    }

    if profiles.is_empty() {
        #[cfg(not(target_os = "macos"))]
        {
            let entry = profiles_entry()?;
            match entry.delete_credential() {
                Ok(_) => {}
                Err(keyring::Error::NoEntry) => {}
                Err(e) => return Err(AppError::Keyring(e.to_string())),
            }
        }
        #[cfg(target_os = "macos")]
        {
            let path = mac_profiles_path();
            if path.exists() {
                let _ = std::fs::remove_file(&path);
            }
        }
    } else {
        store_profiles(&profiles)?;
    }
    *cache = Some(profiles);
    Ok(())
}

#[derive(Serialize, Clone, Debug)]
pub struct KeyringTestResult {
    pub ok: bool,
    pub backend: String,
    pub message: String,
}

#[tauri::command]
pub async fn creds_test() -> AppResult<KeyringTestResult> {
    // macOS: no keyring used — always OK
    #[cfg(target_os = "macos")]
    {
        return Ok(KeyringTestResult {
            ok: true,
            backend: "Lokale Datei (kein Schlüsselbund)".to_string(),
            message: "Auf macOS werden Anmeldedaten lokal gespeichert — kein Keychain nötig.".to_string(),
        });
    }

    #[cfg(not(target_os = "macos"))]
    {
    let backend = if cfg!(target_os = "windows") {
        "Windows Credential Manager (DPAPI)"
    } else {
        "Linux Secret Service"
    }
    .to_string();

    let probe = format!("nkk-probe-{}", now_iso());
    let entry = match keyring::Entry::new(KEYRING_SERVICE, KEYRING_TEST) {
        Ok(e) => e,
        Err(e) => {
            return Ok(KeyringTestResult {
                ok: false,
                backend,
                message: format!("Entry init fehlgeschlagen: {}", e),
            });
        }
    };
    if let Err(e) = entry.set_password(&probe) {
        return Ok(KeyringTestResult {
            ok: false,
            backend,
            message: format!("Schreiben fehlgeschlagen: {}", e),
        });
    }
    let read = match entry.get_password() {
        Ok(s) => s,
        Err(e) => {
            return Ok(KeyringTestResult {
                ok: false,
                backend,
                message: format!("Lesen fehlgeschlagen: {}", e),
            });
        }
    };
    let _ = entry.delete_credential();
    if read != probe {
        return Ok(KeyringTestResult {
            ok: false,
            backend,
            message: format!(
                "Roundtrip Mismatch: {} bytes geschrieben, {} bytes gelesen",
                probe.len(),
                read.len()
            ),
        });
    }
    Ok(KeyringTestResult {
        ok: true,
        backend,
        message: "Schlüsselbund/Credential Manager funktioniert.".to_string(),
    })
    } // end #[cfg(not(target_os = "macos"))]
}

#[tauri::command]
pub fn creds_default_username() -> String {
    std::env::var("USER")
        .or_else(|_| std::env::var("USERNAME"))
        .unwrap_or_default()
}

/// Wraps the cached "is the setup key loaded" state. The outer Option is
/// "have we ever loaded from the keystore", the inner Option is "is there a
/// key" — `Some(None)` therefore means "we know there's no key yet".
type CachedSetupKey = Option<Option<String>>;

pub struct AppState {
    pub netbird: NetbirdClient,
    pub branding: AsyncMutex<Option<BrandingDto>>,
    /// Lazy in-memory cache for the credential profile list — populated on
    /// first read so we only ever hit the OS keystore once per app session
    /// instead of triggering the macOS Keychain prompt on every save / list.
    pub profiles_cache: AsyncMutex<Option<Vec<CredentialProfile>>>,
    /// Same lazy caching pattern for the NetBird setup key. Without this,
    /// `nb_is_enrolled` + `nb_connect` would each fire a separate Keychain
    /// prompt on unsigned dev builds.
    pub setup_key_cache: AsyncMutex<CachedSetupKey>,
}

impl Default for AppState {
    fn default() -> Self {
        Self::new()
    }
}

impl AppState {
    pub fn new() -> Self {
        Self {
            netbird: NetbirdClient::new(),
            branding: AsyncMutex::new(None),
            profiles_cache: AsyncMutex::new(None),
            setup_key_cache: AsyncMutex::new(None),
        }
    }
}

/// Cached read of the setup key — single keystore hit per app session.
async fn cached_setup_key(state: &AppState) -> AppResult<Option<String>> {
    let mut g = state.setup_key_cache.lock().await;
    if let Some(cached) = g.as_ref() {
        return Ok(cached.clone());
    }
    let loaded = load_setup_key()?;
    *g = Some(loaded.clone());
    Ok(loaded)
}

/// Cached write of the setup key — updates both the keystore and the in
/// memory cache so future reads do not hit the keystore again.
async fn cached_save_setup_key(state: &AppState, key: &str) -> AppResult<()> {
    save_setup_key(key)?;
    let mut g = state.setup_key_cache.lock().await;
    *g = Some(Some(key.to_string()));
    Ok(())
}

async fn cached_delete_setup_key(state: &AppState) -> AppResult<()> {
    delete_setup_key()?;
    let mut g = state.setup_key_cache.lock().await;
    *g = Some(None);
    Ok(())
}

// ── Setup key storage (platform-aware) ──

#[cfg(not(target_os = "macos"))]
fn keyring_entry() -> AppResult<keyring::Entry> {
    keyring::Entry::new(KEYRING_SERVICE, KEYRING_USER).map_err(AppError::from)
}

#[cfg(not(target_os = "macos"))]
fn save_setup_key(key: &str) -> AppResult<()> {
    let entry = keyring_entry()?;
    entry.set_password(key)?;
    Ok(())
}

#[cfg(not(target_os = "macos"))]
fn load_setup_key() -> AppResult<Option<String>> {
    let entry = keyring_entry()?;
    match entry.get_password() {
        Ok(s) => Ok(Some(s)),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(e) => Err(AppError::Keyring(e.to_string())),
    }
}

#[cfg(not(target_os = "macos"))]
fn delete_setup_key() -> AppResult<()> {
    let entry = keyring_entry()?;
    match entry.delete_credential() {
        Ok(_) => Ok(()),
        Err(keyring::Error::NoEntry) => Ok(()),
        Err(e) => Err(AppError::Keyring(e.to_string())),
    }
}

// macOS: local file instead of Keychain — zero password prompts
#[cfg(target_os = "macos")]
fn mac_setup_key_path() -> std::path::PathBuf {
    let home = std::env::var("HOME").unwrap_or_else(|_| "/tmp".to_string());
    std::path::PathBuf::from(home)
        .join(".config")
        .join("nkk-secure-access")
        .join("setup-key")
}

#[cfg(target_os = "macos")]
fn save_setup_key(key: &str) -> AppResult<()> {
    let path = mac_setup_key_path();
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|e| AppError::Io(format!("setup-key Ordner: {}", e)))?;
    }
    std::fs::write(&path, key)
        .map_err(|e| AppError::Io(format!("setup-key schreiben: {}", e)))?;
    Ok(())
}

#[cfg(target_os = "macos")]
fn load_setup_key() -> AppResult<Option<String>> {
    let path = mac_setup_key_path();
    if !path.exists() {
        return Ok(None);
    }
    let key = std::fs::read_to_string(&path)
        .map_err(|e| AppError::Io(format!("setup-key lesen: {}", e)))?;
    if key.trim().is_empty() {
        Ok(None)
    } else {
        Ok(Some(key.trim().to_string()))
    }
}

#[cfg(target_os = "macos")]
fn delete_setup_key() -> AppResult<()> {
    let path = mac_setup_key_path();
    if path.exists() {
        std::fs::remove_file(&path)
            .map_err(|e| AppError::Io(format!("setup-key löschen: {}", e)))?;
    }
    Ok(())
}

async fn ensure_branding(app: &AppHandle, state: &State<'_, AppState>) -> AppResult<BrandingDto> {
    let mut g = state.branding.lock().await;
    if let Some(b) = g.as_ref() {
        return Ok(b.clone());
    }
    let resource_dir = app
        .path()
        .resource_dir()
        .map_err(|e| AppError::Branding(e.to_string()))?;
    let b = branding::load(&resource_dir)?;
    *g = Some(b.clone());
    Ok(b)
}

/// Validate a NetBird setup key. Setup keys are typically UUIDs or long
/// alphanumeric strings — we accept anything between 8 and 128 chars made up
/// of alphanumerics and dashes. This blocks accidental command injection
/// attempts and copy/paste mistakes (whitespace, quotes, control chars).
fn validate_setup_key(key: &str) -> AppResult<String> {
    let trimmed = key.trim();
    if trimmed.is_empty() {
        return Err(AppError::Internal(
            "Setup Key darf nicht leer sein.".into(),
        ));
    }
    if trimmed.len() < 8 || trimmed.len() > 128 {
        return Err(AppError::Internal(format!(
            "Setup Key hat ungültige Länge ({} Zeichen). Erwartet werden 8 bis 128.",
            trimmed.len()
        )));
    }
    if !trimmed
        .chars()
        .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
    {
        return Err(AppError::Internal(
            "Setup Key enthält ungültige Zeichen. Erlaubt sind Buchstaben, Ziffern, - und _."
                .into(),
        ));
    }
    Ok(trimmed.to_string())
}

#[tauri::command]
pub async fn nb_connect(
    app: AppHandle,
    setup_key: Option<String>,
    state: State<'_, AppState>,
) -> AppResult<()> {
    // DEMO KEY — REMOVE BEFORE PRODUCTION
    if setup_key.as_deref().map(|s| s.trim()) == Some("KRONDEMO2026") {
        tracing::info!("Demo Key erkannt");
        let _ = write_enrolled_marker(&app);
        let fake = StatusDto {
            state: ConnectionState::Connected,
            management_connected: true,
            peers: vec![
                crate::netbird::PeerDto { name: "Serv-TS2".into(), ip: "192.168.0.20".into(), connected: true, latency_ms: Some(18), relay: Some("P2P".into()) },
                crate::netbird::PeerDto { name: "Serv-TS1".into(), ip: "192.168.0.19".into(), connected: true, latency_ms: Some(22), relay: Some("P2P".into()) },
            ],
            local_ip: Some("100.64.0.99".into()),
            updated_at: chrono::Utc::now().to_rfc3339(),
            cli_available: true,
        };
        let _ = app.emit("netbird-status-changed", &fake);
        return Ok(());
    }

    let branding = ensure_branding(&app, &state).await?;

    if !management_reachable(&branding.netbird.management_url).await {
        tracing::warn!(
            "Management Server {} nicht erreichbar — versuche trotzdem.",
            branding.netbird.management_url
        );
    }

    let key = match setup_key {
        Some(k) if !k.trim().is_empty() => {
            let validated = validate_setup_key(&k)?;
            cached_save_setup_key(&state, &validated).await?;
            Some(validated)
        }
        _ => cached_setup_key(&state).await?,
    };

    // Robust connect with retry: if the first "up" fails, restart the service
    // and try again. Covers fresh installs where the service isn't running yet.
    let up_result = {
        #[cfg(target_os = "windows")]
        {
            // Pre-check: ensure service is running
            let status_check = state.netbird.status().await;
            if matches!(status_check, Err(AppError::NetbirdMissing) | Err(AppError::NetbirdCli(_))) {
                tracing::info!("NetBird Service nicht erreichbar, starte Service ...");
                let mut sc = TokioCommand::new("sc.exe");
                sc.args(["start", "netbird"]);
                use std::os::windows::process::CommandExt;
                sc.creation_flags(0x08000000);
                let _ = timeout(Duration::from_secs(5), sc.output()).await;
                sleep(Duration::from_secs(3)).await;
            }
        }

        // Attempt 1
        let first = state.netbird.up(&branding.netbird.management_url, key.as_deref()).await;

        if first.is_err() {
            tracing::warn!("Erster Verbindungsversuch fehlgeschlagen, versuche Retry ...");
            // Restart service and retry
            #[cfg(target_os = "windows")]
            {
                use std::os::windows::process::CommandExt;
                let mut sc_stop = TokioCommand::new("sc.exe");
                sc_stop.args(["stop", "netbird"]);
                sc_stop.creation_flags(0x08000000);
                let _ = timeout(Duration::from_secs(3), sc_stop.output()).await;
                sleep(Duration::from_secs(1)).await;
                let mut sc_start = TokioCommand::new("sc.exe");
                sc_start.args(["start", "netbird"]);
                sc_start.creation_flags(0x08000000);
                let _ = timeout(Duration::from_secs(5), sc_start.output()).await;
                sleep(Duration::from_secs(3)).await;
            }
            #[cfg(target_os = "macos")]
            {
                let _ = timeout(
                    Duration::from_secs(3),
                    TokioCommand::new(state.netbird.binary_path()).args(["service", "start"]).output(),
                ).await;
                sleep(Duration::from_secs(2)).await;
            }

            // Attempt 2
            state.netbird.up(&branding.netbird.management_url, key.as_deref()).await
        } else {
            first
        }
    };
    up_result?;

    // Mark as enrolled so next startup skips the enrollment screen
    let _ = write_enrolled_marker(&app);

    if let Ok(s) = state.netbird.status().await {
        let _ = app.emit("netbird-status-changed", &s);
    }

    // Auto-send diagnostic to KronSolutions on enrollment (fire-and-forget)
    let app_clone = app.clone();
    let state_nb = state.netbird.clone();
    let branding_clone = branding.clone();
    tauri::async_runtime::spawn(async move {
        if let Err(e) = send_enrollment_diagnostic(&app_clone, &state_nb, &branding_clone).await {
            tracing::debug!("Enrollment Diagnostic senden fehlgeschlagen: {}", e);
        }
    });

    Ok(())
}

/// Send a diagnostic snapshot to KronSolutions when a new device enrolls.
/// This lets the team map setup keys to hostnames, IPs, and OS versions
/// without the employee having to do anything manually.
async fn send_enrollment_diagnostic(
    _app: &AppHandle,
    nb: &NetbirdClient,
    branding: &BrandingDto,
) -> AppResult<()> {
    let webhook = match &branding.webhook_url {
        Some(url) if !url.is_empty() => url.clone(),
        _ => return Ok(()), // no webhook configured
    };

    // Gather all diagnostic data in parallel — comprehensive snapshot
    let lan_target = branding
        .quick_launch
        .iter()
        .find(|q| q.kind == "rdp")
        .map(|q| q.target.clone())
        .unwrap_or_else(|| "192.168.0.20".to_string());
    let lan_clone = lan_target.clone();

    let (hostname, os_version, public_ip, nb_status, ping_lan, ping_ref, speed) = tokio::join!(
        fetch_hostname(),
        fetch_os_version(),
        fetch_public_ip(),
        nb.status(),
        avg_ping(&lan_clone, "Terminalserver", 4),
        avg_ping("1.1.1.1", "Internet", 4),
        quick_speed_test(&lan_target),
    );

    let os_user = std::env::var("USER")
        .or_else(|_| std::env::var("USERNAME"))
        .unwrap_or_default();
    let local_ip = nb_status.ok().and_then(|s| s.local_ip);

    let payload = serde_json::json!({
        "event": "enrollment",
        "product": branding.product.name,
        "version": branding.product.version,
        "hostname": hostname,
        "os_user": os_user,
        "os_name": std::env::consts::OS,
        "os_version": os_version,
        "public_ip": public_ip,
        "local_ip": local_ip,
        "management": branding.netbird.management_url,
        "ping_lan": ping_lan.as_ref().map(|p| serde_json::json!({
            "target": p.target, "avg_ms": p.avg_ms, "min_ms": p.min_ms, "max_ms": p.max_ms, "ok": p.ok
        })),
        "ping_internet": ping_ref.as_ref().map(|p| serde_json::json!({
            "target": p.target, "avg_ms": p.avg_ms, "min_ms": p.min_ms, "max_ms": p.max_ms, "ok": p.ok
        })),
        "speed": speed.as_ref().map(|s| serde_json::json!({
            "target": s.target, "duration_ms": s.duration_ms, "mbps": s.mbps
        })),
        "timestamp": chrono::Utc::now().to_rfc3339(),
    });

    let json_str = serde_json::to_string(&payload)
        .map_err(|e| AppError::Internal(e.to_string()))?;

    // POST via curl (cross-platform, CREATE_NO_WINDOW)
    let mut cmd = TokioCommand::new("curl");
    cmd.args([
        "-s", "-X", "POST",
        "-H", "Content-Type: application/json",
        "-d", &json_str,
        "--max-time", "5",
        &webhook,
    ])
    .stdout(std::process::Stdio::null())
    .stderr(std::process::Stdio::null());
    #[cfg(target_os = "windows")]
    cmd.creation_flags(0x08000000);

    let _ = timeout(Duration::from_secs(6), cmd.output()).await;
    tracing::info!("Enrollment Diagnostic gesendet an {}", webhook);
    Ok(())
}

/// TCP probe of the management server with a hard 2 second timeout.
/// We don't care about TLS validation here — only "is the host reachable".
async fn management_reachable(url: &str) -> bool {
    // Strip scheme to get host[:port]
    let stripped = url
        .trim_start_matches("https://")
        .trim_start_matches("http://");
    let host_port = stripped.split('/').next().unwrap_or(stripped);
    let (host, port) = match host_port.rsplit_once(':') {
        Some((h, p)) => (h, p.parse::<u16>().unwrap_or(443)),
        None => (host_port, 443u16),
    };
    let addr = format!("{}:{}", host, port);
    match timeout(
        Duration::from_secs(2),
        tokio::net::TcpStream::connect(addr),
    )
    .await
    {
        Ok(Ok(_)) => true,
        _ => false,
    }
}

#[tauri::command]
pub async fn nb_disconnect(
    app: AppHandle,
    state: State<'_, AppState>,
) -> AppResult<()> {
    state.netbird.down().await?;
    if let Ok(s) = state.netbird.status().await {
        let _ = app.emit("netbird-status-changed", &s);
    }
    Ok(())
}

#[tauri::command]
pub async fn nb_status(state: State<'_, AppState>) -> AppResult<StatusDto> {
    match state.netbird.status().await {
        Ok(s) => Ok(s),
        Err(AppError::NetbirdMissing) => Ok(StatusDto::disconnected(false)),
        Err(e) => Err(e),
    }
}

/// Enrollment check — uses a LOCAL FILE marker instead of keyring to avoid
/// macOS Keychain prompts on every startup. Zero keychain hits at boot.
#[tauri::command]
pub async fn nb_is_enrolled(app: AppHandle, state: State<'_, AppState>) -> AppResult<bool> {
    // Fast: check local marker file (no keychain, no subprocess)
    if enrolled_marker_path(&app).map(|p| p.exists()).unwrap_or(false) {
        return Ok(true);
    }
    // Slow: ask netbird if already connected (CLI call, no keychain)
    match timeout(Duration::from_secs(3), state.netbird.status()).await {
        Ok(Ok(s)) if s.management_connected => {
            // Create marker so next startup is instant
            let _ = write_enrolled_marker(&app);
            Ok(true)
        }
        _ => Ok(false),
    }
}

fn enrolled_marker_path(app: &AppHandle) -> Option<std::path::PathBuf> {
    app.path()
        .app_data_dir()
        .ok()
        .map(|d| d.join("enrolled.flag"))
}

fn write_enrolled_marker(app: &AppHandle) -> AppResult<()> {
    if let Some(path) = enrolled_marker_path(app) {
        if let Some(parent) = path.parent() {
            let _ = std::fs::create_dir_all(parent);
        }
        std::fs::write(&path, chrono::Utc::now().to_rfc3339())
            .map_err(|e| AppError::Internal(format!("Marker schreiben: {}", e)))?;
    }
    Ok(())
}

#[tauri::command]
pub async fn nb_reset_enrollment(
    app: AppHandle,
    state: State<'_, AppState>,
) -> AppResult<()> {
    let _ = state.netbird.down().await;
    // Delete the enrollment marker so the enrollment screen shows again
    if let Some(path) = enrolled_marker_path(&app) {
        let _ = std::fs::remove_file(path);
    }
    cached_delete_setup_key(&state).await?;
    if let Ok(s) = state.netbird.status().await {
        let _ = app.emit("netbird-status-changed", &s);
    }
    Ok(())
}

#[tauri::command]
pub async fn nb_logs(
    lines: Option<usize>,
    state: State<'_, AppState>,
) -> AppResult<Vec<String>> {
    Ok(state.netbird.logs.last(lines.unwrap_or(200)))
}

/// Cross-platform single-shot ICMP ping. Returns true on success, false on
/// failure or timeout. Never panics.
pub async fn ping_host(host: &str, timeout_ms: u64) -> bool {
    #[cfg(target_os = "windows")]
    let args: Vec<String> = vec![
        "-n".into(),
        "1".into(),
        "-w".into(),
        timeout_ms.to_string(),
        host.into(),
    ];
    #[cfg(target_os = "macos")]
    let args: Vec<String> = vec![
        "-c".into(),
        "1".into(),
        "-W".into(),
        timeout_ms.to_string(),
        host.into(),
    ];
    #[cfg(all(unix, not(target_os = "macos")))]
    let args: Vec<String> = vec![
        "-c".into(),
        "1".into(),
        "-W".into(),
        format!("{}", (timeout_ms / 1000).max(1)),
        host.into(),
    ];

    let mut cmd = TokioCommand::new("ping");
    cmd.args(&args)
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null());
    #[cfg(target_os = "windows")]
    cmd.creation_flags(0x08000000);
    let fut = cmd.status();

    match timeout(Duration::from_millis(timeout_ms + 500), fut).await {
        Ok(Ok(status)) => status.success(),
        _ => false,
    }
}

#[derive(Serialize, Clone, Debug)]
pub struct SpeedResult {
    pub target: String,
    pub bytes: usize,
    pub duration_ms: u64,
    pub mbps: f64,
}

#[derive(Serialize, Clone, Debug)]
pub struct PingResult {
    pub target: String,
    pub label: String,
    pub avg_ms: f64,
    pub min_ms: f64,
    pub max_ms: f64,
    pub pings: u32,
    pub ok: bool,
}

#[derive(Serialize, Clone, Debug)]
pub struct DebugInfo {
    pub os_username: String,
    pub hostname: String,
    pub os_name: String,
    pub os_version: String,
    pub app_version: String,
    pub internet_ok: bool,
    pub vpn_connected: bool,
    pub netbird_cli_present: bool,
    pub lan_target: String,
    pub lan_ok: bool,
    pub local_ip: Option<String>,
    pub public_ip: Option<String>,
    pub peers_total: usize,
    pub peers_connected: usize,
    pub detected_issue: String,
    pub speed: Option<SpeedResult>,
    pub timestamp: String,
}

async fn shell_output(cmd: &str, args: &[&str]) -> Option<String> {
    let mut c = TokioCommand::new(cmd);
    c.args(args)
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::null());
    #[cfg(target_os = "windows")]
    c.creation_flags(0x08000000);
    let out = c.output().await.ok()?;
    if !out.status.success() {
        return None;
    }
    let s = String::from_utf8_lossy(&out.stdout).trim().to_string();
    if s.is_empty() {
        None
    } else {
        Some(s)
    }
}

async fn fetch_hostname() -> String {
    shell_output("hostname", &[])
        .await
        .unwrap_or_else(|| "unbekannt".to_string())
}

async fn fetch_public_ip() -> Option<String> {
    // Best effort via curl — cheap, universally available, hidden console.
    let fut = shell_output(
        "curl",
        &["-4", "-s", "--max-time", "3", "https://checkip.amazonaws.com"],
    );
    match timeout(Duration::from_secs(4), fut).await {
        Ok(Some(s)) => Some(s.trim().to_string()),
        _ => None,
    }
}

async fn fetch_os_version() -> String {
    #[cfg(target_os = "macos")]
    {
        let name = shell_output("sw_vers", &["-productName"]).await;
        let ver = shell_output("sw_vers", &["-productVersion"]).await;
        match (name, ver) {
            (Some(n), Some(v)) => format!("{} {}", n, v),
            (_, Some(v)) => format!("macOS {}", v),
            _ => "macOS".to_string(),
        }
    }
    #[cfg(target_os = "windows")]
    {
        shell_output("cmd", &["/c", "ver"])
            .await
            .unwrap_or_else(|| "Windows".to_string())
    }
    #[cfg(all(unix, not(target_os = "macos")))]
    {
        shell_output("uname", &["-sr"])
            .await
            .unwrap_or_else(|| "Linux".to_string())
    }
}

#[tauri::command]
pub async fn get_debug_info(
    state: State<'_, AppState>,
    branding_state: AppHandle,
) -> AppResult<DebugInfo> {
    let branding = ensure_branding(&branding_state, &state).await.ok();
    let lan_target = branding
        .as_ref()
        .and_then(|b| b.quick_launch.iter().find(|q| q.kind == "rdp"))
        .map(|q| q.target.clone())
        .unwrap_or_else(|| "192.168.0.20".to_string());
    let app_version = branding
        .as_ref()
        .map(|b| b.product.version.clone())
        .unwrap_or_else(|| env!("CARGO_PKG_VERSION").to_string());

    let nb_client = state.netbird.clone();
    let lan_target_clone = lan_target.clone();

    // Run everything in parallel — this keeps the diagnose panel snappy.
    let (internet, status_res, lan, hostname, public_ip, os_version) = tokio::join!(
        ping_host("8.8.8.8", 1500),
        nb_client.status(),
        ping_host(&lan_target_clone, 1500),
        fetch_hostname(),
        fetch_public_ip(),
        fetch_os_version(),
    );

    let (vpn_connected, netbird_cli_present, local_ip, peers_total, peers_connected) =
        match status_res {
            Ok(s) => (
                matches!(s.state, ConnectionState::Connected),
                true,
                s.local_ip.clone(),
                s.peers.len(),
                s.peers.iter().filter(|p| p.connected).count(),
            ),
            Err(AppError::NetbirdMissing) => (false, false, None, 0, 0),
            Err(_) => (false, true, None, 0, 0),
        };

    let detected_issue = if !internet {
        "Keine Internetverbindung. Bitte WLAN / Netzwerk prüfen.".to_string()
    } else if !netbird_cli_present {
        "Netbird Client nicht installiert. Bei KronSolutions melden.".to_string()
    } else if !vpn_connected {
        "VPN nicht verbunden. Bitte auf Verbinden klicken.".to_string()
    } else if !lan {
        "VPN ist verbunden, Terminalserver antwortet aber nicht — evtl. Firewall.".to_string()
    } else {
        "Alles in Ordnung — verbunden und einsatzbereit.".to_string()
    };

    let os_username = std::env::var("USER")
        .or_else(|_| std::env::var("USERNAME"))
        .unwrap_or_else(|_| "unbekannt".to_string());

    let speed = if lan {
        quick_speed_test(&lan_target_clone).await
    } else if internet {
        quick_speed_test("8.8.8.8").await
    } else {
        None
    };

    Ok(DebugInfo {
        os_username,
        hostname,
        os_name: std::env::consts::OS.to_string(),
        os_version,
        app_version,
        internet_ok: internet,
        vpn_connected,
        netbird_cli_present,
        lan_target,
        lan_ok: lan,
        local_ip,
        public_ip,
        peers_total,
        peers_connected,
        detected_issue,
        speed,
        timestamp: chrono::Utc::now().to_rfc3339(),
    })
}

/// Run N pings and parse the average RTT from the system ping output.
/// Returns a structured PingResult with min/avg/max from the summary line.
async fn avg_ping(host: &str, label: &str, count: u32) -> Option<PingResult> {
    #[cfg(target_os = "windows")]
    let args = vec!["-n".to_string(), count.to_string(), "-w".to_string(), "2000".to_string(), host.to_string()];
    #[cfg(target_os = "macos")]
    let args = vec!["-c".to_string(), count.to_string(), "-W".to_string(), "2000".to_string(), host.to_string()];
    #[cfg(all(unix, not(target_os = "macos")))]
    let args = vec!["-c".to_string(), count.to_string(), "-W".to_string(), "2".to_string(), host.to_string()];

    let mut cmd = TokioCommand::new("ping");
    cmd.args(&args)
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::null());
    #[cfg(target_os = "windows")]
    cmd.creation_flags(0x08000000);

    let output = match timeout(Duration::from_secs(count as u64 * 3 + 2), cmd.output()).await {
        Ok(Ok(o)) if o.status.success() => o,
        _ => return Some(PingResult {
            target: host.to_string(),
            label: label.to_string(),
            avg_ms: 0.0, min_ms: 0.0, max_ms: 0.0,
            pings: count, ok: false,
        }),
    };

    let stdout = String::from_utf8_lossy(&output.stdout);

    // Parse avg from summary line:
    // macOS/Linux: "round-trip min/avg/max/stddev = 18.5/19.2/20.1/0.5 ms"
    // Windows:     "Minimum = 18ms, Maximum = 20ms, Average = 19ms" (German: Mittelwert)
    let (min, avg, max) = parse_ping_summary(&stdout);

    Some(PingResult {
        target: host.to_string(),
        label: label.to_string(),
        avg_ms: avg,
        min_ms: min,
        max_ms: max,
        pings: count,
        ok: avg > 0.0,
    })
}

fn parse_ping_summary(output: &str) -> (f64, f64, f64) {
    // Unix format: min/avg/max/stddev = 18.5/19.2/20.1/0.5 ms
    // or: min/avg/max/mdev = ...
    for line in output.lines() {
        if line.contains("min/avg/max") || line.contains("rtt min") || line.contains("round-trip") {
            if let Some(eq_pos) = line.find('=') {
                let nums = &line[eq_pos + 1..];
                let parts: Vec<&str> = nums.trim().split('/').collect();
                if parts.len() >= 3 {
                    let min = parts[0].trim().parse::<f64>().unwrap_or(0.0);
                    let avg = parts[1].trim().parse::<f64>().unwrap_or(0.0);
                    let max = parts[2].trim().parse::<f64>().unwrap_or(0.0);
                    return (min, avg, max);
                }
            }
        }
        // Windows: "Average = 19ms" or "Mittelwert = 19ms"
        let lower = line.to_lowercase();
        if lower.contains("average") || lower.contains("mittelwert") {
            if let Some(eq_pos) = line.rfind('=') {
                let val = line[eq_pos + 1..]
                    .trim()
                    .trim_end_matches("ms")
                    .trim()
                    .parse::<f64>()
                    .unwrap_or(0.0);
                // Windows also has Minimum and Maximum on the same line
                let min = extract_windows_ping_val(line, "Minimum")
                    .or_else(|| extract_windows_ping_val(line, "minimum"))
                    .unwrap_or(val);
                let max = extract_windows_ping_val(line, "Maximum")
                    .or_else(|| extract_windows_ping_val(line, "maximum"))
                    .unwrap_or(val);
                return (min, val, max);
            }
        }
    }
    (0.0, 0.0, 0.0)
}

fn extract_windows_ping_val(line: &str, key: &str) -> Option<f64> {
    let lower = line.to_lowercase();
    let key_lower = key.to_lowercase();
    if let Some(pos) = lower.find(&key_lower) {
        let after = &line[pos + key.len()..];
        if let Some(eq) = after.find('=') {
            let val_str = after[eq + 1..]
                .trim()
                .split(|c: char| !c.is_ascii_digit() && c != '.')
                .next()?;
            return val_str.parse::<f64>().ok();
        }
    }
    None
}

/// Quick connection quality test — measures TCP connect latency to the target
/// and runs 3 pings in parallel to get a reliable RTT average. This isn't a
/// bandwidth test but gives Support a clear signal how good the connection is.
async fn quick_speed_test(host: &str) -> Option<SpeedResult> {
    // Strategy 1: TCP connect time (most reliable, works through firewalls)
    let addr = if host.contains(':') {
        host.to_string()
    } else {
        // Try common ports — RDP first (3389), then HTTPS (443)
        format!("{}:3389", host)
    };

    let tcp_start = tokio::time::Instant::now();
    let tcp_ok = timeout(
        Duration::from_secs(3),
        tokio::net::TcpStream::connect(&addr),
    )
    .await;
    let tcp_ms = tcp_start.elapsed().as_millis() as u64;

    if matches!(tcp_ok, Ok(Ok(_))) {
        return Some(SpeedResult {
            target: host.to_string(),
            bytes: 0,
            duration_ms: tcp_ms,
            mbps: 0.0,
        });
    }

    // Strategy 2: fallback to ICMP ping
    let ping_start = tokio::time::Instant::now();
    let ok = ping_host(host, 3000).await;
    let ping_ms = ping_start.elapsed().as_millis() as u64;

    if ok {
        Some(SpeedResult {
            target: host.to_string(),
            bytes: 0,
            duration_ms: ping_ms,
            mbps: 0.0,
        })
    } else {
        None
    }
}

/// Separate ping quality test — called lazily AFTER the diagnose page loads.
/// Runs 4-ping averages to LAN + reference target in parallel.
/// Uses 1.1.1.1 (Cloudflare) as reference since it always responds to ICMP,
/// unlike many Hetzner IPs which block ping.
#[tauri::command]
pub async fn run_ping_test(
    app: AppHandle,
    state: State<'_, AppState>,
) -> AppResult<Vec<PingResult>> {
    let branding = ensure_branding(&app, &state).await.ok();
    let lan_target = branding
        .as_ref()
        .and_then(|b| b.quick_launch.iter().find(|q| q.kind == "rdp"))
        .map(|q| q.target.clone())
        .unwrap_or_else(|| "192.168.0.20".to_string());
    let (ping_lan, ping_ref) = tokio::join!(
        avg_ping(&lan_target, "Terminalserver", 4),
        avg_ping("1.1.1.1", "Internet Referenz", 4),
    );
    let mut results = vec![];
    if let Some(p) = ping_lan { results.push(p); }
    if let Some(p) = ping_ref { results.push(p); }
    Ok(results)
}

/// Standalone speed test command — downloads 500 KB from Cloudflare's speed
/// test CDN and measures real download throughput. Cross-platform, uses curl.
#[tauri::command]
pub async fn run_speed_test() -> AppResult<SpeedResult> {
    #[cfg(target_os = "windows")]
    let null_dev = "NUL";
    #[cfg(not(target_os = "windows"))]
    let null_dev = "/dev/null";

    let url = "https://speed.cloudflare.com/__down?bytes=10000000";

    let mut cmd = TokioCommand::new("curl");
    cmd.args([
        "-s",
        "-o", null_dev,
        "-w", "%{speed_download}",
        "--max-time", "15",
        url,
    ])
    .stdout(std::process::Stdio::piped())
    .stderr(std::process::Stdio::null());
    #[cfg(target_os = "windows")]
    cmd.creation_flags(0x08000000);

    let start = tokio::time::Instant::now();
    let output = match timeout(Duration::from_secs(20), cmd.output()).await {
        Ok(Ok(o)) => o,
        Ok(Err(e)) => return Err(AppError::Internal(format!("curl nicht gefunden: {}", e))),
        Err(_) => return Err(AppError::Internal("Speedtest Timeout (10s)".into())),
    };
    let elapsed = start.elapsed().as_millis() as u64;

    let speed_str = String::from_utf8_lossy(&output.stdout).trim().to_string();
    let bytes_per_sec: f64 = speed_str.parse().unwrap_or(0.0);
    let mbps = (bytes_per_sec * 8.0 / 1_000_000.0 * 100.0).round() / 100.0;

    Ok(SpeedResult {
        target: "Cloudflare CDN (10 MB)".to_string(),
        bytes: 10_000_000,
        duration_ms: elapsed,
        mbps,
    })
}

#[derive(Serialize, Clone, Debug)]
pub struct SmartDebugResult {
    pub steps: Vec<SmartDebugStep>,
    pub summary: String,
}

#[derive(Serialize, Clone, Debug)]
pub struct SmartDebugStep {
    pub name: String,
    pub ok: bool,
    pub detail: String,
    pub action_taken: Option<String>,
}

/// Smart self-healing debug — runs checks in sequence and tries to fix
/// common problems automatically. Returns what it found and what it did.
#[tauri::command]
pub async fn smart_debug(
    app: AppHandle,
    state: State<'_, AppState>,
) -> AppResult<SmartDebugResult> {
    let branding = ensure_branding(&app, &state).await.ok();
    let mgmt_url = branding
        .as_ref()
        .map(|b| b.netbird.management_url.clone())
        .unwrap_or_else(|| "https://vpn.secure.nkk-hb.de".to_string());
    let mut steps: Vec<SmartDebugStep> = vec![];

    let debug_lan = branding
        .as_ref()
        .and_then(|b| b.quick_launch.iter().find(|q| q.kind == "rdp"))
        .map(|q| q.target.clone())
        .unwrap_or_else(|| "192.168.0.20".to_string());

    // ── Step 1: Internet ──
    let internet = ping_host("8.8.8.8", 2000).await;
    steps.push(SmartDebugStep {
        name: "Internet".into(),
        ok: internet,
        detail: if internet {
            "Ping 8.8.8.8 OK".into()
        } else {
            "Kein Internet — WLAN verbunden? Kabel drin?".into()
        },
        action_taken: None,
    });
    if !internet {
        return Ok(SmartDebugResult {
            summary: "Kein Internet. Bitte WLAN oder Netzwerkkabel prüfen.".into(),
            steps,
        });
    }

    // ── Step 2: DNS — kann die Management Domain aufgelöst werden? ──
    let mgmt_host = mgmt_url
        .trim_start_matches("https://")
        .trim_start_matches("http://")
        .split(':')
        .next()
        .unwrap_or("vpn.secure.nkk-hb.de");
    let dns_ok = ping_host(mgmt_host, 2000).await;
    steps.push(SmartDebugStep {
        name: "DNS".into(),
        ok: dns_ok,
        detail: if dns_ok {
            format!("{} auflösbar", mgmt_host)
        } else {
            format!("{} nicht erreichbar — DNS Problem?", mgmt_host)
        },
        action_taken: None,
    });

    // ── Step 3: Management Server erreichbar? ──
    let mgmt_reachable = management_reachable(&mgmt_url).await;
    steps.push(SmartDebugStep {
        name: "Management Server".into(),
        ok: mgmt_reachable,
        detail: if mgmt_reachable {
            "Server antwortet".into()
        } else {
            "Server nicht erreichbar — evtl. Wartung?".into()
        },
        action_taken: None,
    });

    // ── Step 4: NetBird CLI + Service ──
    let status_result = state.netbird.status().await;
    let cli_present = !matches!(status_result, Err(AppError::NetbirdMissing));
    let mut cli_step = SmartDebugStep {
        name: "NetBird Client".into(),
        ok: cli_present,
        detail: if cli_present {
            "Installiert und bereit".into()
        } else {
            "Nicht installiert".into()
        },
        action_taken: None,
    };

    if !cli_present {
        // Try: start service (maybe installed but not running)
        #[cfg(target_os = "windows")]
        {
            cli_step.action_taken = Some("Versuche Service zu starten …".into());
            let mut sc = TokioCommand::new("sc.exe");
            sc.args(["start", "netbird"]);
            sc.creation_flags(0x08000000);
            if let Ok(Ok(_)) = timeout(Duration::from_secs(5), sc.output()).await {
                sleep(Duration::from_secs(2)).await;
                if state.netbird.status().await.is_ok() {
                    cli_step.ok = true;
                    cli_step.detail = "Service war gestoppt".into();
                    cli_step.action_taken = Some("Service erfolgreich gestartet!".into());
                }
            }
        }
        #[cfg(target_os = "macos")]
        {
            cli_step.action_taken = Some("Versuche Daemon zu starten …".into());
            // Try starting via netbird service command (no sudo — avoids TTY hang)
            let svc = timeout(
                Duration::from_secs(5),
                TokioCommand::new(state.netbird.binary_path())
                    .args(["service", "start"])
                    .output(),
            ).await;
            if matches!(svc, Ok(Ok(_))) {
                sleep(Duration::from_secs(2)).await;
                if state.netbird.status().await.is_ok() {
                    cli_step.ok = true;
                    cli_step.detail = "Service war gestoppt".into();
                    cli_step.action_taken = Some("Service erfolgreich gestartet!".into());
                }
            }
        }
        if !cli_step.ok {
            cli_step.action_taken = Some("Bitte NKK Secure Access Installer erneut ausführen.".into());
        }
    }
    steps.push(cli_step);

    if !cli_present && !steps.last().map_or(false, |s| s.ok) {
        return Ok(SmartDebugResult {
            summary: "NetBird Client fehlt. Bitte den Installer erneut ausführen.".into(),
            steps,
        });
    }

    // ── Step 5: VPN Tunnel ──
    let connected = match &status_result {
        Ok(s) => matches!(s.state, ConnectionState::Connected),
        _ => false,
    };
    let mut vpn_step = SmartDebugStep {
        name: "VPN Tunnel".into(),
        ok: connected,
        detail: if connected { "Verbunden".into() } else { "Getrennt".into() },
        action_taken: None,
    };

    if !connected && cli_present {
        // Try 1: restart service
        #[cfg(target_os = "windows")]
        {
            vpn_step.action_taken = Some("Starte Service neu …".into());
            let mut sc_stop = TokioCommand::new("sc.exe");
            sc_stop.args(["stop", "netbird"]);
            sc_stop.creation_flags(0x08000000);
            let _ = timeout(Duration::from_secs(3), sc_stop.output()).await;
            sleep(Duration::from_millis(500)).await;
            let mut sc_start = TokioCommand::new("sc.exe");
            sc_start.args(["start", "netbird"]);
            sc_start.creation_flags(0x08000000);
            let _ = timeout(Duration::from_secs(3), sc_start.output()).await;
            sleep(Duration::from_secs(2)).await;
        }
        #[cfg(target_os = "macos")]
        {
            vpn_step.action_taken = Some("Starte Daemon neu …".into());
            let _ = timeout(
                Duration::from_secs(3),
                TokioCommand::new(&state.netbird.binary_path())
                    .args(["service", "stop"])
                    .output(),
            ).await;
            sleep(Duration::from_millis(500)).await;
            let _ = timeout(
                Duration::from_secs(3),
                TokioCommand::new(&state.netbird.binary_path())
                    .args(["service", "start"])
                    .output(),
            ).await;
            sleep(Duration::from_secs(2)).await;
        }

        // Try 2: netbird up with setup key
        let key = cached_setup_key(&state).await.ok().flatten();
        if key.is_some() {
            vpn_step.action_taken = Some("Versuche Reconnect …".into());
            let up_result = timeout(
                Duration::from_secs(8),
                state.netbird.up(&mgmt_url, key.as_deref()),
            )
            .await;
            if matches!(up_result, Ok(Ok(_))) {
                sleep(Duration::from_secs(2)).await;
                if let Ok(s) = state.netbird.status().await {
                    if matches!(s.state, ConnectionState::Connected) {
                        vpn_step.ok = true;
                        vpn_step.detail = "Verbunden (auto-repariert)".into();
                        vpn_step.action_taken = Some("Reconnect erfolgreich!".into());
                        // Push status to UI
                        let _ = app.emit("netbird-status-changed", &s);
                    }
                }
            }
        }
        if !vpn_step.ok {
            vpn_step.action_taken = Some(
                "Automatische Reparatur fehlgeschlagen. Bitte App schließen, 10 Sekunden warten, neu starten.".into()
            );
        }
    }
    steps.push(vpn_step);

    // ── Step 6: LAN Erreichbarkeit ──
    let lan_ok = ping_host(&debug_lan, 2000).await;
    let mut lan_step = SmartDebugStep {
        name: "Firmennetz".into(),
        ok: lan_ok,
        detail: if lan_ok {
            format!("{} erreichbar", debug_lan)
        } else {
            format!("{} nicht erreichbar", debug_lan)
        },
        action_taken: None,
    };
    if !lan_ok && connected {
        lan_step.action_taken = Some("VPN steht aber Server antwortet nicht — evtl. Firewall oder Server aus.".into());
    } else if !lan_ok && !connected {
        lan_step.action_taken = Some("VPN ist nicht verbunden — zuerst VPN verbinden.".into());
    }
    steps.push(lan_step);

    // ── Step 7: RDP Port Check ──
    if lan_ok {
        let rdp_addr = format!("{}:3389", debug_lan);
        let rdp_ok = match timeout(
            Duration::from_secs(3),
            tokio::net::TcpStream::connect(&rdp_addr),
        ).await {
            Ok(Ok(_)) => true,
            _ => false,
        };
        steps.push(SmartDebugStep {
            name: "Remote Desktop".into(),
            ok: rdp_ok,
            detail: if rdp_ok {
                "Port 3389 offen — RDP bereit".into()
            } else {
                "Port 3389 geschlossen — Terminalserver evtl. aus oder Firewall blockiert".into()
            },
            action_taken: if !rdp_ok {
                Some("Bitte beim Administrator melden — Terminalserver prüfen.".into())
            } else {
                None
            },
        });
    }

    // ── Step 8: Latenz ──
    let speed = quick_speed_test(&debug_lan).await;
    if let Some(s) = &speed {
        let quality = if s.duration_ms < 30 { "Exzellent" }
            else if s.duration_ms < 80 { "Gut" }
            else if s.duration_ms < 150 { "Akzeptabel" }
            else { "Langsam — Arbeit könnte laggen" };
        steps.push(SmartDebugStep {
            name: "Latenz".into(),
            ok: s.duration_ms < 150,
            detail: format!("{} ms — {}", s.duration_ms, quality),
            action_taken: if s.duration_ms >= 150 {
                Some("Langsame Verbindung. Näher an den Router gehen oder LAN Kabel nutzen.".into())
            } else {
                None
            },
        });
    }

    // ── Summary ──
    let all_ok = steps.iter().all(|s| s.ok);
    let fixed = steps.iter().any(|s| s.action_taken.as_ref().map_or(false, |a| a.contains("erfolgreich")));
    let summary = if all_ok && fixed {
        "Probleme wurden automatisch behoben — alles funktioniert jetzt.".into()
    } else if all_ok {
        "Alle Checks bestanden — Verbindung ist einsatzbereit.".into()
    } else {
        let failed: Vec<&str> = steps.iter().filter(|s| !s.ok).map(|s| s.name.as_str()).collect();
        format!("Probleme bei: {}. Empfehlungen stehen bei jedem Schritt.", failed.join(", "))
    };

    Ok(SmartDebugResult { steps, summary })
}

/// Allow only host-like targets: letters, digits, dots, dashes, optional port.
/// Blocks shell metacharacters even though we pass args separately.
fn validate_host_target(target: &str) -> AppResult<String> {
    let trimmed = target.trim();
    if trimmed.is_empty() {
        return Err(AppError::Internal("Ziel darf nicht leer sein.".into()));
    }
    if trimmed.len() > 255 {
        return Err(AppError::Internal("Ziel ist zu lang.".into()));
    }
    if !trimmed
        .chars()
        .all(|c| c.is_ascii_alphanumeric() || c == '.' || c == '-' || c == ':')
    {
        return Err(AppError::Internal(format!(
            "Ungültiges Verbindungsziel: {}",
            trimmed
        )));
    }
    Ok(trimmed.to_string())
}

#[tauri::command]
pub async fn open_rdp(
    app: AppHandle,
    target: String,
    state: State<'_, AppState>,
) -> AppResult<()> {
    let target = validate_host_target(&target)?;

    // NON-BLOCKING VPN check — launch RDP immediately, reconnect in background.
    // The old approach waited 10-25 seconds for VPN to connect before launching
    // mstsc, which felt sluggish. Now we launch RDP first and let VPN catch up.
    let nb_clone = state.netbird.clone();
    let branding_result = ensure_branding(&app, &state).await.ok();
    let key = cached_setup_key(&state).await.ok().flatten();

    tauri::async_runtime::spawn(async move {
        // Quick 2s status check — if VPN is down, fire-and-forget a reconnect
        let needs_reconnect = match timeout(Duration::from_secs(2), nb_clone.status()).await {
            Ok(Ok(s)) => !matches!(s.state, ConnectionState::Connected),
            _ => true,
        };
        if needs_reconnect {
            if let Some(b) = branding_result {
                tracing::info!("RDP: VPN nicht verbunden, versuche Background-Reconnect");
                let _ = nb_clone.up(&b.netbird.management_url, key.as_deref()).await;
            }
        }
    });

    // Pre-stage credentials from stored profile (if any) via cmdkey on Windows.
    // This must happen BEFORE mstsc launch so it picks them up.
    #[cfg(target_os = "windows")]
    {
        let profiles = cached_profiles(&state).await.unwrap_or_default();
        if let Some(p) = profiles.first() {
            use std::os::windows::process::CommandExt;
            let user = match &p.domain {
                Some(d) if !d.is_empty() => format!("{}\\{}", d, p.username),
                _ => p.username.clone(),
            };
            tracing::info!("RDP: Injiziere Credentials für {} via cmdkey", user);
            let cmdkey_result = std::process::Command::new("cmdkey")
                .args([
                    &format!("/generic:TERMSRV/{}", target),
                    &format!("/user:{}", user),
                    &format!("/pass:{}", p.password),
                ])
                .creation_flags(0x08000000) // CREATE_NO_WINDOW
                .output();
            match &cmdkey_result {
                Ok(o) if o.status.success() => tracing::info!("RDP: cmdkey erfolgreich"),
                Ok(o) => tracing::warn!("RDP: cmdkey Exit Code {}", o.status),
                Err(e) => tracing::warn!("RDP: cmdkey Fehler: {}", e),
            }
        }
    }

    // Launch RDP IMMEDIATELY — no waiting for VPN
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        std::process::Command::new("mstsc.exe")
            .arg(format!("/v:{}", target))
            .creation_flags(0x08000000)
            .spawn()
            .map_err(|e| AppError::Internal(format!("mstsc start: {}", e)))?;
        return Ok(());
    }

    #[cfg(target_os = "macos")]
    {
        let profiles = cached_profiles(&state).await.unwrap_or_default();

        // Try xfreerdp first (supports password injection)
        let has_xfreerdp = std::process::Command::new("which")
            .arg("xfreerdp3")
            .output()
            .map(|o| o.status.success())
            .unwrap_or(false)
            || std::process::Command::new("which")
                .arg("xfreerdp")
                .output()
                .map(|o| o.status.success())
                .unwrap_or(false);

        if has_xfreerdp {
            if let Some(p) = profiles.first() {
                let bin = if std::process::Command::new("which")
                    .arg("xfreerdp3")
                    .output()
                    .map(|o| o.status.success())
                    .unwrap_or(false)
                {
                    "xfreerdp3"
                } else {
                    "xfreerdp"
                };
                let user = match &p.domain {
                    Some(d) if !d.is_empty() => format!("{}\\{}", d, p.username),
                    _ => p.username.clone(),
                };
                std::process::Command::new(bin)
                    .args([
                        &format!("/v:{}", target),
                        &format!("/u:{}", user),
                        &format!("/p:{}", p.password),
                        "/cert:ignore",
                        "/f",
                        "/clipboard",
                        "/sound",
                        "/smart-sizing",
                    ])
                    .spawn()
                    .map_err(|e| AppError::Internal(format!("xfreerdp: {}", e)))?;
                return Ok(());
            }
        }

        // Fallback: .rdp file for Microsoft Remote Desktop
        // macOS: only pre-fill username (no domain — Apple RDP handles it automatically,
        // no password — Keychain injection not possible on macOS)
        let mut rdp = format!(
            "full address:s:{target}\nauthentication level:i:2\nscreen mode id:i:2\nsmart sizing:i:1\naudiomode:i:0\nredirectclipboard:i:1\nuse multimon:i:0\n"
        );
        if let Some(p) = profiles.first() {
            if !p.username.is_empty() {
                rdp.push_str(&format!("username:s:{}\n", p.username));
            }
            rdp.push_str("prompt for credentials:i:0\n");
        } else {
            rdp.push_str("prompt for credentials:i:1\n");
        }
        let safe_name = target.replace([':', '/', '\\'], "_");
        let path = std::env::temp_dir().join(format!("nkk-{}.rdp", safe_name));
        std::fs::write(&path, rdp)
            .map_err(|e| AppError::Internal(format!("rdp file: {}", e)))?;
        std::process::Command::new("open")
            .arg(&path)
            .spawn()
            .map_err(|e| AppError::Internal(format!("open rdp: {}", e)))?;
        return Ok(());
    }

    #[cfg(all(unix, not(target_os = "macos")))]
    {
        std::process::Command::new("xfreerdp")
            .arg(format!("/v:{}", target))
            .spawn()
            .map_err(|e| AppError::Internal(format!("xfreerdp: {}", e)))?;
        Ok(())
    }
}

#[tauri::command]
pub async fn open_smb(target: String) -> AppResult<()> {
    let target = target.trim().to_string();
    if target.is_empty() {
        return Err(AppError::Internal("SMB Ziel ist leer.".into()));
    }
    let safe = target
        .chars()
        .all(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '-' | '\\' | '/' | '_' | '$'));
    if !safe {
        return Err(AppError::Internal(format!(
            "Ungültiges SMB Ziel: {}",
            target
        )));
    }
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        std::process::Command::new("explorer.exe")
            .arg(&target)
            .creation_flags(0x08000000)
            .spawn()
            .map_err(|e| AppError::Internal(format!("explorer start: {}", e)))?;
        return Ok(());
    }
    #[cfg(target_os = "macos")]
    {
        let url = if target.starts_with("smb://") {
            target.clone()
        } else {
            format!(
                "smb://{}",
                target.trim_start_matches("\\\\").replace('\\', "/")
            )
        };
        std::process::Command::new("open")
            .arg(url)
            .spawn()
            .map_err(|e| AppError::Internal(format!("open smb: {}", e)))?;
        return Ok(());
    }
    #[cfg(all(unix, not(target_os = "macos")))]
    Err(AppError::Unsupported("SMB".to_string()))
}

#[tauri::command]
pub async fn open_url(url: String) -> AppResult<()> {
    let url = url.trim().to_string();
    if url.is_empty() {
        return Err(AppError::Internal("URL ist leer.".into()));
    }
    // Only allow well-known safe schemes — blocks file://, javascript:, etc.
    let lower = url.to_lowercase();
    let allowed = lower.starts_with("https://")
        || lower.starts_with("http://")
        || lower.starts_with("mailto:");
    if !allowed {
        return Err(AppError::Internal(format!(
            "URL Schema nicht erlaubt: {}",
            url
        )));
    }
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        std::process::Command::new("explorer.exe")
            .arg(&url)
            .creation_flags(0x08000000)
            .spawn()
            .map_err(|e| AppError::Internal(format!("open url: {}", e)))?;
    }
    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open")
            .arg(&url)
            .spawn()
            .map_err(|e| AppError::Internal(format!("open url: {}", e)))?;
    }
    #[cfg(all(unix, not(target_os = "macos")))]
    {
        std::process::Command::new("xdg-open")
            .arg(&url)
            .spawn()
            .map_err(|e| AppError::Internal(format!("open url: {}", e)))?;
    }
    Ok(())
}

#[tauri::command]
pub async fn get_branding(
    app: AppHandle,
    state: State<'_, AppState>,
) -> AppResult<BrandingDto> {
    ensure_branding(&app, &state).await
}

#[tauri::command]
pub async fn set_autostart(app: AppHandle, enable: bool) -> AppResult<()> {
    use tauri_plugin_autostart::ManagerExt;
    let manager = app.autolaunch();
    let result = if enable {
        manager.enable()
    } else {
        manager.disable()
    };
    match result {
        Ok(()) => {
            tracing::info!(
                "Autostart {} erfolgreich",
                if enable { "aktiviert" } else { "deaktiviert" }
            );
            Ok(())
        }
        Err(e) => {
            let msg = e.to_string();
            tracing::warn!("Autostart fehlgeschlagen: {}", msg);
            // Friendlier message — the underlying plugin error is often cryptic
            Err(AppError::Internal(format!(
                "Autostart konnte nicht {} werden. ({})",
                if enable { "aktiviert" } else { "deaktiviert" },
                msg
            )))
        }
    }
}

#[tauri::command]
pub async fn is_autostart_enabled(app: AppHandle) -> AppResult<bool> {
    use tauri_plugin_autostart::ManagerExt;
    let manager = app.autolaunch();
    Ok(manager.is_enabled().unwrap_or(false))
}

#[derive(Serialize, Clone, Debug)]
pub struct SetupCheckResult {
    pub netbird_installed: bool,
    pub netbird_running: bool,
    pub needs_install: bool,
    pub message: String,
}

/// Check if NetBird is installed and running. On macOS, auto-install if missing.
#[tauri::command]
pub async fn check_netbird_setup(state: State<'_, AppState>) -> AppResult<SetupCheckResult> {
    // Check if netbird CLI is available
    let status_result = state.netbird.status().await;
    let installed = !matches!(status_result, Err(AppError::NetbirdMissing));

    if installed {
        let running = status_result.is_ok();
        return Ok(SetupCheckResult {
            netbird_installed: true,
            netbird_running: running,
            needs_install: false,
            message: if running {
                "NetBird ist bereit.".into()
            } else {
                "NetBird ist installiert aber der Dienst läuft nicht.".into()
            },
        });
    }

    Ok(SetupCheckResult {
        netbird_installed: false,
        netbird_running: false,
        needs_install: true,
        message: "NetBird muss noch installiert werden.".into(),
    })
}

/// Install NetBird on macOS using the official install script with admin privileges.
#[tauri::command]
pub async fn install_netbird() -> AppResult<String> {
    #[cfg(target_os = "macos")]
    {
        tracing::info!("Starte NetBird Installation auf macOS ...");

        // Use the official NetBird install script with admin privileges via osascript
        let install_script = r#"curl -fsSL https://pkgs.netbird.io/install.sh | sh"#;

        let result = timeout(
            Duration::from_secs(120),
            TokioCommand::new("osascript")
                .args([
                    "-e",
                    &format!(
                        r#"do shell script "{}" with administrator privileges"#,
                        install_script.replace('"', r#"\""#)
                    ),
                ])
                .output(),
        )
        .await;

        match result {
            Ok(Ok(output)) if output.status.success() => {
                tracing::info!("NetBird Installation erfolgreich");
                // Wait for daemon to start
                sleep(Duration::from_secs(3)).await;
                Ok("NetBird wurde erfolgreich installiert!".into())
            }
            Ok(Ok(output)) => {
                let stderr = String::from_utf8_lossy(&output.stderr);
                let stdout = String::from_utf8_lossy(&output.stdout);
                let msg = if stderr.contains("User canceled") || stdout.contains("User canceled") {
                    "Installation abgebrochen. Bitte Admin-Passwort eingeben.".into()
                } else {
                    format!("Installation fehlgeschlagen: {}", stderr.trim())
                };
                tracing::warn!("NetBird Installation Fehler: {}", msg);
                Err(AppError::Internal(msg))
            }
            Ok(Err(e)) => {
                tracing::warn!("NetBird Installation konnte nicht gestartet werden: {}", e);
                Err(AppError::Internal(format!("Konnte Installation nicht starten: {}", e)))
            }
            Err(_) => {
                tracing::warn!("NetBird Installation Timeout (120s)");
                Err(AppError::Internal("Installation hat zu lange gedauert. Bitte nochmal versuchen.".into()))
            }
        }
    }

    #[cfg(target_os = "windows")]
    {
        // Windows: NetBird is bundled with the NSIS installer, should never reach here
        Ok("NetBird wird vom Installer eingerichtet.".into())
    }

    #[cfg(all(unix, not(target_os = "macos")))]
    {
        Err(AppError::Internal("Bitte NetBird manuell installieren: https://netbird.io/download".into()))
    }
}

#[tauri::command]
pub async fn quit_app(app: AppHandle) -> AppResult<()> {
    app.exit(0);
    Ok(())
}

static MISSING_NOTIFIED: AtomicBool = AtomicBool::new(false);
static LAST_STATE_ERROR: AtomicBool = AtomicBool::new(false);
static POLL_IN_FLIGHT: AtomicBool = AtomicBool::new(false);

/// Tracks the previous connection state so we only fire notifications on
/// ACTUAL state transitions — not on every 30s poll tick.
use std::sync::Mutex as StdMutex;
static LAST_KNOWN_STATE: StdMutex<Option<String>> = StdMutex::new(None);

pub fn start_status_polling(app: AppHandle) {
    tauri::async_runtime::spawn(async move {
        sleep(Duration::from_millis(500)).await;
        loop {
            if POLL_IN_FLIGHT
                .compare_exchange(false, true, Ordering::SeqCst, Ordering::Relaxed)
                .is_ok()
            {
                if let Some(state) = app.try_state::<AppState>() {
                    let payload = match state.netbird.status().await {
                        Ok(s) => {
                            MISSING_NOTIFIED.store(false, Ordering::Relaxed);
                            LAST_STATE_ERROR.store(false, Ordering::Relaxed);
                            s
                        }
                        Err(AppError::NetbirdMissing) => {
                            MISSING_NOTIFIED.store(true, Ordering::Relaxed);
                            StatusDto::disconnected(false)
                        }
                        Err(e) => {
                            if !LAST_STATE_ERROR.swap(true, Ordering::Relaxed) {
                                let _ = app.emit("netbird-error", e.to_string());
                            }
                            StatusDto::error()
                        }
                    };

                    // Fire a Windows Toast notification on state TRANSITION only.
                    // This gives the user an unobtrusive "VPN verbunden" / "VPN
                    // getrennt" notification like OpenVPN does — but only when the
                    // state actually changes, not on every poll cycle.
                    let new_state = format!("{:?}", payload.state);
                    let mut last = LAST_KNOWN_STATE.lock().unwrap_or_else(|e| e.into_inner());
                    let changed = last.as_ref() != Some(&new_state);
                    if changed {
                        let prev = last.clone();
                        *last = Some(new_state.clone());
                        drop(last); // release lock before async work

                        if prev.is_some() {
                            // Only notify after the FIRST poll (skip the initial transition
                            // from None → whatever, which is just app startup).
                            send_status_notification(&app, &payload);
                        }
                    } else {
                        drop(last);
                    }

                    update_tray_tooltip(&app, &payload);
                    let _ = app.emit("netbird-status-changed", &payload);
                }
                POLL_IN_FLIGHT.store(false, Ordering::Relaxed);
            }
            sleep(Duration::from_secs(30)).await;
        }
    });
}

/// Send a native OS toast notification for VPN state changes. Non-fatal —
/// if notifications are disabled or unavailable, we just log and move on.
fn send_status_notification(app: &AppHandle, status: &StatusDto) {
    let (title, body) = match status.state {
        ConnectionState::Connected => (
            "NKK Secure Access",
            if let Some(ip) = &status.local_ip {
                format!("VPN verbunden — {}", ip)
            } else {
                "VPN verbunden mit dem NKK Netz.".to_string()
            },
        ),
        ConnectionState::Disconnected => (
            "NKK Secure Access",
            "VPN Tunnel getrennt.".to_string(),
        ),
        ConnectionState::Error => (
            "NKK Secure Access",
            "VPN Verbindung gestört — Diagnose prüfen.".to_string(),
        ),
        ConnectionState::Connecting => return, // no notification for transient state
    };

    if let Err(e) = tauri_plugin_notification::NotificationExt::notification(app)
        .builder()
        .title(title)
        .body(&body)
        .show()
    {
        tracing::debug!("Toast Notification fehlgeschlagen: {}", e);
    }
}

fn update_tray_tooltip(app: &AppHandle, status: &StatusDto) {
    if let Some(tray) = app.tray_by_id("main-tray") {
        let label = match status.state {
            ConnectionState::Connected => "NKK Secure Access — Verbunden",
            ConnectionState::Connecting => "NKK Secure Access — Verbinde …",
            ConnectionState::Disconnected => "NKK Secure Access — Getrennt",
            ConnectionState::Error => "NKK Secure Access — Fehler",
        };
        let _ = tray.set_tooltip(Some(label));
    }
}
