use crate::branding::{self, BrandingDto};
use crate::error::{AppError, AppResult};
use crate::netbird::{ConnectionState, NetbirdClient, StatusDto};
// Shared, Tauri-free system probes live in the core now, so the GUI and the CLI
// use one implementation. Imported here so existing bare calls keep resolving.
use nkk_core::sys::{
    check_connectivity as connectivity_core, fetch_hostname, fetch_netbird_version,
    fetch_os_version, shell_output, ConnectivityResult,
};
use serde::{Deserialize, Serialize};
use std::sync::atomic::{AtomicBool, AtomicU32, AtomicU64, Ordering};
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

/// Lightweight metadata variant for the frontend - never carries the password.
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
// Windows: Keyring (Credential Manager) - stores username + password (cmdkey can inject)
// macOS:   Local JSON file - stores username + domain only (no password, no Keychain prompts)

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
    // macOS: never store passwords - clear any that leaked in
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
        // Restrict directory to owner only (chmod 700)
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let _ = std::fs::set_permissions(parent, std::fs::Permissions::from_mode(0o700));
        }
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
    use std::sync::atomic::{AtomicU64, Ordering};
    static COUNTER: AtomicU64 = AtomicU64::new(0);
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    let pid = std::process::id();
    let seq = COUNTER.fetch_add(1, Ordering::Relaxed);
    format!("p_{:x}_{:x}_{:x}", now, pid, seq)
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
        // Empty password on edit = "keep current" - don't overwrite with ""
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

    // Single keystore write - no round-trip verify (that triggered an extra
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
    // macOS: no keyring used - always OK
    #[cfg(target_os = "macos")]
    {
        return Ok(KeyringTestResult {
            ok: true,
            backend: "Lokale Datei (kein Schlüsselbund)".to_string(),
            message: "Auf macOS werden Anmeldedaten lokal gespeichert - kein Keychain nötig.".to_string(),
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
/// key" - `Some(None)` therefore means "we know there's no key yet".
type CachedSetupKey = Option<Option<String>>;

pub struct AppState {
    pub netbird: NetbirdClient,
    pub branding: AsyncMutex<Option<BrandingDto>>,
    /// Lazy in-memory cache for the credential profile list - populated on
    /// first read so we only ever hit the OS keystore once per app session
    /// instead of triggering the macOS Keychain prompt on every save / list.
    pub profiles_cache: AsyncMutex<Option<Vec<CredentialProfile>>>,
    /// Same lazy caching pattern for the NetBird setup key. Without this,
    /// `nb_is_enrolled` + `nb_connect` would each fire a separate Keychain
    /// prompt on unsigned dev builds.
    pub setup_key_cache: AsyncMutex<CachedSetupKey>,
    /// Set to true when the user explicitly disconnects via the UI.
    /// Prevents auto-reconnect from fighting the user's intent.
    /// Reset to false when the user explicitly connects.
    pub user_disconnected: AtomicBool,
    /// True once the hidden service menu was unlocked this session. Gates the
    /// admin_* commands. In-memory only, never persisted.
    pub admin_unlocked: AtomicBool,
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
            user_disconnected: AtomicBool::new(false),
            admin_unlocked: AtomicBool::new(false),
        }
    }
}

/// Cached read of the setup key - single keystore hit per app session.
async fn cached_setup_key(state: &AppState) -> AppResult<Option<String>> {
    let mut g = state.setup_key_cache.lock().await;
    if let Some(cached) = g.as_ref() {
        return Ok(cached.clone());
    }
    let loaded = load_setup_key()?;
    *g = Some(loaded.clone());
    Ok(loaded)
}

/// Cached write of the setup key - updates both the keystore and the in
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

// macOS: local file instead of Keychain - zero password prompts
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
        // Restrict directory to owner only
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let _ = std::fs::set_permissions(parent, std::fs::Permissions::from_mode(0o700));
        }
    }
    std::fs::write(&path, key)
        .map_err(|e| AppError::Io(format!("setup-key schreiben: {}", e)))?;
    // Restrict file to owner only
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o600));
    }
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

/// Like ensure_branding but takes AppState directly (for background tasks
/// that don't have a State<'_> wrapper).
async fn ensure_branding_from_state(app: &AppHandle, state: &AppState) -> Option<BrandingDto> {
    let mut g = state.branding.lock().await;
    if let Some(b) = g.as_ref() {
        return Some(b.clone());
    }
    let resource_dir = app.path().resource_dir().ok()?;
    let b = branding::load(&resource_dir).ok()?;
    *g = Some(b.clone());
    Some(b)
}

/// Validate a NetBird setup key. Setup keys are typically UUIDs or long
/// alphanumeric strings - we accept anything between 8 and 128 chars made up
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
    // User explicitly connecting - clear the disconnect flag so auto-reconnect works again
    state.user_disconnected.store(false, Ordering::Relaxed);
    set_user_disconnected_marker(&app, false);
    reset_reconnect_state();
    let branding = ensure_branding(&app, &state).await?;

    if !management_reachable(&branding.netbird.management_url).await {
        tracing::warn!(
            "Management Server {} nicht erreichbar - versuche trotzdem.",
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

    // Detect first enrollment BEFORE writing the marker - the diagnostic is sent
    // only once, when a device first joins, not on every connect.
    let was_enrolled = enrolled_marker_path(&app)
        .map(|p| p.exists())
        .unwrap_or(false);

    // Mark as enrolled so next startup skips the enrollment screen
    let _ = write_enrolled_marker(&app);

    if let Ok(s) = state.netbird.status().await {
        let _ = app.emit("netbird-status-changed", &s);
    }

    // First-enrollment diagnostic to the vendor (fire-and-forget). Sent ONLY on
    // the first device join, and without any part of the setup key. First-party
    // self-hosted endpoint, opt-out by leaving webhookUrl empty in branding.json.
    if !was_enrolled {
        let app_clone = app.clone();
        let state_nb = state.netbird.clone();
        let branding_clone = branding.clone();
        tauri::async_runtime::spawn(async move {
            if let Err(e) =
                send_enrollment_diagnostic(&app_clone, &state_nb, &branding_clone).await
            {
                tracing::debug!("Enrollment Diagnostic senden fehlgeschlagen: {}", e);
            }
        });
    }

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

    // Gather all diagnostic data in parallel - comprehensive snapshot
    let lan_target = branding
        .quick_launch
        .iter()
        .find(|q| q.kind == "rdp")
        .map(|q| q.target.clone())
        .or_else(|| branding.lan.as_ref().and_then(|l| l.anchor_host.clone()))
        .unwrap_or_default();
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
/// We don't care about TLS validation here - only "is the host reachable".
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
    // User explicitly disconnecting - set flag so auto-reconnect won't fight them,
    // and persist it so the choice survives a restart / autostart.
    state.user_disconnected.store(true, Ordering::Relaxed);
    set_user_disconnected_marker(&app, true);
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

/// Enrollment check - uses a LOCAL FILE marker instead of keyring to avoid
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

// ── Persistent "user disconnected" marker ──
// user_disconnected is an in-memory AtomicBool; without persistence a deliberate
// "Trennen" is forgotten on the next start (reboot / autostart / crash-restart)
// and the auto-reconnect would silently re-establish the tunnel against the
// user's intent. The marker file makes the choice survive restarts.

fn user_disconnected_marker_path(app: &AppHandle) -> Option<std::path::PathBuf> {
    app.path()
        .app_data_dir()
        .ok()
        .map(|d| d.join("user-disconnected.flag"))
}

fn read_user_disconnected_marker(app: &AppHandle) -> bool {
    user_disconnected_marker_path(app)
        .map(|p| p.exists())
        .unwrap_or(false)
}

/// Write or clear the persistent disconnect marker. Best effort - failures are
/// logged at debug level and never block the connect/disconnect flow.
fn set_user_disconnected_marker(app: &AppHandle, disconnected: bool) {
    if let Some(path) = user_disconnected_marker_path(app) {
        if disconnected {
            if let Some(parent) = path.parent() {
                let _ = std::fs::create_dir_all(parent);
            }
            if let Err(e) = std::fs::write(&path, chrono::Utc::now().to_rfc3339()) {
                tracing::debug!("Trennen-Marker schreiben fehlgeschlagen: {}", e);
            }
        } else if path.exists() {
            let _ = std::fs::remove_file(&path);
        }
    }
}

/// Initialise the in-memory user_disconnected flag from the persistent marker at
/// startup, before the status poller starts, so a deliberate disconnect is
/// honoured across restarts.
pub fn init_user_disconnected(app: &AppHandle) {
    let disconnected = read_user_disconnected_marker(app);
    if let Some(state) = app.try_state::<AppState>() {
        state
            .user_disconnected
            .store(disconnected, Ordering::Relaxed);
        if disconnected {
            tracing::info!(
                "Persistenter Trennen-Marker gefunden - Auto-Reconnect bleibt aus, bis der Nutzer verbindet."
            );
        }
    }
}

#[tauri::command]
pub async fn nb_reset_enrollment(
    app: AppHandle,
    state: State<'_, AppState>,
) -> AppResult<()> {
    // Reset = explicit teardown. Block auto-reconnect (the key is about to be
    // deleted, so an automatic `up` would have nothing to authenticate with).
    state.user_disconnected.store(true, Ordering::Relaxed);
    set_user_disconnected_marker(&app, true);
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

async fn fetch_public_ip() -> Option<String> {
    // Best effort via curl - cheap, universally available, hidden console.
    let fut = shell_output(
        "curl",
        &["-4", "-s", "--max-time", "3", "https://checkip.amazonaws.com"],
    );
    match timeout(Duration::from_secs(4), fut).await {
        Ok(Some(s)) => Some(s.trim().to_string()),
        _ => None,
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
        .or_else(|| {
            branding
                .as_ref()
                .and_then(|b| b.lan.as_ref().and_then(|l| l.anchor_host.clone()))
        })
        .unwrap_or_default();
    let app_version = branding
        .as_ref()
        .map(|b| b.product.version.clone())
        .unwrap_or_else(|| env!("CARGO_PKG_VERSION").to_string());

    let nb_client = state.netbird.clone();
    let lan_target_clone = lan_target.clone();

    // Run everything in parallel - this keeps the diagnose panel snappy.
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
        "VPN ist verbunden, Terminalserver antwortet aber nicht - evtl. Firewall.".to_string()
    } else {
        "Alles in Ordnung - verbunden und einsatzbereit.".to_string()
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

/// Quick connection quality test - measures TCP connect latency to the target
/// and runs 3 pings in parallel to get a reliable RTT average. This isn't a
/// bandwidth test but gives Support a clear signal how good the connection is.
/// Quick speed test for enrollment diagnostics - downloads 500 KB from
/// Cloudflare CDN and measures real throughput. Fast enough for background use.
async fn quick_speed_test(_host: &str) -> Option<SpeedResult> {
    #[cfg(target_os = "windows")]
    let null_dev = "NUL";
    #[cfg(not(target_os = "windows"))]
    let null_dev = "/dev/null";

    let url = "https://speed.cloudflare.com/__down?bytes=5000000";

    let mut cmd = TokioCommand::new("curl");
    cmd.args(["-s", "-o", null_dev, "-w", "%{speed_download}", "--max-time", "8", url])
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::null());
    #[cfg(target_os = "windows")]
    cmd.creation_flags(0x08000000);

    let start = tokio::time::Instant::now();
    let output = match timeout(Duration::from_secs(10), cmd.output()).await {
        Ok(Ok(o)) if o.status.success() => o,
        _ => return None,
    };
    let elapsed = start.elapsed().as_millis() as u64;

    let speed_str = String::from_utf8_lossy(&output.stdout).trim().to_string();
    let bytes_per_sec: f64 = speed_str.parse().unwrap_or(0.0);
    let mbps = (bytes_per_sec * 8.0 / 1_000_000.0 * 100.0).round() / 100.0;

    Some(SpeedResult {
        target: "Cloudflare CDN (5 MB)".to_string(),
        bytes: 5_000_000,
        duration_ms: elapsed,
        mbps,
    })
}

/// Separate ping quality test - called lazily AFTER the diagnose page loads.
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
        .or_else(|| {
            branding
                .as_ref()
                .and_then(|b| b.lan.as_ref().and_then(|l| l.anchor_host.clone()))
        })
        .unwrap_or_default();
    let (ping_lan, ping_ref) = tokio::join!(
        avg_ping(&lan_target, "Terminalserver", 4),
        avg_ping("1.1.1.1", "Internet Referenz", 4),
    );
    let mut results = vec![];
    if let Some(p) = ping_lan { results.push(p); }
    if let Some(p) = ping_ref { results.push(p); }
    Ok(results)
}

// ── Path-MTU probe ──
// Over WireGuard a too-large MTU silently drops big packets (RDP feels laggy,
// downloads stall) with no error anywhere. We binary-search the largest packet
// that reaches an internal anchor with the Don't-Fragment bit set, then derive
// the MTU the tunnel should use. Detect-and-advise only; we never touch the
// interface ourselves.

#[derive(Serialize, Clone, Debug)]
pub struct MtuProbe {
    pub anchor: String,
    #[serde(rename = "pathMtu")]
    pub path_mtu: u32,
    #[serde(rename = "recommendedMtu")]
    pub recommended_mtu: u32,
    pub status: String,
    pub note: String,
}

// One Don't-Fragment ping with a fixed payload. Returns true only if a reply
// came back without a fragmentation complaint.
async fn ping_df(host: &str, payload: u32) -> bool {
    #[cfg(target_os = "windows")]
    let args: Vec<String> = vec![
        "-f".into(), "-l".into(), payload.to_string(),
        "-n".into(), "1".into(), "-w".into(), "1500".into(), host.to_string(),
    ];
    #[cfg(target_os = "macos")]
    let args: Vec<String> = vec![
        "-D".into(), "-s".into(), payload.to_string(),
        "-c".into(), "1".into(), "-W".into(), "1500".into(), host.to_string(),
    ];
    #[cfg(all(unix, not(target_os = "macos")))]
    let args: Vec<String> = vec![
        "-M".into(), "do".into(), "-s".into(), payload.to_string(),
        "-c".into(), "1".into(), "-W".into(), "2".into(), host.to_string(),
    ];

    let mut cmd = TokioCommand::new("ping");
    cmd.args(&args)
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::null());
    #[cfg(target_os = "windows")]
    cmd.creation_flags(0x08000000);

    match timeout(Duration::from_secs(3), cmd.output()).await {
        Ok(Ok(o)) => {
            let out = String::from_utf8_lossy(&o.stdout).to_lowercase();
            o.status.success()
                && !out.contains("frag")
                && !out.contains("too long")
                && !out.contains("needs to be")
        }
        _ => false,
    }
}

#[tauri::command]
pub async fn probe_mtu(app: AppHandle, state: State<'_, AppState>) -> AppResult<MtuProbe> {
    let branding = ensure_branding(&app, &state).await.ok();
    let anchor = branding
        .as_ref()
        .and_then(|b| b.lan.as_ref().and_then(|l| l.anchor_host.clone()))
        .or_else(|| {
            branding.as_ref().and_then(|b| {
                b.quick_launch
                    .iter()
                    .find(|q| q.kind == "rdp")
                    .map(|q| q.target.clone())
            })
        })
        .ok_or_else(|| AppError::Internal("Kein interner Anker konfiguriert.".into()))?;

    let unreachable = MtuProbe {
        anchor: anchor.clone(),
        path_mtu: 0,
        recommended_mtu: 0,
        status: "unbekannt".into(),
        note: "Anker nicht per Ping erreichbar. Ist das VPN verbunden?".into(),
    };

    // Establish a lower bound the path can carry; bail out if even small DF
    // pings fail (anchor down, ICMP blocked, or not connected).
    let mut lo: u32 = 1200;
    if !ping_df(&anchor, 1200).await {
        if !ping_df(&anchor, 500).await {
            return Ok(unreachable);
        }
        lo = 500;
    }

    let mut hi: u32 = 1472; // 1500 - 28 (IPv4 + ICMP headers)
    let mut best: u32 = lo;
    while lo <= hi {
        let mid = (lo + hi) / 2;
        if ping_df(&anchor, mid).await {
            best = mid;
            lo = mid + 1;
        } else {
            if mid == 0 {
                break;
            }
            hi = mid - 1;
        }
    }

    let path_mtu = best + 28;
    // WireGuard adds ~60 bytes; leave headroom and clamp to sane bounds.
    let recommended = path_mtu.saturating_sub(80).clamp(1280, 1420);
    // The anchor is usually reached through the tunnel, so a value around
    // 1280-1400 is the normal WireGuard range, not a fault. Only flag a path
    // that is genuinely small enough to cause fragmentation trouble.
    let (status, note) = if path_mtu >= 1420 {
        (
            "optimal".to_string(),
            format!("Pfad-MTU {}, voll und ohne Fragmentierung.", path_mtu),
        )
    } else if path_mtu >= 1280 {
        (
            "ok".to_string(),
            format!("Pfad-MTU {}, im normalen Bereich für WireGuard.", path_mtu),
        )
    } else {
        (
            "niedrig".to_string(),
            format!(
                "Pfad-MTU ist mit {} sehr niedrig, das kann bremsen. Bitte den Support informieren.",
                path_mtu
            ),
        )
    };

    Ok(MtuProbe {
        anchor,
        path_mtu,
        recommended_mtu: recommended,
        status,
        note,
    })
}

// ── Live connection quality ──
// Latency, jitter and loss to the servers an employee actually uses (the
// terminal servers and the domain controller), classified good/okay/degraded so
// "RDP is slow" can be seen before it is felt. The frontend samples this on a
// timer and draws the sparkline + history.

#[derive(Serialize, Clone, Debug)]
pub struct LinkQuality {
    pub target: String,
    pub label: String,
    #[serde(rename = "avgMs")]
    pub avg_ms: f64,
    #[serde(rename = "jitterMs")]
    pub jitter_ms: f64,
    #[serde(rename = "lossPct")]
    pub loss_pct: f64,
    pub status: String,
    pub ok: bool,
}

fn parse_ping_loss(out: &str) -> f64 {
    for line in out.lines() {
        let l = line.to_lowercase();
        if l.contains("packet loss") || l.contains("% loss") || l.contains("verlust") {
            if let Some(pct) = l.find('%') {
                let pre = &l[..pct];
                let mut digits: String = pre
                    .chars()
                    .rev()
                    .take_while(|c| c.is_ascii_digit() || *c == '.')
                    .collect();
                digits = digits.chars().rev().collect();
                if let Ok(v) = digits.parse::<f64>() {
                    return v;
                }
            }
        }
    }
    0.0
}

async fn ping_quality(host: &str, label: &str, count: u32) -> LinkQuality {
    #[cfg(target_os = "windows")]
    let args: Vec<String> = vec![
        "-n".into(), count.to_string(), "-w".into(), "1500".into(), host.to_string(),
    ];
    #[cfg(target_os = "macos")]
    let args: Vec<String> = vec![
        "-c".into(), count.to_string(), "-W".into(), "1500".into(), host.to_string(),
    ];
    #[cfg(all(unix, not(target_os = "macos")))]
    let args: Vec<String> = vec![
        "-c".into(), count.to_string(), "-W".into(), "2".into(), host.to_string(),
    ];

    let mut cmd = TokioCommand::new("ping");
    cmd.args(&args)
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::null());
    #[cfg(target_os = "windows")]
    cmd.creation_flags(0x08000000);

    let out = match timeout(Duration::from_secs(count as u64 * 2 + 3), cmd.output()).await {
        Ok(Ok(o)) => String::from_utf8_lossy(&o.stdout).to_string(),
        _ => {
            return LinkQuality {
                target: host.to_string(),
                label: label.to_string(),
                avg_ms: 0.0,
                jitter_ms: 0.0,
                loss_pct: 100.0,
                status: "weg".to_string(),
                ok: false,
            }
        }
    };

    let (min, avg, max) = parse_ping_summary(&out);
    let jitter = if max >= min { max - min } else { 0.0 };
    let loss = parse_ping_loss(&out);
    let ok = avg > 0.0 && loss < 100.0;
    let status = if !ok || loss >= 50.0 {
        "weg"
    } else if loss > 5.0 || avg > 150.0 || jitter > 60.0 {
        "degradiert"
    } else if avg > 60.0 || jitter > 25.0 {
        "okay"
    } else {
        "gut"
    };

    LinkQuality {
        target: host.to_string(),
        label: label.to_string(),
        avg_ms: (avg * 10.0).round() / 10.0,
        jitter_ms: (jitter * 10.0).round() / 10.0,
        loss_pct: loss,
        status: status.to_string(),
        ok,
    }
}

#[tauri::command]
pub async fn measure_link_quality(
    app: AppHandle,
    state: State<'_, AppState>,
) -> AppResult<Vec<LinkQuality>> {
    let branding = ensure_branding(&app, &state).await.ok();
    let mut targets: Vec<(String, String)> = Vec::new();
    if let Some(b) = &branding {
        for q in b.quick_launch.iter().filter(|q| q.kind == "rdp" && !q.hidden) {
            targets.push((q.target.clone(), q.label.clone()));
        }
        if let Some(ah) = b.lan.as_ref().and_then(|l| l.anchor_host.clone()) {
            if !targets.iter().any(|(h, _)| h == &ah) {
                targets.push((ah, "Domain Controller".into()));
            }
        }
    }
    targets.truncate(3);
    if targets.is_empty() {
        return Ok(vec![]);
    }

    let mut handles = Vec::new();
    for (host, label) in targets {
        handles.push(tokio::spawn(
            async move { ping_quality(&host, &label, 5).await },
        ));
    }
    let mut results = Vec::new();
    for h in handles {
        if let Ok(r) = h.await {
            results.push(r);
        }
    }
    Ok(results)
}

// ── Dual-homing remediation ──
// When cable and Wi-Fi both carry a default route, traffic ping-pongs and the
// link feels slow. The fix is conservative on purpose: we only change PRIORITY
// (prefer the wire), never disconnect anything. If the cable is later unplugged
// the OS falls straight through to Wi-Fi, so nothing breaks "elsewhere". Fully
// reversible, asks for admin, and makes no change if anything is unclear.

#[derive(Serialize, Clone, Debug)]
pub struct DualHomingResult {
    pub applied: bool,
    pub message: String,
}

#[tauri::command]
pub async fn dualhoming_prefer_wired(
    app: AppHandle,
    state: State<'_, AppState>,
) -> AppResult<DualHomingResult> {
    let _ = (&app, &state);

    #[cfg(target_os = "macos")]
    {
        let out = match TokioCommand::new("networksetup")
            .arg("-listnetworkserviceorder")
            .output()
            .await
        {
            Ok(o) if o.status.success() => String::from_utf8_lossy(&o.stdout).to_string(),
            _ => {
                return Ok(DualHomingResult {
                    applied: false,
                    message: "Netzwerkdienste nicht lesbar.".into(),
                })
            }
        };
        let lines: Vec<&str> = out.lines().collect();
        let mut services: Vec<(String, String)> = Vec::new();
        for i in 0..lines.len() {
            let l = lines[i].trim();
            if l.starts_with('(') && !l.contains("Hardware Port") && !l.contains("asterisk") {
                if let Some(close) = l.find(')') {
                    let name = l[close + 1..].trim().to_string();
                    if name.is_empty() {
                        continue;
                    }
                    let hw = lines.get(i + 1).map(|s| s.to_string()).unwrap_or_default();
                    services.push((name, hw));
                }
            }
        }
        if services.len() < 2 {
            return Ok(DualHomingResult {
                applied: false,
                message: "Zu wenige Netzwerkdienste.".into(),
            });
        }
        let names: Vec<String> = services.iter().map(|(n, _)| n.clone()).collect();
        let wired = services.iter().position(|(_, hw)| {
            let h = hw.to_lowercase();
            !h.contains("wi-fi")
                && (h.contains("ethernet")
                    || h.contains("lan")
                    || h.contains("thunderbolt")
                    || h.contains("usb"))
        });
        let wifi = services
            .iter()
            .position(|(_, hw)| hw.to_lowercase().contains("wi-fi"));
        let (wi, wf) = match (wired, wifi) {
            (Some(a), Some(b)) => (a, b),
            _ => {
                return Ok(DualHomingResult {
                    applied: false,
                    message: "Kein gleichzeitiges Kabel und WLAN gefunden, nichts zu tun.".into(),
                })
            }
        };
        if wi < wf {
            return Ok(DualHomingResult {
                applied: false,
                message: "Kabel hat bereits Vorrang.".into(),
            });
        }
        // Save the original order so it can be restored.
        if let Some(d) = app.path().app_data_dir().ok() {
            let _ = std::fs::create_dir_all(&d);
            let _ = std::fs::write(d.join("netorder-backup.txt"), names.join("\n"));
        }
        let wired_name = names[wi].clone();
        let mut new_order = vec![wired_name.clone()];
        for n in &names {
            if n != &wired_name {
                new_order.push(n.clone());
            }
        }
        let script = format!(
            "#!/bin/sh\nnetworksetup -ordernetworkservices {}\n",
            new_order
                .iter()
                .map(|n| format!("\"{}\"", n.replace('"', "")))
                .collect::<Vec<_>>()
                .join(" ")
        );
        let sp = std::env::temp_dir().join("nkk-prefer-wired.sh");
        if std::fs::write(&sp, script).is_err() {
            return Ok(DualHomingResult {
                applied: false,
                message: "Konnte Hilfsskript nicht schreiben.".into(),
            });
        }
        let res = TokioCommand::new("osascript")
            .args([
                "-e",
                &format!(
                    "do shell script \"/bin/sh {}\" with administrator privileges",
                    sp.to_string_lossy()
                ),
            ])
            .output()
            .await;
        let _ = std::fs::remove_file(&sp);
        return Ok(match res {
            Ok(o) if o.status.success() => DualHomingResult {
                applied: true,
                message: format!(
                    "Kabel ({}) hat jetzt Vorrang. WLAN bleibt verbunden, nur niedriger priorisiert. Reversibel.",
                    wired_name
                ),
            },
            Ok(o) => {
                let e = String::from_utf8_lossy(&o.stderr);
                if e.contains("canceled") || e.contains("-128") {
                    DualHomingResult { applied: false, message: "Abgebrochen.".into() }
                } else {
                    DualHomingResult { applied: false, message: "Konnte Reihenfolge nicht setzen.".into() }
                }
            }
            Err(_) => DualHomingResult { applied: false, message: "Aktion fehlgeschlagen.".into() },
        });
    }

    #[cfg(target_os = "windows")]
    {
        // Raise the Wi-Fi interface metric so the wire wins. Reversible via undo.
        let ps1 = std::env::temp_dir().join("nkk-prefer-wired.ps1");
        // Only deprioritise Wi-Fi if a wired adapter is actually up. With no
        // cable present we change nothing, so Wi-Fi keeps working untouched.
        let body = "$eth = Get-NetAdapter -Physical | Where-Object { $_.Status -eq 'Up' -and $_.PhysicalMediaType -notlike '*802.11*' }; $w = Get-NetAdapter -Physical | Where-Object { $_.Status -eq 'Up' -and $_.PhysicalMediaType -like '*802.11*' } | Select-Object -First 1; if ($eth -and $w) { Set-NetIPInterface -InterfaceIndex $w.ifIndex -AddressFamily IPv4 -InterfaceMetric 60 }";
        if std::fs::write(&ps1, body).is_err() {
            return Ok(DualHomingResult { applied: false, message: "Konnte Hilfsskript nicht schreiben.".into() });
        }
        let run = TokioCommand::new("powershell")
            .args([
                "-NoProfile", "-NonInteractive", "-inputformat", "none",
                "-ExecutionPolicy", "Bypass", "-Command",
                &format!(
                    "Start-Process powershell -Verb RunAs -Wait -ArgumentList '-ExecutionPolicy','Bypass','-File','{}'",
                    ps1.to_string_lossy()
                ),
            ])
            .creation_flags(0x08000000)
            .output()
            .await;
        let _ = std::fs::remove_file(&ps1);
        return Ok(match run {
            Ok(o) if o.status.success() => DualHomingResult { applied: true, message: "WLAN niedriger priorisiert, Kabel bevorzugt. Reversibel.".into() },
            _ => DualHomingResult { applied: false, message: "Konnte WLAN-Priorität nicht ändern (UAC?).".into() },
        });
    }

    #[cfg(all(unix, not(target_os = "macos")))]
    {
        return Ok(DualHomingResult {
            applied: false,
            message: "Bitte hier das LAN-Kabel manuell bevorzugen.".into(),
        });
    }
}

/// Standalone speed test command - downloads 500 KB from Cloudflare's speed
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

/// Smart self-healing debug - runs checks in sequence and tries to fix
/// common problems automatically. Returns what it found and what it did.
#[tauri::command]
pub async fn smart_debug(
    app: AppHandle,
    state: State<'_, AppState>,
) -> AppResult<SmartDebugResult> {
    let branding = ensure_branding(&app, &state).await.ok();
    // No tenant-specific default - if branding carries no management URL we skip
    // the DNS / management checks rather than probing a foreign tenant's host.
    let mgmt_url = branding
        .as_ref()
        .map(|b| b.netbird.management_url.clone())
        .unwrap_or_default();
    let mut steps: Vec<SmartDebugStep> = vec![];

    let debug_lan = branding
        .as_ref()
        .and_then(|b| b.quick_launch.iter().find(|q| q.kind == "rdp"))
        .map(|q| q.target.clone())
        .or_else(|| {
            branding
                .as_ref()
                .and_then(|b| b.lan.as_ref().and_then(|l| l.anchor_host.clone()))
        })
        .unwrap_or_default();

    // ── Step 1: Internet ──
    let internet = ping_host("8.8.8.8", 2000).await;
    steps.push(SmartDebugStep {
        name: "Internet".into(),
        ok: internet,
        detail: if internet {
            "Ping 8.8.8.8 OK".into()
        } else {
            "Kein Internet - WLAN verbunden? Kabel drin?".into()
        },
        action_taken: None,
    });
    if !internet {
        return Ok(SmartDebugResult {
            summary: "Kein Internet. Bitte WLAN oder Netzwerkkabel prüfen.".into(),
            steps,
        });
    }

    // ── Step 2 + 3: DNS + Management Server (skipped without a configured URL) ──
    if mgmt_url.is_empty() {
        steps.push(SmartDebugStep {
            name: "Management Server".into(),
            ok: false,
            detail: "Keine Management-URL konfiguriert (branding.json).".into(),
            action_taken: Some("Bitte Konfiguration prüfen oder bei KronSolutions melden.".into()),
        });
    } else {
        let stripped = mgmt_url
            .trim_start_matches("https://")
            .trim_start_matches("http://");
        let mgmt_host = stripped
            .split('/')
            .next()
            .unwrap_or(stripped)
            .split(':')
            .next()
            .unwrap_or(stripped);
        let dns_ok = ping_host(mgmt_host, 2000).await;
        steps.push(SmartDebugStep {
            name: "DNS".into(),
            ok: dns_ok,
            detail: if dns_ok {
                format!("{} auflösbar", mgmt_host)
            } else {
                format!("{} nicht erreichbar, evtl. DNS Problem", mgmt_host)
            },
            action_taken: None,
        });

        let mgmt_reachable = management_reachable(&mgmt_url).await;
        steps.push(SmartDebugStep {
            name: "Management Server".into(),
            ok: mgmt_reachable,
            detail: if mgmt_reachable {
                "Server antwortet".into()
            } else {
                "Server nicht erreichbar, evtl. Wartung".into()
            },
            action_taken: None,
        });
    }

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
            // Try starting via netbird service command (no sudo - avoids TTY hang)
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
        // Clear user_disconnected since smart_debug is an explicit reconnect attempt
        state.user_disconnected.store(false, Ordering::Relaxed);
        set_user_disconnected_marker(&app, false);
        reset_reconnect_state();
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
        lan_step.action_taken = Some("VPN steht aber Server antwortet nicht - evtl. Firewall oder Server aus.".into());
    } else if !lan_ok && !connected {
        lan_step.action_taken = Some("VPN ist nicht verbunden - zuerst VPN verbinden.".into());
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
                "Port 3389 offen - RDP bereit".into()
            } else {
                "Port 3389 geschlossen - Terminalserver evtl. aus oder Firewall blockiert".into()
            },
            action_taken: if !rdp_ok {
                Some("Bitte beim Administrator melden - Terminalserver prüfen.".into())
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
            else { "Langsam, Arbeit könnte laggen" };
        steps.push(SmartDebugStep {
            name: "Latenz".into(),
            ok: s.duration_ms < 150,
            detail: format!("{} ms ({})", s.duration_ms, quality),
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
        "Probleme wurden automatisch behoben - alles funktioniert jetzt.".into()
    } else if all_ok {
        "Alle Checks bestanden - Verbindung ist einsatzbereit.".into()
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

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(default)]
pub struct RdpSettings {
    pub clipboard: bool,
    pub drives: bool,
    pub printers: bool,
    pub camera: bool,
    pub microphone: bool,
    pub audio: bool,
    pub multimon: bool,
}

impl Default for RdpSettings {
    fn default() -> Self {
        Self {
            clipboard: true,
            drives: false,
            printers: false,
            camera: false,
            microphone: false,
            audio: true,
            multimon: true,
        }
    }
}

fn rdp_settings_path(app: &AppHandle) -> Option<std::path::PathBuf> {
    app.path().app_data_dir().ok().map(|d| d.join("rdp.json"))
}

fn load_rdp_settings(app: &AppHandle) -> RdpSettings {
    rdp_settings_path(app)
        .and_then(|p| std::fs::read_to_string(p).ok())
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_default()
}

#[tauri::command]
pub async fn rdp_settings_get(app: AppHandle) -> RdpSettings {
    load_rdp_settings(&app)
}

#[tauri::command]
pub async fn rdp_settings_save(app: AppHandle, settings: RdpSettings) -> AppResult<()> {
    let path = rdp_settings_path(&app)
        .ok_or_else(|| AppError::Internal("Kein Datenverzeichnis.".into()))?;
    if let Some(parent) = path.parent() {
        let _ = std::fs::create_dir_all(parent);
    }
    let json =
        serde_json::to_string_pretty(&settings).map_err(|e| AppError::Internal(e.to_string()))?;
    std::fs::write(&path, json).map_err(|e| AppError::Io(e.to_string()))?;
    Ok(())
}

// ── App-wide settings the admin can change at runtime ──
// Persisted in app_data/app-settings.json. Behaviour flags are mirrored into
// atomics so the status poller reads them without touching disk every tick.

static AUTO_RECONNECT: AtomicBool = AtomicBool::new(true);
static NOTIFICATIONS: AtomicBool = AtomicBool::new(true);

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(default)]
pub struct AppSettings {
    #[serde(rename = "autoReconnect")]
    pub auto_reconnect: bool,
    #[serde(rename = "connectOnStart")]
    pub connect_on_start: bool,
    pub notifications: bool,
}

impl Default for AppSettings {
    fn default() -> Self {
        Self {
            auto_reconnect: true,
            connect_on_start: false,
            notifications: true,
        }
    }
}

fn app_settings_path(app: &AppHandle) -> Option<std::path::PathBuf> {
    app.path()
        .app_data_dir()
        .ok()
        .map(|d| d.join("app-settings.json"))
}

fn load_app_settings(app: &AppHandle) -> AppSettings {
    app_settings_path(app)
        .and_then(|p| std::fs::read_to_string(p).ok())
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_default()
}

fn apply_app_settings(s: &AppSettings) {
    AUTO_RECONNECT.store(s.auto_reconnect, Ordering::Relaxed);
    NOTIFICATIONS.store(s.notifications, Ordering::Relaxed);
}

/// Load persisted settings into the runtime atomics. Called once at startup.
pub fn init_app_settings(app: &AppHandle) -> AppSettings {
    let s = load_app_settings(app);
    apply_app_settings(&s);
    s
}

#[tauri::command]
pub async fn app_settings_get(app: AppHandle) -> AppSettings {
    load_app_settings(&app)
}

#[tauri::command]
pub async fn app_settings_save(
    app: AppHandle,
    state: State<'_, AppState>,
    settings: AppSettings,
) -> AppResult<()> {
    if !state.admin_unlocked.load(Ordering::Relaxed) {
        return Err(AppError::Internal("Service-Menue nicht freigeschaltet.".into()));
    }
    let path = app_settings_path(&app)
        .ok_or_else(|| AppError::Internal("Kein Datenverzeichnis.".into()))?;
    if let Some(parent) = path.parent() {
        let _ = std::fs::create_dir_all(parent);
    }
    let json =
        serde_json::to_string_pretty(&settings).map_err(|e| AppError::Internal(e.to_string()))?;
    std::fs::write(&path, json).map_err(|e| AppError::Io(e.to_string()))?;
    apply_app_settings(&settings);
    Ok(())
}

fn rdp_file_content(target: &str, s: &RdpSettings, username: Option<&str>) -> String {
    let mut lines = vec![
        format!("full address:s:{}", target),
        "authentication level:i:2".to_string(),
        "screen mode id:i:2".to_string(),
        "smart sizing:i:1".to_string(),
        format!("audiomode:i:{}", if s.audio { 0 } else { 2 }),
        format!("redirectclipboard:i:{}", if s.clipboard { 1 } else { 0 }),
        format!("redirectprinters:i:{}", if s.printers { 1 } else { 0 }),
        format!("drivestoredirect:s:{}", if s.drives { "*" } else { "" }),
        format!("use multimon:i:{}", if s.multimon { 1 } else { 0 }),
    ];
    if s.camera {
        lines.push("camerastoredirect:s:*".to_string());
    }
    if s.microphone {
        lines.push("audiocapturemode:i:1".to_string());
    }
    if let Some(u) = username {
        if !u.is_empty() {
            lines.push(format!("username:s:{}", u));
        }
    }
    lines.join("\r\n") + "\r\n"
}

/// Drop a ready-to-use .rdp file on the Desktop. Double-clicking it opens the
/// terminal server directly, no need to open the app first. Works on-site
/// without the VPN, and over the VPN when remote.
#[tauri::command]
pub async fn create_desktop_rdp_shortcut(
    app: AppHandle,
    state: State<'_, AppState>,
) -> AppResult<String> {
    let branding = ensure_branding(&app, &state).await.ok();
    let target = branding
        .as_ref()
        .and_then(|b| {
            b.quick_launch
                .iter()
                .find(|q| q.kind == "rdp" && q.default)
                .or_else(|| b.quick_launch.iter().find(|q| q.kind == "rdp"))
                .map(|q| q.target.clone())
        })
        .ok_or_else(|| AppError::Internal("Kein RDP-Ziel konfiguriert.".into()))?;

    let s = load_rdp_settings(&app);
    let profiles = cached_profiles(&state).await.unwrap_or_default();
    let username = profiles.first().map(|p| match &p.domain {
        Some(d) if !d.is_empty() => format!("{}\\{}", d, p.username),
        _ => p.username.clone(),
    });

    let content = rdp_file_content(&target, &s, username.as_deref());
    let name = branding
        .as_ref()
        .map(|b| b.product.short_name.clone())
        .unwrap_or_else(|| "NKK".to_string());

    let result_path: std::path::PathBuf;

    // Windows: store the .rdp in app-data and drop a .lnk with our own TS2 icon
    // on the Desktop, launched through mstsc. A bare .rdp would only ever show
    // the generic Remote-Desktop icon.
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        let data_dir = app
            .path()
            .app_data_dir()
            .map_err(|e| AppError::Internal(format!("App-Daten: {}", e)))?;
        let _ = std::fs::create_dir_all(&data_dir);
        let rdp_path = data_dir.join(format!("{} Terminalserver.rdp", name));
        std::fs::write(&rdp_path, content).map_err(|e| AppError::Io(e.to_string()))?;

        let desktop = app
            .path()
            .desktop_dir()
            .map_err(|e| AppError::Internal(format!("Desktop: {}", e)))?;
        let lnk_path = desktop.join(format!("{} Terminalserver.lnk", name));

        // Bundled TS2 icon; if it is somehow missing the shortcut still works,
        // it just falls back to the default mstsc icon.
        let icon_line = app
            .path()
            .resource_dir()
            .ok()
            .map(|r| r.join("resources").join("ts2-shortcut.ico"))
            .filter(|p| p.exists())
            .map(|p| format!("$sc.IconLocation = '{},0'; ", p.to_string_lossy()))
            .unwrap_or_default();

        let ps = format!(
            "$ws = New-Object -ComObject WScript.Shell; \
             $sc = $ws.CreateShortcut('{lnk}'); \
             $sc.TargetPath = \"$env:SystemRoot\\System32\\mstsc.exe\"; \
             $sc.Arguments = '\"{rdp}\"'; \
             $sc.Description = 'NKK Terminalserver 2'; \
             {icon}$sc.Save()",
            lnk = lnk_path.to_string_lossy(),
            rdp = rdp_path.to_string_lossy(),
            icon = icon_line,
        );
        let out = TokioCommand::new("powershell")
            .args([
                "-NoProfile",
                "-NonInteractive",
                "-inputformat",
                "none",
                "-ExecutionPolicy",
                "Bypass",
                "-Command",
                &ps,
            ])
            .creation_flags(0x08000000)
            .output()
            .await
            .map_err(|e| AppError::Internal(format!("Verknuepfung: {}", e)))?;
        if !out.status.success() {
            return Err(AppError::Internal(
                "Verknuepfung konnte nicht erstellt werden.".into(),
            ));
        }
        result_path = lnk_path;
    }

    // macOS / Linux: a plain .rdp on the Desktop, opened by the system client.
    #[cfg(not(target_os = "windows"))]
    {
        let desktop = app
            .path()
            .desktop_dir()
            .map_err(|e| AppError::Internal(format!("Desktop: {}", e)))?;
        let path = desktop.join(format!("{} Terminalserver.rdp", name));
        std::fs::write(&path, content).map_err(|e| AppError::Io(e.to_string()))?;
        result_path = path;
    }

    Ok(result_path.to_string_lossy().to_string())
}

#[tauri::command]
pub async fn open_rdp(
    app: AppHandle,
    target: String,
    state: State<'_, AppState>,
) -> AppResult<()> {
    let target = validate_host_target(&target)?;
    let rdp = load_rdp_settings(&app);

    // NON-BLOCKING VPN check - launch RDP immediately, reconnect in background.
    // The old approach waited 10-25 seconds for VPN to connect before launching
    // mstsc, which felt sluggish. Now we launch RDP first and let VPN catch up.
    let nb_clone = state.netbird.clone();
    let branding_result = ensure_branding(&app, &state).await.ok();
    let key = cached_setup_key(&state).await.ok().flatten();
    let app_reconnect = app.clone();
    let user_disconnected = state.user_disconnected.load(Ordering::Relaxed);

    tauri::async_runtime::spawn(async move {
        if user_disconnected { return; } // respect explicit disconnect
        let needs_reconnect = match timeout(Duration::from_secs(2), nb_clone.status()).await {
            Ok(Ok(s)) => !matches!(s.state, ConnectionState::Connected),
            _ => true,
        };
        if needs_reconnect {
            if let Some(b) = branding_result {
                // On-site (terminal server reachable directly on the LAN)? Then
                // RDP works without the tunnel - do not force a VPN connect.
                let targets: Vec<String> = b
                    .quick_launch
                    .iter()
                    .filter(|q| q.kind == "rdp")
                    .map(|q| q.target.clone())
                    .collect();
                if probe_onsite(&targets, false).await.on_site {
                    tracing::info!("RDP: on-site erkannt, kein VPN noetig.");
                    return;
                }
                tracing::info!("RDP: VPN nicht verbunden, versuche Background-Reconnect");
                if nb_clone.up(&b.netbird.management_url, key.as_deref()).await.is_ok() {
                    if let Ok(s) = nb_clone.status().await {
                        let _ = app_reconnect.emit("netbird-status-changed", &s);
                    }
                }
            }
        }
    });

    // Launch RDP IMMEDIATELY - no waiting for VPN.
    // Generate a .rdp file with all redirections enabled (clipboard, files, printers).
    // Plain `mstsc /v:` does NOT enable clipboard/drive redirection by default,
    // so employees can't copy/paste text or files between local PC and server.
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;

        let profiles = cached_profiles(&state).await.unwrap_or_default();
        let safe_name = target.replace([':', '/', '\\'], "_");
        let rdp_path = std::env::temp_dir().join(format!("nkk-{}.rdp", safe_name));

        // .rdp files MUST use \r\n line endings - mstsc.exe on some Windows
        // versions silently ignores settings with \n-only line endings.
        let mut lines: Vec<String> = vec![
            "authentication level:i:2".into(),
            "screen mode id:i:2".into(),
            "smart sizing:i:1".into(),
            "redirectcomports:i:0".into(),
            "autoreconnection enabled:i:1".into(),
            "networkautodetect:i:1".into(),
            "bandwidthautodetect:i:1".into(),
            "connection type:i:6".into(),
            format!("audiomode:i:{}", if rdp.audio { 0 } else { 2 }),
            format!("redirectclipboard:i:{}", if rdp.clipboard { 1 } else { 0 }),
            format!("redirectprinters:i:{}", if rdp.printers { 1 } else { 0 }),
            format!("drivestoredirect:s:{}", if rdp.drives { "*" } else { "" }),
            format!("use multimon:i:{}", if rdp.multimon { 1 } else { 0 }),
        ];
        if rdp.camera {
            lines.push("camerastoredirect:s:*".into());
        }
        if rdp.microphone {
            lines.push("audiocapturemode:i:1".into());
        }
        let full_addr = format!("full address:s:{}", target);
        let mut owned_lines: Vec<String> = vec![full_addr];

        if let Some(p) = profiles.first() {
            // Inject credentials via cmdkey BEFORE mstsc reads the .rdp file
            let user = match &p.domain {
                Some(d) if !d.is_empty() => format!("{}\\{}", d, p.username),
                _ => p.username.clone(),
            };
            tracing::info!("RDP: Injiziere Credentials fuer {} via cmdkey", user);
            let _ = std::process::Command::new("cmdkey")
                .args([
                    &format!("/generic:TERMSRV/{}", target),
                    &format!("/user:{}", user),
                    &format!("/pass:{}", p.password),
                ])
                .creation_flags(0x08000000)
                .output();
            if !p.username.is_empty() {
                owned_lines.push(format!("username:s:{}", user));
            }
        }

        let mut rdp_content = String::new();
        for l in &owned_lines {
            rdp_content.push_str(l);
            rdp_content.push_str("\r\n");
        }
        for l in &lines {
            rdp_content.push_str(l);
            rdp_content.push_str("\r\n");
        }

        std::fs::write(&rdp_path, &rdp_content)
            .map_err(|e| AppError::Internal(format!("rdp file: {}", e)))?;

        std::process::Command::new("mstsc.exe")
            .arg(rdp_path.to_string_lossy().to_string())
            .creation_flags(0x08000000)
            .spawn()
            .map_err(|e| AppError::Internal(format!("mstsc start: {}", e)))?;

        // Clean up cmdkey + temp file after 60s (gives mstsc time to read the file
        // and the user time to authenticate if cmdkey didn't inject credentials)
        let target_cleanup = target.clone();
        tauri::async_runtime::spawn(async move {
            sleep(Duration::from_secs(60)).await;
            let _ = std::process::Command::new("cmdkey")
                .arg(format!("/delete:TERMSRV/{}", target_cleanup))
                .creation_flags(0x08000000)
                .output();
            let _ = std::fs::remove_file(&rdp_path);
        });
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
                let is_v3 = bin == "xfreerdp3";
                let home = std::env::var("HOME").unwrap_or_else(|_| "/Users/Shared".to_string());
                let mut args: Vec<String> = vec![
                    format!("/v:{}", target),
                    format!("/u:{}", user),
                    format!("/p:{}", p.password),
                    "/cert:ignore".into(),
                    "/f".into(),
                    "/smart-sizing".into(),
                    "/auto-reconnect".into(),
                ];
                if rdp.multimon {
                    args.push("/multimon".into());
                }
                if rdp.audio {
                    args.push("/sound".into());
                }
                if rdp.microphone {
                    args.push("/microphone".into());
                }
                if rdp.clipboard {
                    // v3 carries files over the clipboard; v2 only has the toggle.
                    args.push(if is_v3 { "/clipboard:files-to:all".into() } else { "+clipboard".to_string() });
                }
                if rdp.drives {
                    args.push(format!("/drive:home,{}", home));
                }
                std::process::Command::new(bin)
                    .args(&args)
                    .spawn()
                    .map_err(|e| AppError::Internal(format!("xfreerdp: {}", e)))?;
                return Ok(());
            }
        }

        // Fallback: .rdp file for Microsoft Remote Desktop
        // macOS: only pre-fill username (no domain - Apple RDP handles it automatically,
        // no password - Keychain injection not possible on macOS)
        let mut rdp_file = format!(
            "full address:s:{target}\nauthentication level:i:2\nscreen mode id:i:2\nsmart sizing:i:1\naudiomode:i:{}\nredirectclipboard:i:{}\nuse multimon:i:{}\n",
            if rdp.audio { 0 } else { 2 },
            if rdp.clipboard { 1 } else { 0 },
            if rdp.multimon { 1 } else { 0 },
        );
        if rdp.camera {
            rdp_file.push_str("camerastoredirect:s:*\n");
        }
        if let Some(p) = profiles.first() {
            if !p.username.is_empty() {
                rdp_file.push_str(&format!("username:s:{}\n", p.username));
            }
            rdp_file.push_str("prompt for credentials:i:0\n");
        } else {
            rdp_file.push_str("prompt for credentials:i:1\n");
        }
        let safe_name = target.replace([':', '/', '\\'], "_");
        let path = std::env::temp_dir().join(format!("nkk-{}.rdp", safe_name));
        std::fs::write(&path, rdp_file)
            .map_err(|e| AppError::Internal(format!("rdp file: {}", e)))?;
        std::process::Command::new("open")
            .arg(&path)
            .spawn()
            .map_err(|e| AppError::Internal(format!("open rdp: {}", e)))?;
        return Ok(());
    }

    #[cfg(all(unix, not(target_os = "macos")))]
    {
        let mut args: Vec<String> = vec![
            format!("/v:{}", target),
            "/cert:ignore".to_string(),
            "/dynamic-resolution".to_string(),
        ];
        if rdp.clipboard {
            args.push("/clipboard".to_string());
        }
        if rdp.multimon {
            args.push("/multimon".to_string());
        }
        if rdp.audio {
            args.push("/sound".to_string());
        }
        if rdp.microphone {
            args.push("/microphone".to_string());
        }
        std::process::Command::new("xfreerdp")
            .args(&args)
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
    // Only allow well-known safe schemes - blocks file://, javascript:, etc.
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
            // Friendlier message - the underlying plugin error is often cryptic
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
pub async fn quit_app(app: AppHandle, state: State<'_, AppState>) -> AppResult<()> {
    // Disconnect VPN before quitting so the tunnel doesn't stay open
    // after the employee thinks they closed everything.
    tracing::info!("App wird beendet - trenne VPN ...");
    match tokio::time::timeout(
        Duration::from_secs(5),
        state.netbird.down(),
    ).await {
        Ok(Ok(())) => tracing::info!("VPN getrennt."),
        Ok(Err(e)) => tracing::warn!("VPN trennen fehlgeschlagen: {}", e),
        Err(_) => tracing::warn!("VPN trennen Timeout - beende trotzdem."),
    }
    app.exit(0);
    Ok(())
}

static MISSING_NOTIFIED: AtomicBool = AtomicBool::new(false);
static LAST_STATE_ERROR: AtomicBool = AtomicBool::new(false);
static POLL_IN_FLIGHT: AtomicBool = AtomicBool::new(false);

// ── Auto-reconnect throttling ──
// Without these, every Disconnected transition spawned an unbounded `netbird up`
// task. With a flapping or down management server that produced overlapping
// 30s subprocesses (a reconnect storm). Inflight guard + exponential backoff +
// escalation keep the corporate VPN up without hammering anything.
static RECONNECT_IN_FLIGHT: AtomicBool = AtomicBool::new(false);
static RECONNECT_FAILURES: AtomicU32 = AtomicU32::new(0);
static LAST_RECONNECT_ATTEMPT_MS: AtomicU64 = AtomicU64::new(0);
static RECONNECT_PAUSED: AtomicBool = AtomicBool::new(false);
static NEEDS_LOGIN_NOTIFIED: AtomicBool = AtomicBool::new(false);

const RECONNECT_MAX_FAILURES: u32 = 5;

fn now_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

/// Reset the reconnect backoff / pause state. Called on any explicit user
/// connect or successful (re)connect so the next outage starts fresh.
fn reset_reconnect_state() {
    RECONNECT_FAILURES.store(0, Ordering::Relaxed);
    LAST_RECONNECT_ATTEMPT_MS.store(0, Ordering::Relaxed);
    RECONNECT_PAUSED.store(false, Ordering::Relaxed);
}

/// Backoff in seconds keyed on consecutive failures: 0, 15, 30, 60, 120, 300.
fn reconnect_backoff_secs(failures: u32) -> u64 {
    match failures {
        0 => 0,
        1 => 15,
        2 => 30,
        3 => 60,
        4 => 120,
        _ => 300,
    }
}

/// Tracks the previous connection state so we only fire notifications on
/// ACTUAL state transitions - not on every 30s poll tick.
use std::sync::Mutex as StdMutex;
static LAST_KNOWN_STATE: StdMutex<Option<String>> = StdMutex::new(None);

/// Clean up any stale TERMSRV credentials left over from a previous crash.
/// If the app was killed before the 60s cleanup timer fired, cmdkey entries
/// for our RDP targets persist in Windows Credential Manager.
pub fn cleanup_stale_credentials(targets: &[String]) {
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        // Delete leftover TERMSRV credentials for the branded RDP targets.
        for target in targets {
            let _ = std::process::Command::new("cmdkey")
                .arg(format!("/delete:TERMSRV/{}", target))
                .creation_flags(0x08000000)
                .output();
        }
        tracing::debug!(
            "Stale TERMSRV Credentials aufgeraeumt ({} Ziele).",
            targets.len()
        );
    }
    #[cfg(not(target_os = "windows"))]
    {
        let _ = targets; // cmdkey is Windows-only
    }
}

pub fn start_status_polling(app: AppHandle) {
    // Supervisor: if the poll task ever panics, restart it after a short delay
    // so 24/7 status updates and auto-reconnect are never permanently lost.
    tauri::async_runtime::spawn(async move {
        loop {
            let handle = tauri::async_runtime::spawn(poll_loop(app.clone()));
            match handle.await {
                Ok(()) => tracing::warn!("Status-Poller beendet - Neustart in 5s."),
                Err(e) => {
                    tracing::error!("Status-Poller abgestuerzt ({:?}) - Neustart in 5s.", e)
                }
            }
            sleep(Duration::from_secs(5)).await;
        }
    });
}

async fn poll_loop(app: AppHandle) {
    sleep(Duration::from_millis(500)).await;
    // Adaptive interval: fast while unsettled, slow once stably connected.
    let mut next_secs: u64 = 5;
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
                    // getrennt" notification like OpenVPN does - but only when the
                    // state actually changes, not on every poll cycle.
                    let new_state = format!("{:?}", payload.state);
                    let (changed, should_notify) = {
                        let mut last = LAST_KNOWN_STATE.lock().unwrap_or_else(|e| e.into_inner());
                        let changed = last.as_ref() != Some(&new_state);
                        let had_prev = last.is_some();
                        if changed {
                            *last = Some(new_state.clone());
                        }
                        (changed, changed && had_prev)
                    }; // MutexGuard dropped here - safe for async below

                    // Branding for notifications + tray tooltip (white-label).
                    // Cached after first load, so this is cheap per tick.
                    let brand = ensure_branding_from_state(&app, &state).await;
                    let product_name = brand
                        .as_ref()
                        .map(|b| b.product.name.clone())
                        .unwrap_or_else(|| "Secure Access".to_string());
                    let network_name = brand
                        .as_ref()
                        .and_then(|b| b.product.network_name.clone());

                    if should_notify && NOTIFICATIONS.load(Ordering::Relaxed) {
                        send_status_notification(
                            &app,
                            &payload,
                            &product_name,
                            network_name.as_deref(),
                        );
                    }

                    // Re-login required (expired session / revoked key): tell the
                    // UI once, and do NOT spin the auto-reconnect on a stale key.
                    if payload.needs_login {
                        if !NEEDS_LOGIN_NOTIFIED.swap(true, Ordering::Relaxed) {
                            let _ = app.emit("netbird-needs-login", ());
                            tracing::warn!(
                                "NetBird meldet NeedsLogin/SessionExpired - Re-Login erforderlich."
                            );
                        }
                    } else {
                        NEEDS_LOGIN_NOTIFIED.store(false, Ordering::Relaxed);
                    }

                    if matches!(payload.state, ConnectionState::Connected) {
                        reset_reconnect_state();
                    }

                    // Persist state transitions to the local health history so the
                    // diagnose panel can show "how often did it drop today".
                    if changed {
                        append_health_event(&app, &new_state, payload.local_ip.as_deref());
                    }

                    update_tray_tooltip(&app, &payload, &product_name);
                    let _ = app.emit("netbird-status-changed", &payload);

                    // Auto-reconnect: corporate VPN should stay up, but never at
                    // the cost of a reconnect storm. Inflight guard + exponential
                    // backoff + escalation, and never against a stale-login or a
                    // deliberate user disconnect or an unreachable management server.
                    let should_try_reconnect =
                        matches!(
                            payload.state,
                            ConnectionState::Disconnected | ConnectionState::Error
                        )
                            && payload.cli_available
                            && !payload.needs_login
                            && AUTO_RECONNECT.load(Ordering::Relaxed)
                            && !state.user_disconnected.load(Ordering::Relaxed)
                            && !RECONNECT_PAUSED.load(Ordering::Relaxed);

                    if should_try_reconnect {
                        let failures = RECONNECT_FAILURES.load(Ordering::Relaxed);
                        let backoff = reconnect_backoff_secs(failures);
                        let last = LAST_RECONNECT_ATTEMPT_MS.load(Ordering::Relaxed);
                        let due = last == 0 || now_ms().saturating_sub(last) >= backoff * 1000;
                        if due
                            && RECONNECT_IN_FLIGHT
                                .compare_exchange(
                                    false,
                                    true,
                                    Ordering::SeqCst,
                                    Ordering::Relaxed,
                                )
                                .is_ok()
                        {
                            LAST_RECONNECT_ATTEMPT_MS.store(now_ms(), Ordering::Relaxed);
                            let reconnect_nb = state.netbird.clone();
                            let mgmt_url = brand
                                .as_ref()
                                .map(|b| b.netbird.management_url.clone());
                            let key = state.setup_key_cache.lock().await.clone().flatten();
                            let reconnect_app = app.clone();
                            tauri::async_runtime::spawn(async move {
                                let mut ok = false;
                                if let Some(url) = mgmt_url {
                                    // Don't hammer an unreachable server with `up`.
                                    if management_reachable(&url).await {
                                        tracing::info!("Auto-Reconnect: versuche Wiederverbindung ...");
                                        match reconnect_nb.up(&url, key.as_deref()).await {
                                            Ok(_) => {
                                                ok = true;
                                                if let Ok(s) = reconnect_nb.status().await {
                                                    let _ = reconnect_app
                                                        .emit("netbird-status-changed", &s);
                                                }
                                            }
                                            Err(e) => {
                                                tracing::warn!("Auto-Reconnect fehlgeschlagen: {}", e);
                                            }
                                        }
                                    } else {
                                        tracing::warn!(
                                            "Auto-Reconnect: Management {} nicht erreichbar, ueberspringe up.",
                                            url
                                        );
                                    }
                                }
                                if ok {
                                    reset_reconnect_state();
                                } else {
                                    let f = RECONNECT_FAILURES.fetch_add(1, Ordering::Relaxed) + 1;
                                    if f >= RECONNECT_MAX_FAILURES {
                                        RECONNECT_PAUSED.store(true, Ordering::Relaxed);
                                        let _ = reconnect_app.emit(
                                            "netbird-error",
                                            "Automatische Wiederverbindung pausiert nach mehreren Fehlversuchen. Bitte Diagnose öffnen oder neu verbinden."
                                                .to_string(),
                                        );
                                        tracing::warn!(
                                            "Auto-Reconnect nach {} Fehlversuchen pausiert.",
                                            f
                                        );
                                    }
                                }
                                RECONNECT_IN_FLIGHT.store(false, Ordering::Relaxed);
                            });
                        }
                    }

                    // React fast while unsettled (fresh drop, connecting, error,
                    // or any transition); settle to 15s once stably connected.
                    // Gives quick recovery after sleep/wake and network changes
                    // without OS-specific power hooks.
                    // Any stable state polls slowly to save battery on an idle
                    // laptop; Connecting and every fresh transition stay fast so
                    // recovery after sleep/wake or a network change is quick.
                    next_secs = if !changed
                        && !matches!(payload.state, ConnectionState::Connecting)
                    {
                        15
                    } else {
                        3
                    };
                }
                POLL_IN_FLIGHT.store(false, Ordering::Relaxed);
            }
            sleep(Duration::from_secs(next_secs)).await;
        }
}

/// Send a native OS toast notification for VPN state changes. Non-fatal -
/// if notifications are disabled or unavailable, we just log and move on.
fn send_status_notification(
    app: &AppHandle,
    status: &StatusDto,
    product_name: &str,
    network_name: Option<&str>,
) {
    let body = match status.state {
        ConnectionState::Connected => match (&status.local_ip, network_name) {
            (Some(ip), _) => format!("VPN verbunden: {}", ip),
            (None, Some(net)) => format!("VPN verbunden mit dem {}.", net),
            (None, None) => "VPN verbunden mit dem Firmennetz.".to_string(),
        },
        ConnectionState::Disconnected => "VPN Tunnel getrennt.".to_string(),
        ConnectionState::Error => "VPN Verbindung gestört. Bitte Diagnose prüfen.".to_string(),
        ConnectionState::Connecting => return, // no notification for transient state
    };

    if let Err(e) = tauri_plugin_notification::NotificationExt::notification(app)
        .builder()
        .title(product_name)
        .body(&body)
        .show()
    {
        tracing::debug!("Toast Notification fehlgeschlagen: {}", e);
    }
}

fn update_tray_tooltip(app: &AppHandle, status: &StatusDto, product_name: &str) {
    if let Some(tray) = app.tray_by_id("main-tray") {
        let suffix = match status.state {
            ConnectionState::Connected => "Verbunden",
            ConnectionState::Connecting => "Verbinde …",
            ConnectionState::Disconnected => "Getrennt",
            ConnectionState::Error => "Fehler",
        };
        let _ = tray.set_tooltip(Some(format!("{} · {}", product_name, suffix)));
    }
}

// ── Local health history (RMM foundation, no server) ──
// A small JSONL ring file of state transitions so the diagnose panel can answer
// "how often / when did the VPN drop today" without any backend.

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct HealthEvent {
    pub timestamp: String,
    pub state: String,
    #[serde(rename = "localIp")]
    pub local_ip: Option<String>,
}

const HEALTH_MAX_LINES: usize = 500;

fn health_path(app: &AppHandle) -> Option<std::path::PathBuf> {
    app.path()
        .app_data_dir()
        .ok()
        .map(|d| d.join("health.jsonl"))
}

/// Append a state-transition event to the capped local health history.
fn append_health_event(app: &AppHandle, state: &str, local_ip: Option<&str>) {
    let path = match health_path(app) {
        Some(p) => p,
        None => return,
    };
    if let Some(parent) = path.parent() {
        let _ = std::fs::create_dir_all(parent);
    }
    let ev = HealthEvent {
        timestamp: chrono::Local::now().to_rfc3339(),
        state: state.to_string(),
        local_ip: local_ip.map(|s| s.to_string()),
    };
    let line = match serde_json::to_string(&ev) {
        Ok(l) => l,
        Err(_) => return,
    };
    let mut lines: Vec<String> = std::fs::read_to_string(&path)
        .map(|c| c.lines().map(|s| s.to_string()).collect())
        .unwrap_or_default();
    lines.push(line);
    if lines.len() > HEALTH_MAX_LINES {
        let drop = lines.len() - HEALTH_MAX_LINES;
        lines.drain(0..drop);
    }
    let _ = std::fs::write(&path, lines.join("\n") + "\n");
}

fn read_health_lines(app: &AppHandle, limit: usize) -> Vec<String> {
    let path = match health_path(app) {
        Some(p) => p,
        None => return vec![],
    };
    let content = match std::fs::read_to_string(&path) {
        Ok(c) => c,
        Err(_) => return vec![],
    };
    let all: Vec<String> = content
        .lines()
        .filter(|l| !l.trim().is_empty())
        .map(|s| s.to_string())
        .collect();
    let n = limit.min(all.len());
    all[all.len() - n..].to_vec()
}

#[tauri::command]
pub async fn get_health_history(
    app: AppHandle,
    limit: Option<usize>,
) -> AppResult<Vec<HealthEvent>> {
    let path = match health_path(&app) {
        Some(p) => p,
        None => return Ok(vec![]),
    };
    let content = match std::fs::read_to_string(&path) {
        Ok(c) => c,
        Err(_) => return Ok(vec![]),
    };
    let mut events: Vec<HealthEvent> = content
        .lines()
        .filter(|l| !l.trim().is_empty())
        .filter_map(|l| serde_json::from_str(l).ok())
        .collect();
    let n = limit.unwrap_or(100).min(events.len());
    let start = events.len() - n;
    events.drain(0..start);
    Ok(events)
}

/// NetBird client version (`netbird version`), best effort.

// ── Local inventory / system card (RMM foundation, read-only, no telemetry) ──

#[derive(Serialize, Clone, Debug)]
pub struct Inventory {
    pub hostname: String,
    pub os_name: String,
    pub os_version: String,
    pub os_username: String,
    pub app_version: String,
    pub netbird_version: Option<String>,
    pub local_ip: Option<String>,
    pub management_url: Option<String>,
    pub autostart_enabled: bool,
    pub enrolled: bool,
}

#[tauri::command]
pub async fn get_inventory(app: AppHandle, state: State<'_, AppState>) -> AppResult<Inventory> {
    let branding = ensure_branding(&app, &state).await.ok();
    let app_version = branding
        .as_ref()
        .map(|b| b.product.version.clone())
        .unwrap_or_else(|| env!("CARGO_PKG_VERSION").to_string());
    let management_url = branding.as_ref().map(|b| b.netbird.management_url.clone());

    let nb = state.netbird.clone();
    let (hostname, os_version, status_res, nb_version) = tokio::join!(
        fetch_hostname(),
        fetch_os_version(),
        nb.status(),
        fetch_netbird_version(&nb),
    );
    let local_ip = status_res.ok().and_then(|s| s.local_ip);

    let autostart_enabled = {
        use tauri_plugin_autostart::ManagerExt;
        app.autolaunch().is_enabled().unwrap_or(false)
    };
    let enrolled = enrolled_marker_path(&app)
        .map(|p| p.exists())
        .unwrap_or(false);

    Ok(Inventory {
        hostname,
        os_name: std::env::consts::OS.to_string(),
        os_version,
        os_username: std::env::var("USER")
            .or_else(|_| std::env::var("USERNAME"))
            .unwrap_or_default(),
        app_version,
        netbird_version: nb_version,
        local_ip,
        management_url,
        autostart_enabled,
        enrolled,
    })
}

// ── One-click support bundle (local file, no auto-upload) ──

fn reveal_in_file_manager(path: &std::path::Path) {
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        let _ = std::process::Command::new("explorer.exe")
            .arg(format!("/select,{}", path.display()))
            .creation_flags(0x08000000)
            .spawn();
    }
    #[cfg(target_os = "macos")]
    {
        let _ = std::process::Command::new("open")
            .arg("-R")
            .arg(path)
            .spawn();
    }
    #[cfg(all(unix, not(target_os = "macos")))]
    {
        if let Some(parent) = path.parent() {
            let _ = std::process::Command::new("xdg-open").arg(parent).spawn();
        }
    }
}

#[tauri::command]
pub async fn export_support_bundle(
    app: AppHandle,
    state: State<'_, AppState>,
    dest_dir: Option<String>,
) -> AppResult<String> {
    let branding = ensure_branding(&app, &state).await.ok();
    let product = branding
        .as_ref()
        .map(|b| b.product.name.clone())
        .unwrap_or_else(|| "Secure Access".to_string());
    let version = branding
        .as_ref()
        .map(|b| b.product.version.clone())
        .unwrap_or_else(|| env!("CARGO_PKG_VERSION").to_string());

    let nb = state.netbird.clone();
    let (hostname, os_version, status_res, public_ip, nb_version) = tokio::join!(
        fetch_hostname(),
        fetch_os_version(),
        nb.status(),
        fetch_public_ip(),
        fetch_netbird_version(&nb),
    );
    let os_user = std::env::var("USER")
        .or_else(|_| std::env::var("USERNAME"))
        .unwrap_or_default();
    let (state_str, local_ip, peers_total, peers_connected) = match &status_res {
        Ok(s) => (
            format!("{:?}", s.state),
            s.local_ip.clone(),
            s.peers.len(),
            s.peers.iter().filter(|p| p.connected).count(),
        ),
        Err(e) => (format!("Fehler: {}", e), None, 0, 0),
    };

    let logs = state.netbird.logs.last(300);
    let health = read_health_lines(&app, 200);

    let mut out = String::new();
    out.push_str(&format!("{} Support-Bundle\n", product));
    out.push_str(&format!("Version: {}\n", version));
    out.push_str(&format!("Erstellt: {}\n", chrono::Local::now().to_rfc3339()));
    out.push_str("\n== System ==\n");
    out.push_str(&format!("Hostname: {}\n", hostname));
    out.push_str(&format!("Benutzer: {}\n", os_user));
    out.push_str(&format!("OS: {} ({})\n", os_version, std::env::consts::OS));
    out.push_str(&format!(
        "NetBird: {}\n",
        nb_version.unwrap_or_else(|| "unbekannt".to_string())
    ));
    out.push_str("\n== VPN ==\n");
    out.push_str(&format!("Status: {}\n", state_str));
    out.push_str(&format!(
        "WireGuard IP: {}\n",
        local_ip.unwrap_or_else(|| "-".to_string())
    ));
    out.push_str(&format!(
        "Public IP: {}\n",
        public_ip.unwrap_or_else(|| "-".to_string())
    ));
    out.push_str(&format!(
        "Peers: {} verbunden / {} gesamt\n",
        peers_connected, peers_total
    ));
    out.push_str("\n== Verbindungs-Historie ==\n");
    for l in &health {
        out.push_str(l);
        out.push('\n');
    }
    out.push_str("\n== Logs ==\n");
    for l in &logs {
        out.push_str(l);
        out.push('\n');
    }

    // Use the folder the user picked, else fall back to Downloads.
    let dir = match dest_dir {
        Some(d) if !d.trim().is_empty() => std::path::PathBuf::from(d),
        _ => app
            .path()
            .download_dir()
            .unwrap_or_else(|_| std::env::temp_dir()),
    };
    let fname = format!(
        "{}-support-{}.txt",
        product.replace(' ', "-"),
        chrono::Local::now().format("%Y%m%d-%H%M%S")
    );
    let path = dir.join(fname);
    std::fs::write(&path, out)
        .map_err(|e| AppError::Io(format!("Support-Bundle schreiben: {}", e)))?;

    reveal_in_file_manager(&path);
    Ok(path.to_string_lossy().to_string())
}

// ── Connectivity / captive-portal probe ──
// The type and the logic live in nkk_core::sys (shared with the CLI); this is
// just the thin Tauri command over it.

#[tauri::command]
pub async fn check_connectivity() -> AppResult<ConnectivityResult> {
    Ok(connectivity_core().await)
}

// ── On-site detection (comfort routing, NOT access control) ──
// If the employee is in the office LAN, the terminal servers are reachable
// directly and no VPN is needed. The truth-near signal is a direct TCP connect
// to the RDP target without the tunnel. SSID/gateway are spoofable and are not
// used as deciders. This must never gate security - that stays with RDP/NetBird.

/// Reveal which local source IP the OS would use to reach a host. A UDP
/// "connect" sends no packets, it only resolves the route.
fn local_source_ip(host: &str, port: u16) -> Option<std::net::IpAddr> {
    // Parse as a literal IP so we never trigger a blocking DNS lookup on the
    // async worker thread. On-site detection is a hint, so None is acceptable
    // for a hostname target.
    let ip: std::net::IpAddr = host.parse().ok()?;
    let sock = std::net::UdpSocket::bind("0.0.0.0:0").ok()?;
    sock.connect(std::net::SocketAddr::new(ip, port)).ok()?;
    sock.local_addr().ok().map(|a| a.ip())
}

/// True if the IP is in the NetBird CGNAT range 100.64.0.0/10 (i.e. the tunnel).
fn is_netbird_ip(ip: &std::net::IpAddr) -> bool {
    match ip {
        std::net::IpAddr::V4(v4) => {
            let o = v4.octets();
            o[0] == 100 && (64..=127).contains(&o[1])
        }
        _ => false,
    }
}

#[derive(Serialize, Clone, Debug)]
pub struct OnSiteResult {
    #[serde(rename = "onSite")]
    pub on_site: bool,
    #[serde(rename = "viaTarget")]
    pub via_target: Option<String>,
    #[serde(rename = "vpnActive")]
    pub vpn_active: bool,
}

/// Probe whether any RDP target is reachable directly (LAN), not via the tunnel.
async fn tcp_reachable(addr: &str) -> bool {
    matches!(
        timeout(
            Duration::from_millis(350),
            tokio::net::TcpStream::connect(addr),
        )
        .await,
        Ok(Ok(_))
    )
}

async fn probe_onsite(targets: &[String], vpn_active: bool) -> OnSiteResult {
    for t in targets {
        let addr = format!("{}:3389", t);
        // Confirm reachability with a second probe. A single transient or
        // half-open success right at a route change (tunnel just came up) must
        // never be read as on-site - both probes have to agree first.
        if !tcp_reachable(&addr).await {
            continue;
        }
        tokio::time::sleep(Duration::from_millis(150)).await;
        if !tcp_reachable(&addr).await {
            continue;
        }
        // Reachable and stable - but is it via the VPN route? If so it is not
        // on-site. This source-IP read can be stale the instant the tunnel
        // flips, so the caller re-probes once the routes have settled.
        let via_vpn = local_source_ip(t, 3389)
            .map(|ip| is_netbird_ip(&ip))
            .unwrap_or(false);
        if !vpn_active || !via_vpn {
            return OnSiteResult {
                on_site: true,
                via_target: Some(t.clone()),
                vpn_active,
            };
        }
    }
    OnSiteResult {
        on_site: false,
        via_target: None,
        vpn_active,
    }
}

#[tauri::command]
pub async fn detect_onsite(app: AppHandle, state: State<'_, AppState>) -> AppResult<OnSiteResult> {
    let branding = ensure_branding(&app, &state).await.ok();
    let targets: Vec<String> = branding
        .as_ref()
        .map(|b| {
            b.quick_launch
                .iter()
                .filter(|q| q.kind == "rdp")
                .map(|q| q.target.clone())
                .collect()
        })
        .unwrap_or_default();
    if targets.is_empty() {
        return Ok(OnSiteResult {
            on_site: false,
            via_target: None,
            vpn_active: false,
        });
    }
    let vpn_active = matches!(
        state.netbird.status().await,
        Ok(s) if matches!(s.state, ConnectionState::Connected)
    );
    Ok(probe_onsite(&targets, vpn_active).await)
}

// ── Smart network / path arbiter ──
// Conservative by design: it DETECTS the network context and WARNS about
// conflicting multi-path (dual-homing) situations, but does not change routes
// or interfaces (that needs elevation and is gated to a later, reviewed phase).

#[cfg(target_os = "macos")]
fn parse_default_routes(out: &str) -> Vec<String> {
    out.lines()
        .filter(|l| l.split_whitespace().next() == Some("default"))
        .filter_map(|l| {
            let c: Vec<&str> = l.split_whitespace().collect();
            if c.len() >= 3 {
                Some(format!("{} ({})", c[1], c[c.len() - 1]))
            } else {
                None
            }
        })
        .collect()
}

#[cfg(all(unix, not(target_os = "macos")))]
fn parse_default_routes(out: &str) -> Vec<String> {
    out.lines()
        .filter(|l| l.trim_start().starts_with("default"))
        .filter_map(|l| {
            let t: Vec<&str> = l.split_whitespace().collect();
            let via = t.iter().position(|x| *x == "via").and_then(|i| t.get(i + 1));
            let dev = t.iter().position(|x| *x == "dev").and_then(|i| t.get(i + 1));
            match (via, dev) {
                (Some(g), Some(d)) => Some(format!("{} ({})", g, d)),
                _ => None,
            }
        })
        .collect()
}

#[cfg(target_os = "windows")]
fn parse_default_routes(out: &str) -> Vec<String> {
    out.lines()
        .filter_map(|l| {
            let t: Vec<&str> = l.split_whitespace().collect();
            if t.len() >= 4 && t[0] == "0.0.0.0" && t[1] == "0.0.0.0" {
                Some(format!("{} (if {})", t[2], t[3]))
            } else {
                None
            }
        })
        .collect()
}

async fn enumerate_default_routes() -> Vec<String> {
    #[cfg(target_os = "macos")]
    let out = shell_output("netstat", &["-rn", "-f", "inet"]).await;
    #[cfg(all(unix, not(target_os = "macos")))]
    let out = shell_output("ip", &["-4", "route", "show", "default"]).await;
    #[cfg(target_os = "windows")]
    let out = shell_output("route", &["print", "-4"]).await;
    out.map(|s| parse_default_routes(&s)).unwrap_or_default()
}

#[derive(Serialize, Clone, Debug)]
pub struct NetworkContext {
    pub context: String,
    #[serde(rename = "chosenPath")]
    pub chosen_path: String,
    #[serde(rename = "serverReachableDirect")]
    pub server_reachable_direct: bool,
    #[serde(rename = "vpnConnected")]
    pub vpn_connected: bool,
    #[serde(rename = "dualHoming")]
    pub dual_homing: bool,
    #[serde(rename = "defaultRoutes")]
    pub default_routes: Vec<String>,
    pub reason: String,
    pub warning: Option<String>,
}

#[tauri::command]
pub async fn detect_network_context(
    app: AppHandle,
    state: State<'_, AppState>,
) -> AppResult<NetworkContext> {
    let branding = ensure_branding(&app, &state).await.ok();
    let targets: Vec<String> = branding
        .as_ref()
        .map(|b| {
            b.quick_launch
                .iter()
                .filter(|q| q.kind == "rdp")
                .map(|q| q.target.clone())
                .collect()
        })
        .unwrap_or_default();

    let vpn_connected = matches!(
        state.netbird.status().await,
        Ok(s) if matches!(s.state, ConnectionState::Connected)
    );
    let onsite = probe_onsite(&targets, vpn_connected).await;
    let routes = enumerate_default_routes().await;
    let dual_homing = routes.len() >= 2;
    let server_reachable_direct = onsite.on_site;

    let (context, chosen_path, reason) = if server_reachable_direct {
        (
            "office".to_string(),
            "lan".to_string(),
            format!(
                "Server direkt im Firmennetz erreichbar ({}).",
                onsite.via_target.clone().unwrap_or_else(|| "LAN".into())
            ),
        )
    } else if vpn_connected {
        (
            "remote".to_string(),
            "vpn".to_string(),
            "Server über das VPN erreichbar.".to_string(),
        )
    } else {
        (
            "unknown".to_string(),
            "none".to_string(),
            "Kein direkter Server-Pfad und VPN getrennt.".to_string(),
        )
    };

    let warning = if dual_homing {
        Some(format!(
            "Mehrere aktive Default-Routen erkannt ({}). Zwei gleichzeitige Netzwerkpfade können Routing- und DNS-Konflikte und langsame Verbindungen verursachen. Empfehlung: nur einen Pfad aktiv lassen, Kabel bevorzugen.",
            routes.join(", ")
        ))
    } else {
        None
    };

    Ok(NetworkContext {
        context,
        chosen_path,
        server_reachable_direct,
        vpn_connected,
        dual_homing,
        default_routes: routes,
        reason,
        warning,
    })
}

// ── Hidden admin / service menu ──
// Gate = SHA-256(salt + ":" + password) from branding.json, compared in
// constant time. This is an accident-prevention gate for employees, NOT
// authentication against an attacker with the binary. Service actions are a
// fixed whitelist of named commands - never a free command string (no RCE).

fn open_dir(path: &std::path::Path) {
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        let _ = std::process::Command::new("explorer.exe")
            .arg(path)
            .creation_flags(0x08000000)
            .spawn();
    }
    #[cfg(target_os = "macos")]
    {
        let _ = std::process::Command::new("open").arg(path).spawn();
    }
    #[cfg(all(unix, not(target_os = "macos")))]
    {
        let _ = std::process::Command::new("xdg-open").arg(path).spawn();
    }
}

/// Lowercase hex SHA-256 of `salt + ":" + password`. Must stay byte-for-byte
/// identical to how branding.json hashes are generated. Pure + testable.
fn admin_password_hash(salt: &str, password: &str) -> String {
    use sha2::{Digest, Sha256};
    let mut hasher = Sha256::new();
    hasher.update(salt.as_bytes());
    hasher.update(b":");
    hasher.update(password.as_bytes());
    hasher
        .finalize()
        .iter()
        .map(|b| format!("{:02x}", b))
        .collect()
}

#[tauri::command]
pub async fn admin_unlock(
    app: AppHandle,
    state: State<'_, AppState>,
    password: String,
) -> AppResult<bool> {
    let branding = ensure_branding(&app, &state).await.ok();
    let admin = match branding.as_ref().and_then(|b| b.admin.as_ref()) {
        Some(a) if !a.password_sha256.is_empty() => a.clone(),
        _ => {
            // No admin configured: blunt timing, deny.
            sleep(Duration::from_millis(400)).await;
            return Ok(false);
        }
    };

    let computed = admin_password_hash(&admin.salt, &password);

    let ok = computed.len() == admin.password_sha256.len()
        && constant_time_eq::constant_time_eq(
            computed.as_bytes(),
            admin.password_sha256.as_bytes(),
        );

    // Small constant delay to blunt rapid guessing; same on success and failure.
    sleep(Duration::from_millis(400)).await;
    if ok {
        state.admin_unlocked.store(true, Ordering::Relaxed);
        tracing::info!("Service-Menue freigeschaltet.");
    }
    Ok(ok)
}

#[tauri::command]
pub fn admin_is_unlocked(state: State<'_, AppState>) -> bool {
    state.admin_unlocked.load(Ordering::Relaxed)
}

#[tauri::command]
pub async fn admin_open_log_folder(state: State<'_, AppState>) -> AppResult<()> {
    if !state.admin_unlocked.load(Ordering::Relaxed) {
        return Err(AppError::Internal("Service-Menue nicht freigeschaltet.".into()));
    }
    let dir = crate::logging::log_dir();
    let _ = std::fs::create_dir_all(&dir);
    open_dir(&dir);
    Ok(())
}

/// Force a clean reconnect: like an explicit connect, it clears the disconnect
/// intent + backoff, takes the tunnel down, and brings it back up. Never returns
/// a scary error; reports a calm status instead.
#[tauri::command]
pub async fn admin_force_reconnect(
    app: AppHandle,
    state: State<'_, AppState>,
) -> AppResult<String> {
    if !state.admin_unlocked.load(Ordering::Relaxed) {
        return Err(AppError::Internal("Service-Menue nicht freigeschaltet.".into()));
    }
    let mgmt = ensure_branding(&app, &state)
        .await
        .map(|b| b.netbird.management_url.clone())
        .unwrap_or_default();
    state.user_disconnected.store(false, Ordering::Relaxed);
    set_user_disconnected_marker(&app, false);
    reset_reconnect_state();
    let nb = state.netbird.clone();
    let _ = timeout(Duration::from_secs(8), nb.down()).await;
    sleep(Duration::from_secs(1)).await;
    let up = timeout(Duration::from_secs(35), nb.up(&mgmt, None)).await;
    Ok(match up {
        Ok(Ok(())) => "Verbindung neu aufgebaut.".to_string(),
        _ => "Reconnect angestoßen, bitte den Status kurz prüfen.".to_string(),
    })
}

/// Open the app data folder (enrolled marker, rdp settings) for support.
#[tauri::command]
pub async fn admin_open_app_data(app: AppHandle, state: State<'_, AppState>) -> AppResult<()> {
    if !state.admin_unlocked.load(Ordering::Relaxed) {
        return Err(AppError::Internal("Service-Menue nicht freigeschaltet.".into()));
    }
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| AppError::Internal(e.to_string()))?;
    let _ = std::fs::create_dir_all(&dir);
    open_dir(&dir);
    Ok(())
}

/// Restart the whole app (picks up a fresh config / clears a wedged UI).
#[tauri::command]
#[allow(unreachable_code)]
pub async fn admin_restart_app(app: AppHandle, state: State<'_, AppState>) -> AppResult<()> {
    if !state.admin_unlocked.load(Ordering::Relaxed) {
        return Err(AppError::Internal("Service-Menue nicht freigeschaltet.".into()));
    }
    app.restart();
    Ok(())
}

#[tauri::command]
pub async fn admin_restart_service(state: State<'_, AppState>) -> AppResult<String> {
    if !state.admin_unlocked.load(Ordering::Relaxed) {
        return Err(AppError::Internal("Service-Menue nicht freigeschaltet.".into()));
    }
    tracing::info!("Admin: NetBird Dienst Neustart angefordert.");
    #[cfg(target_os = "windows")]
    {
        let mut stop = TokioCommand::new("sc.exe");
        stop.args(["stop", "netbird"]);
        stop.creation_flags(0x08000000);
        let _ = timeout(Duration::from_secs(6), stop.output()).await;
        sleep(Duration::from_secs(1)).await;
        let mut start = TokioCommand::new("sc.exe");
        start.args(["start", "netbird"]);
        start.creation_flags(0x08000000);
        let _ = timeout(Duration::from_secs(6), start.output()).await;
        return Ok("NetBird Dienst neu gestartet.".into());
    }
    #[cfg(target_os = "macos")]
    {
        let bin = state.netbird.binary_path().to_string();
        let _ = timeout(
            Duration::from_secs(6),
            TokioCommand::new(&bin).args(["service", "stop"]).output(),
        )
        .await;
        sleep(Duration::from_secs(1)).await;
        let _ = timeout(
            Duration::from_secs(6),
            TokioCommand::new(&bin).args(["service", "start"]).output(),
        )
        .await;
        return Ok("NetBird Dienst neu gestartet.".into());
    }
    #[cfg(all(unix, not(target_os = "macos")))]
    {
        let bin = state.netbird.binary_path().to_string();
        let _ = timeout(
            Duration::from_secs(6),
            TokioCommand::new(&bin).args(["service", "restart"]).output(),
        )
        .await;
        Ok("NetBird Dienst neu gestartet.".into())
    }
}

// ── NetBird version checker (admin) ──

/// Extract a leading x.y.z from a version string ("v0.73.2", "0.68.1 ...").
fn parse_semver(s: &str) -> Option<(u32, u32, u32)> {
    let core: String = s
        .trim()
        .trim_start_matches('v')
        .chars()
        .take_while(|c| c.is_ascii_digit() || *c == '.')
        .collect();
    let mut it = core.split('.');
    let a = it.next()?.parse().ok()?;
    let b = it.next().unwrap_or("0").parse().unwrap_or(0);
    let c = it.next().unwrap_or("0").parse().unwrap_or(0);
    Some((a, b, c))
}

fn version_lt(local: &str, remote: &str) -> bool {
    match (parse_semver(local), parse_semver(remote)) {
        (Some(l), Some(r)) => l < r,
        _ => false,
    }
}

/// Latest stable NetBird version from the GitHub releases API (best effort).
async fn fetch_latest_netbird_version() -> Option<String> {
    let out = shell_output(
        "curl",
        &[
            "-s",
            "--max-time",
            "6",
            "-H",
            "User-Agent: nkk-secure-access",
            "https://api.github.com/repos/netbirdio/netbird/releases/latest",
        ],
    )
    .await?;
    let v: serde_json::Value = serde_json::from_str(&out).ok()?;
    let tag = v.get("tag_name")?.as_str()?;
    Some(tag.trim_start_matches('v').to_string())
}

#[derive(Serialize, Clone, Debug)]
pub struct NetbirdVersionCheck {
    pub local: Option<String>,
    pub latest: Option<String>,
    #[serde(rename = "updateAvailable")]
    pub update_available: bool,
    #[serde(rename = "managementUrl")]
    pub management_url: Option<String>,
    pub note: String,
}

#[tauri::command]
pub async fn admin_check_netbird_version(
    app: AppHandle,
    state: State<'_, AppState>,
) -> AppResult<NetbirdVersionCheck> {
    if !state.admin_unlocked.load(Ordering::Relaxed) {
        return Err(AppError::Internal("Service-Menue nicht freigeschaltet.".into()));
    }
    let branding = ensure_branding(&app, &state).await.ok();
    let management_url = branding.as_ref().map(|b| b.netbird.management_url.clone());

    let nb = state.netbird.clone();
    let (local, latest) = tokio::join!(fetch_netbird_version(&nb), fetch_latest_netbird_version());

    let update_available = match (&local, &latest) {
        (Some(l), Some(r)) => version_lt(l, r),
        _ => false,
    };

    let note = match (&local, &latest) {
        (Some(l), Some(r)) if update_available => {
            format!("Update verfügbar: lokal {} -> neueste {}.", l, r)
        }
        (Some(l), Some(_)) => format!("NetBird {} ist aktuell.", l),
        (Some(l), None) => format!("Lokal {}; neueste Version nicht abrufbar (offline?).", l),
        (None, _) => "NetBird-Version lokal nicht ermittelbar.".to_string(),
    };

    Ok(NetbirdVersionCheck {
        local,
        latest,
        update_available,
        management_url,
        note,
    })
}

/// Update NetBird everywhere, judging success by the resulting VERSION rather
/// than a process exit code. That is the key to reliability across versions:
/// installers return noisy codes (reboot-required, "already current", UAC
/// quirks), so we read what NetBird reports before and after and only call it
/// an error when the version genuinely did not move and we have a reason.
#[tauri::command]
pub async fn admin_update_netbird(
    app: AppHandle,
    state: State<'_, AppState>,
) -> AppResult<String> {
    if !state.admin_unlocked.load(Ordering::Relaxed) {
        return Err(AppError::Internal("Service-Menue nicht freigeschaltet.".into()));
    }
    let _ = &app;
    let nb = state.netbird.clone();

    // Pre-check: never run an installer if NetBird is already current.
    let before = fetch_netbird_version(&nb).await;
    let latest = fetch_latest_netbird_version().await;
    if let (Some(b), Some(l)) = (&before, &latest) {
        if !version_lt(b, l) {
            return Ok(format!("NetBird ist bereits aktuell (Version {}).", b));
        }
    }

    // Best-effort platform update. The hint carries a human reason only if the
    // command itself failed; it is used only when the version did not advance.
    let hint = run_netbird_update().await;

    // Give the daemon a moment to report the new version, then decide by version.
    sleep(Duration::from_secs(3)).await;
    let after = fetch_netbird_version(&nb).await;

    // Decide by the resulting version. Never surface a raw red error here: an
    // update that could not complete returns a calm, actionable Ok message.
    match (&before, &after) {
        (Some(b), Some(a)) if version_lt(b, a) => {
            Ok(format!("NetBird aktualisiert: {} auf {}.", b, a))
        }
        (_, Some(a)) => {
            if let Some(l) = &latest {
                if !version_lt(a, l) {
                    return Ok(format!("NetBird ist aktuell (Version {}).", a));
                }
            }
            Ok(match hint {
                Some(h) => format!(
                    "Automatisches Update nicht möglich: {} NetBird ist weiterhin Version {}.",
                    h, a
                ),
                None => format!(
                    "Kein Update durchgeführt, NetBird ist weiterhin Version {}.",
                    a
                ),
            })
        }
        _ => Ok(match hint {
            Some(h) => format!("Automatisches Update nicht möglich: {}", h),
            None => "NetBird-Version nicht ermittelbar, bitte Verbindung prüfen.".into(),
        }),
    }
}

// Runs the platform-appropriate NetBird update. Returns Some(reason) only if the
// command itself failed in a way worth reporting; success is judged by version
// in the caller, so a noisy exit code alone is never treated as a failure.
#[allow(unreachable_code)]
async fn run_netbird_update() -> Option<String> {
    #[cfg(target_os = "macos")]
    {
        // Homebrew install needs no admin prompt, so prefer it when present.
        let brew_managed = TokioCommand::new("brew")
            .args(["list", "netbird"])
            .output()
            .await
            .map(|o| o.status.success())
            .unwrap_or(false);
        if brew_managed {
            let res = timeout(
                Duration::from_secs(180),
                TokioCommand::new("brew").args(["upgrade", "netbird"]).output(),
            )
            .await;
            // Trust brew only if it truly succeeded. Newer Homebrew refuses
            // untrusted third-party taps (netbirdio/tap); on ANY failure we fall
            // through to the .pkg below, which always upgrades in place.
            if matches!(res, Ok(Ok(ref o)) if o.status.success()) {
                return None;
            }
        }
        // The official install.sh refuses when NetBird is already present, so
        // upgrade with the .pkg directly: macOS `installer` replaces it in
        // place. Download as the user, then run installer once with admin.
        let arch = if std::env::consts::ARCH == "aarch64" {
            "arm64"
        } else {
            "amd64"
        };
        let pkg = "/tmp/netbird-update.pkg";
        let url = format!("https://pkgs.netbird.io/macos/{}", arch);
        let dl = timeout(
            Duration::from_secs(120),
            TokioCommand::new("curl")
                .args(["-fsSL", "-o", pkg, &url])
                .output(),
        )
        .await;
        if !matches!(dl, Ok(Ok(ref o)) if o.status.success()) {
            return Some("NetBird-Download fehlgeschlagen, keine Verbindung?".into());
        }
        let res = timeout(
            Duration::from_secs(180),
            TokioCommand::new("osascript")
                .args([
                    "-e",
                    &format!(
                        "do shell script \"installer -pkg {} -target /\" with administrator privileges",
                        pkg
                    ),
                ])
                .output(),
        )
        .await;
        let hint = update_hint_from(res);
        let _ = std::fs::remove_file(pkg);
        return hint;
    }

    #[cfg(target_os = "windows")]
    {
        // winget is the most reliable path: it knows the package, is idempotent,
        // and handles elevation itself. Fall back to a downloaded silent
        // installer only when winget is unavailable (older Windows).
        let has_winget = TokioCommand::new("where")
            .arg("winget")
            .creation_flags(0x08000000)
            .output()
            .await
            .map(|o| o.status.success())
            .unwrap_or(false);
        if has_winget {
            let res = timeout(
                Duration::from_secs(240),
                TokioCommand::new("winget")
                    .args([
                        "upgrade",
                        "--id",
                        "NetBird.NetBird",
                        "--silent",
                        "--accept-package-agreements",
                        "--accept-source-agreements",
                        "--disable-interactivity",
                    ])
                    .creation_flags(0x08000000)
                    .output(),
            )
            .await;
            // winget exits non-zero for "no applicable upgrade"; the version
            // check covers that, so only a real launch failure is a hint.
            return match res {
                Ok(Ok(_)) => None,
                Ok(Err(e)) => Some(format!("winget konnte nicht gestartet werden: {}", e)),
                Err(_) => Some("Update-Timeout (winget).".into()),
            };
        }

        let tmp = std::env::temp_dir().join("netbird-update.exe");
        let tmp_str = tmp.to_string_lossy().to_string();
        let dl = timeout(
            Duration::from_secs(120),
            TokioCommand::new("curl")
                .args(["-fsSL", "-o", &tmp_str, "https://pkgs.netbird.io/windows/x64"])
                .creation_flags(0x08000000)
                .output(),
        )
        .await;
        if !matches!(dl, Ok(Ok(ref o)) if o.status.success()) {
            return Some("NetBird-Download fehlgeschlagen, keine Verbindung?".into());
        }
        // Start-Process -Verb RunAs elevates via UAC from our non-admin process.
        let ps = format!(
            "Start-Process -FilePath '{}' -ArgumentList '/S' -Verb RunAs -Wait",
            tmp_str
        );
        let run = timeout(
            Duration::from_secs(240),
            TokioCommand::new("powershell")
                .args([
                    "-NoProfile", "-NonInteractive", "-inputformat", "none",
                    "-ExecutionPolicy", "Bypass", "-Command", &ps,
                ])
                .creation_flags(0x08000000)
                .output(),
        )
        .await;
        let hint = match run {
            Ok(Ok(o)) if o.status.success() => None,
            Ok(Ok(o)) => {
                let e = String::from_utf8_lossy(&o.stderr);
                if e.contains("canceled") || e.contains("abgebrochen") {
                    Some("Update vom Benutzer abgebrochen (UAC).".into())
                } else {
                    Some("Der Installer meldete einen Fehler.".into())
                }
            }
            _ => Some("Installer konnte nicht gestartet werden.".into()),
        };
        // Make sure the service runs again regardless of the installer's mood.
        let mut sc = TokioCommand::new("sc.exe");
        sc.args(["start", "netbird"]).creation_flags(0x08000000);
        let _ = timeout(Duration::from_secs(6), sc.output()).await;
        return hint;
    }

    #[cfg(all(unix, not(target_os = "macos")))]
    {
        // Without a desktop session pkexec cannot prompt, so guide instead.
        if std::env::var("DISPLAY").is_err() && std::env::var("WAYLAND_DISPLAY").is_err() {
            return Some(
                "Bitte als Administrator ausführen: curl -fsSL https://pkgs.netbird.io/install.sh | sudo sh".into(),
            );
        }
        let res = timeout(
            Duration::from_secs(180),
            TokioCommand::new("pkexec")
                .args(["sh", "-c", "curl -fsSL https://pkgs.netbird.io/install.sh | sh"])
                .output(),
        )
        .await;
        return update_hint_from(res);
    }

    None
}

// Turn a finished (or timed-out) update command into an optional human reason.
// Used on the Unix paths; Windows classifies inline because it has more cases.
#[cfg(unix)]
fn update_hint_from(
    res: Result<std::io::Result<std::process::Output>, tokio::time::error::Elapsed>,
) -> Option<String> {
    match res {
        Ok(Ok(o)) if o.status.success() => None,
        Ok(Ok(o)) => {
            // Classify into a calm German fragment. Never echo the raw stderr,
            // which is technical and alarming for an employee.
            let e = String::from_utf8_lossy(&o.stderr).to_lowercase();
            if e.contains("canceled") || e.contains("cancelled") || e.contains("-128") {
                Some("vom Benutzer abgebrochen.".into())
            } else if e.contains("resolve")
                || e.contains("timed out")
                || e.contains("could not")
                || e.contains("network")
            {
                Some("keine Verbindung zum Update-Server.".into())
            } else if e.contains("untrusted") || e.contains("refusing to load") {
                Some("Homebrew hat das Update gesperrt, bitte den Support kontaktieren.".into())
            } else if e.contains("permission") || e.contains("denied") || e.contains("not permitted")
            {
                Some("fehlende Rechte.".into())
            } else if e.trim().is_empty() {
                None
            } else {
                Some("der Update-Helfer meldete einen Fehler.".into())
            }
        }
        _ => Some("Update abgebrochen oder Timeout.".into()),
    }
}

// ── Installable "levels" (command bundles, admin-gated) ──
// Steps come from the trusted, bundled branding.json (same trust as the signed
// app), never from the network or user input. Executed behind the admin unlock.

#[derive(Serialize, Clone, Debug)]
pub struct LevelMeta {
    pub id: String,
    pub label: String,
    pub description: Option<String>,
    pub steps: usize,
}

#[tauri::command]
pub async fn admin_list_levels(
    app: AppHandle,
    state: State<'_, AppState>,
) -> AppResult<Vec<LevelMeta>> {
    if !state.admin_unlocked.load(Ordering::Relaxed) {
        return Err(AppError::Internal("Service-Menue nicht freigeschaltet.".into()));
    }
    let levels = ensure_branding(&app, &state)
        .await
        .ok()
        .map(|b| b.levels)
        .unwrap_or_default();
    Ok(levels
        .iter()
        .map(|l| LevelMeta {
            id: l.id.clone(),
            label: l.label.clone(),
            description: l.description.clone(),
            steps: l.steps.len(),
        })
        .collect())
}

#[derive(Serialize, Clone, Debug)]
pub struct LevelStepResult {
    pub label: String,
    pub ok: bool,
    #[serde(rename = "exitCode")]
    pub exit_code: i32,
    pub output: String,
}

#[derive(Serialize, Clone, Debug)]
pub struct LevelRunResult {
    pub level: String,
    pub steps: Vec<LevelStepResult>,
    pub ok: bool,
}

#[tauri::command]
pub async fn admin_run_level(
    app: AppHandle,
    state: State<'_, AppState>,
    level_id: String,
) -> AppResult<LevelRunResult> {
    if !state.admin_unlocked.load(Ordering::Relaxed) {
        return Err(AppError::Internal("Service-Menue nicht freigeschaltet.".into()));
    }
    let branding = ensure_branding(&app, &state)
        .await
        .map_err(|_| AppError::Internal("Branding nicht ladbar.".into()))?;
    let level = branding
        .levels
        .iter()
        .find(|l| l.id == level_id)
        .ok_or_else(|| AppError::Internal(format!("Level '{}' nicht gefunden.", level_id)))?
        .clone();

    tracing::info!(
        "Admin: Level '{}' wird ausgefuehrt ({} Schritte).",
        level.id,
        level.steps.len()
    );

    let mut results: Vec<LevelStepResult> = Vec::new();
    let mut all_ok = true;
    for (i, step) in level.steps.iter().enumerate() {
        let label = step
            .label
            .clone()
            .unwrap_or_else(|| format!("Schritt {}", i + 1));

        let mut cmd;
        if let Some(sh) = &step.shell {
            #[cfg(target_os = "windows")]
            {
                cmd = TokioCommand::new("cmd");
                cmd.args(["/c", sh.as_str()]);
            }
            #[cfg(not(target_os = "windows"))]
            {
                cmd = TokioCommand::new("sh");
                cmd.args(["-c", sh.as_str()]);
            }
        } else if let Some(program) = &step.program {
            cmd = TokioCommand::new(program);
            if let Some(a) = &step.args {
                cmd.args(a);
            }
        } else {
            results.push(LevelStepResult {
                label,
                ok: false,
                exit_code: -1,
                output: "Schritt ohne program/shell".into(),
            });
            all_ok = false;
            break;
        }
        cmd.stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::piped());
        #[cfg(target_os = "windows")]
        cmd.creation_flags(0x08000000);

        let (ok, exit_code, output) = match timeout(Duration::from_secs(180), cmd.output()).await {
            Ok(Ok(out)) => {
                let mut s = String::from_utf8_lossy(&out.stdout).to_string();
                let err = String::from_utf8_lossy(&out.stderr);
                if !err.trim().is_empty() {
                    s.push('\n');
                    s.push_str(&err);
                }
                if s.len() > 4000 {
                    s.truncate(4000);
                    s.push_str("\n…");
                }
                (
                    out.status.success(),
                    out.status.code().unwrap_or(-1),
                    s,
                )
            }
            Ok(Err(e)) => (false, -1, format!("Start fehlgeschlagen: {}", e)),
            Err(_) => (false, -1, "Timeout (180s)".into()),
        };
        if !ok {
            all_ok = false;
        }
        results.push(LevelStepResult {
            label,
            ok,
            exit_code,
            output,
        });
        if !ok {
            break; // stop the level on first failure
        }
    }

    Ok(LevelRunResult {
        level: level_id,
        steps: results,
        ok: all_ok,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn admin_password_hash_is_sha256_of_salt_colon_password() {
        // Neutral vector (NOT the real password): sha256("abc:test"). Locks the
        // formula so the Rust gate can never drift from branding.json hashes.
        assert_eq!(
            admin_password_hash("abc", "test"),
            "a716f9e610d30cb1a2c3f013cce01080c088cc8ff3c6d95621b2f5c85fcaafe2"
        );
    }

    #[test]
    fn netbird_cgnat_range_detection() {
        use std::net::IpAddr;
        assert!(is_netbird_ip(&"100.64.0.1".parse::<IpAddr>().unwrap()));
        assert!(is_netbird_ip(&"100.127.255.255".parse::<IpAddr>().unwrap()));
        assert!(!is_netbird_ip(&"100.63.0.1".parse::<IpAddr>().unwrap()));
        assert!(!is_netbird_ip(&"192.168.0.20".parse::<IpAddr>().unwrap()));
    }

    #[test]
    fn semver_compare() {
        assert_eq!(parse_semver("v0.73.2"), Some((0, 73, 2)));
        assert!(version_lt("0.68.1", "0.73.2"));
        assert!(version_lt("v0.68.0", "0.68.1"));
        assert!(!version_lt("0.73.2", "0.73.2"));
        assert!(!version_lt("0.73.2", "0.73.1"));
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn parses_macos_default_routes_dual_homing() {
        let out = "Routing tables\n\nInternet:\nDestination        Gateway            Flags        Netif\ndefault            192.168.0.1        UGScg          en0\ndefault            192.168.60.1       UGScg          en1\n127                127.0.0.1          UCS            lo0";
        let r = parse_default_routes(out);
        assert_eq!(r.len(), 2);
        assert!(r[0].contains("192.168.0.1") && r[0].contains("en0"));
        assert!(r[1].contains("192.168.60.1") && r[1].contains("en1"));
    }
}
