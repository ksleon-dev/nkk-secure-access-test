use crate::branding::{self, BrandingDto};
use crate::error::{AppError, AppResult};
use crate::netbird::{ConnectionState, NetbirdClient, StatusDto};
use serde::{Deserialize, Serialize};
use std::sync::atomic::{AtomicBool, Ordering};
use tauri::{AppHandle, Emitter, Manager, State};
use tokio::process::Command as TokioCommand;
use tokio::sync::Mutex as AsyncMutex;
use tokio::time::{sleep, timeout, Duration};

const KEYRING_SERVICE: &str = "nkk-secure-access";
const KEYRING_USER: &str = "setup-key";
const KEYRING_PROFILES: &str = "credential-profiles";
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

fn profiles_entry() -> AppResult<keyring::Entry> {
    keyring::Entry::new(KEYRING_SERVICE, KEYRING_PROFILES).map_err(AppError::from)
}

fn load_profiles() -> AppResult<Vec<CredentialProfile>> {
    let entry = profiles_entry()?;
    match entry.get_password() {
        Ok(s) => Ok(serde_json::from_str::<Vec<CredentialProfile>>(&s).unwrap_or_default()),
        Err(keyring::Error::NoEntry) => Ok(vec![]),
        Err(e) => Err(AppError::Keyring(e.to_string())),
    }
}

fn store_profiles(profiles: &[CredentialProfile]) -> AppResult<()> {
    let json = serde_json::to_string(profiles)
        .map_err(|e| AppError::Internal(format!("profiles serialize: {}", e)))?;
    profiles_entry()?.set_password(&json)?;
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
    if password.is_empty() {
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
        p.password = password;
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
        let entry = profiles_entry()?;
        match entry.delete_credential() {
            Ok(_) => {}
            Err(keyring::Error::NoEntry) => {}
            Err(e) => return Err(AppError::Keyring(e.to_string())),
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
    let backend = if cfg!(target_os = "macos") {
        "macOS Keychain (Security framework)"
    } else if cfg!(target_os = "windows") {
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
}

#[tauri::command]
pub fn creds_default_username() -> String {
    std::env::var("USER")
        .or_else(|_| std::env::var("USERNAME"))
        .unwrap_or_default()
}

pub struct AppState {
    pub netbird: NetbirdClient,
    pub branding: AsyncMutex<Option<BrandingDto>>,
    /// In-memory cache of credential profiles. We populate this lazily on
    /// first read so we only ever hit the OS keystore once per app session
    /// instead of triggering the macOS Keychain prompt on every save / list.
    pub profiles_cache: AsyncMutex<Option<Vec<CredentialProfile>>>,
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
        }
    }
}

fn keyring_entry() -> AppResult<keyring::Entry> {
    keyring::Entry::new(KEYRING_SERVICE, KEYRING_USER).map_err(AppError::from)
}

fn save_setup_key(key: &str) -> AppResult<()> {
    let entry = keyring_entry()?;
    entry.set_password(key)?;
    Ok(())
}

fn load_setup_key() -> AppResult<Option<String>> {
    let entry = keyring_entry()?;
    match entry.get_password() {
        Ok(s) => Ok(Some(s)),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(e) => Err(AppError::Keyring(e.to_string())),
    }
}

fn delete_setup_key() -> AppResult<()> {
    let entry = keyring_entry()?;
    match entry.delete_credential() {
        Ok(_) => Ok(()),
        Err(keyring::Error::NoEntry) => Ok(()),
        Err(e) => Err(AppError::Keyring(e.to_string())),
    }
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
    let branding = ensure_branding(&app, &state).await?;
    let key = match setup_key {
        Some(k) if !k.trim().is_empty() => {
            let validated = validate_setup_key(&k)?;
            save_setup_key(&validated)?;
            Some(validated)
        }
        _ => load_setup_key()?,
    };

    state
        .netbird
        .up(&branding.netbird.management_url, key.as_deref())
        .await?;

    // Trigger an immediate status push so the UI feels snappy
    if let Ok(s) = state.netbird.status().await {
        let _ = app.emit("netbird-status-changed", &s);
    }
    Ok(())
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

#[tauri::command]
pub async fn nb_is_enrolled() -> AppResult<bool> {
    Ok(load_setup_key()?.is_some())
}

#[tauri::command]
pub async fn nb_reset_enrollment(
    app: AppHandle,
    state: State<'_, AppState>,
) -> AppResult<()> {
    // Best effort: bring tunnel down, then forget the key
    let _ = state.netbird.down().await;
    delete_setup_key()?;
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

    let fut = TokioCommand::new("ping")
        .args(&args)
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .status();

    match timeout(Duration::from_millis(timeout_ms + 500), fut).await {
        Ok(Ok(status)) => status.success(),
        _ => false,
    }
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
    pub timestamp: String,
}

async fn shell_output(cmd: &str, args: &[&str]) -> Option<String> {
    let out = TokioCommand::new(cmd)
        .args(args)
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::null())
        .output()
        .await
        .ok()?;
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
    // Best effort via curl — cheap and universally available.
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
        "VPN nicht verbunden oder Hintergrunddienst reagiert nicht.".to_string()
    } else if !lan {
        "VPN ist verbunden, Terminalserver antwortet aber nicht — evtl. Firewall.".to_string()
    } else {
        "Alles in Ordnung — verbunden und einsatzbereit.".to_string()
    };

    let os_username = std::env::var("USER")
        .or_else(|_| std::env::var("USERNAME"))
        .unwrap_or_else(|_| "unbekannt".to_string());

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
        timestamp: chrono::Utc::now().to_rfc3339(),
    })
}

/// Wait until netbird reports `Connected` state, polling every 750ms.
/// Returns false on timeout or unrecoverable error.
async fn wait_for_vpn_connected(client: &NetbirdClient, max: Duration) -> bool {
    let started = tokio::time::Instant::now();
    while started.elapsed() < max {
        match client.status().await {
            Ok(s) if matches!(s.state, ConnectionState::Connected) => return true,
            Ok(_) => {}
            Err(_) => {}
        }
        sleep(Duration::from_millis(750)).await;
    }
    false
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

    // Smart launcher: if netbird CLI exists, ensure tunnel is up before launching.
    // If netbird CLI is missing, assume the user is on the corporate network another
    // way (e.g. site-to-site VPN, OpenVPN) and just launch directly.
    let has_netbird = state.netbird.status().await;
    if let Ok(s) = &has_netbird {
        if !matches!(s.state, ConnectionState::Connected) {
            tracing::info!("RDP launch — VPN not connected, attempting auto-connect");
            let _ = app.emit("netbird-status-changed", s);
            if let Ok(b) = ensure_branding(&app, &state).await {
                let key = load_setup_key()?;
                let _ = state
                    .netbird
                    .up(&b.netbird.management_url, key.as_deref())
                    .await;
                let connected = wait_for_vpn_connected(&state.netbird, Duration::from_secs(15)).await;
                if !connected {
                    tracing::warn!("VPN auto-connect timed out, attempting RDP launch anyway");
                }
                if let Ok(updated) = state.netbird.status().await {
                    let _ = app.emit("netbird-status-changed", &updated);
                }
            }
        }
    }

    // Credentials are intentionally NOT injected — the remote desktop client
    // should prompt for login every time (no password reuse across sessions).

    #[cfg(target_os = "windows")]
    {
        std::process::Command::new("mstsc.exe")
            .arg(format!("/v:{}", target))
            .spawn()
            .map_err(|e| AppError::Internal(format!("mstsc start: {}", e)))?;
        return Ok(());
    }

    #[cfg(target_os = "macos")]
    {
        let rdp = format!(
            "full address:s:{target}\nauthentication level:i:2\nscreen mode id:i:2\nsmart sizing:i:1\naudiomode:i:0\nredirectclipboard:i:1\nuse multimon:i:0\nprompt for credentials:i:1\n"
        );
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
    // Allow UNC syntax (\\host\share) plus normal hostnames
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
        std::process::Command::new("explorer.exe")
            .arg(&target)
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
    let cmd = "explorer.exe";
    #[cfg(target_os = "macos")]
    let cmd = "open";
    #[cfg(all(unix, not(target_os = "macos")))]
    let cmd = "xdg-open";

    std::process::Command::new(cmd)
        .arg(&url)
        .spawn()
        .map_err(|e| AppError::Internal(format!("open url: {}", e)))?;
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

#[tauri::command]
pub async fn quit_app(app: AppHandle) -> AppResult<()> {
    app.exit(0);
    Ok(())
}

static MISSING_NOTIFIED: AtomicBool = AtomicBool::new(false);
static LAST_STATE_ERROR: AtomicBool = AtomicBool::new(false);

pub fn start_status_polling(app: AppHandle) {
    tauri::async_runtime::spawn(async move {
        // Initial small delay so the UI mounts before first push
        sleep(Duration::from_millis(500)).await;
        loop {
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

                update_tray_tooltip(&app, &payload);
                let _ = app.emit("netbird-status-changed", &payload);
            }
            // Poll only every 30s so we don't spam the log buffer / netbird CLI.
            // The diagnose panel triggers a fresh status call on demand.
            sleep(Duration::from_secs(30)).await;
        }
    });
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
