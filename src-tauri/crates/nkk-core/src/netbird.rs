use crate::error::{AppError, AppResult};
use parking_lot::{Mutex, RwLock};
use serde::{Deserialize, Serialize};
use std::collections::VecDeque;
use std::process::Stdio;
use std::sync::Arc;
use tokio::process::Command;
use tokio::sync::Mutex as AsyncMutex;
use tokio::time::{timeout, Duration};

const LOG_BUFFER_SIZE: usize = 500;

/// Absolute, well-known install locations for the netbird binary, ordered by
/// preference. Kept as a pure function so the NotFound-recovery path and the
/// initial resolution share exactly one list (no drift). The bundled macOS
/// .app doesn't inherit the user's shell PATH, so PATH alone is not enough.
fn netbird_candidate_paths() -> &'static [&'static str] {
    #[cfg(target_os = "macos")]
    {
        &[
            "/usr/local/bin/netbird",
            "/opt/homebrew/bin/netbird",
            "/opt/netbird/bin/netbird",
            // Official .app bundle (installer / cask) - no shell PATH inheritance
            "/Applications/NetBird.app/Contents/MacOS/netbird",
            "/usr/bin/netbird",
        ]
    }
    #[cfg(target_os = "windows")]
    {
        &[
            r"C:\Program Files\NetBird\netbird.exe",
            r"C:\Program Files (x86)\NetBird\netbird.exe",
        ]
    }
    #[cfg(all(unix, not(target_os = "macos")))]
    {
        &[
            "/usr/local/bin/netbird",
            "/usr/bin/netbird",
            "/opt/netbird/bin/netbird",
        ]
    }
}

/// First candidate path that exists on disk, or None. The exists-check is
/// injected so the selection logic is a pure, testable function independent of
/// the real filesystem.
fn first_existing<'a>(candidates: &[&'a str], exists: impl Fn(&str) -> bool) -> Option<&'a str> {
    candidates.iter().copied().find(|p| exists(p))
}

/// Finds the netbird binary among the well-known absolute locations. Bundled
/// macOS .app doesn't inherit the user's shell PATH, so we probe explicitly.
/// Falls back to the bare "netbird" name (resolved via PATH at spawn time).
fn find_netbird_binary() -> String {
    match first_existing(netbird_candidate_paths(), |p| std::path::Path::new(p).exists()) {
        Some(path) => {
            tracing::info!("NetBird gefunden: {}", path);
            path.to_string()
        }
        None => "netbird".to_string(),
    }
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "PascalCase")]
pub enum ConnectionState {
    Disconnected,
    Connecting,
    Connected,
    Error,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct PeerDto {
    pub name: String,
    pub ip: String,
    pub connected: bool,
    #[serde(rename = "latency_ms")]
    pub latency_ms: Option<u32>,
    pub relay: Option<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct StatusDto {
    pub state: ConnectionState,
    #[serde(rename = "management_connected")]
    pub management_connected: bool,
    pub peers: Vec<PeerDto>,
    #[serde(rename = "local_ip")]
    pub local_ip: Option<String>,
    #[serde(rename = "updated_at")]
    pub updated_at: String,
    #[serde(rename = "cli_available")]
    pub cli_available: bool,
    /// True when the NetBird daemon reports it needs interactive (re-)login -
    /// `daemonStatus` of NeedsLogin / SessionExpired / LoginFailed (0.7x+).
    /// The UI surfaces a re-login prompt instead of spinning the auto-reconnect.
    #[serde(rename = "needs_login")]
    pub needs_login: bool,
    /// True when the parsed JSON matched NONE of the known management/ip/peers
    /// shapes - a signal that netbird changed its status schema. Without this a
    /// renamed schema would silently look like a clean "disconnected" and the
    /// UI would show a green "getrennt" instead of flagging a real problem.
    #[serde(rename = "schema_unknown")]
    pub schema_unknown: bool,
}

impl StatusDto {
    pub fn disconnected(cli_available: bool) -> Self {
        Self {
            state: ConnectionState::Disconnected,
            management_connected: false,
            peers: vec![],
            local_ip: None,
            updated_at: chrono::Utc::now().to_rfc3339(),
            cli_available,
            needs_login: false,
            schema_unknown: false,
        }
    }

    pub fn error() -> Self {
        Self {
            state: ConnectionState::Error,
            management_connected: false,
            peers: vec![],
            local_ip: None,
            updated_at: chrono::Utc::now().to_rfc3339(),
            cli_available: false,
            needs_login: false,
            schema_unknown: false,
        }
    }
}

#[derive(Default)]
pub struct LogBuffer {
    inner: Mutex<VecDeque<String>>,
}

impl LogBuffer {
    pub fn push(&self, line: String) {
        let mut g = self.inner.lock();
        if g.len() >= LOG_BUFFER_SIZE {
            g.pop_front();
        }
        let stamped = format!(
            "[{}] {}",
            chrono::Local::now().format("%Y-%m-%d %H:%M:%S"),
            line
        );
        g.push_back(stamped);
    }

    pub fn last(&self, n: usize) -> Vec<String> {
        let g = self.inner.lock();
        let take = n.min(g.len());
        g.iter().rev().take(take).rev().cloned().collect()
    }
}

#[derive(Clone)]
pub struct NetbirdClient {
    // Interior mutability: on a fresh Mac the binary resolves to the bare
    // "netbird" name (nothing on disk yet). After the installer drops it into
    // /usr/local/bin the GUI's inherited PATH still won't know it, so a spawn
    // hits ErrorKind::NotFound. We then re-resolve against the absolute
    // candidate paths and update this in place - no app restart needed.
    binary: Arc<RwLock<String>>,
    pub logs: Arc<LogBuffer>,
    // Serialises tunnel-changing operations (up/down) so a concurrent connect
    // and disconnect can never interleave and leave the tunnel in an
    // indeterminate state. status() deliberately stays lock-free.
    op_lock: Arc<AsyncMutex<()>>,
}

impl Default for NetbirdClient {
    fn default() -> Self {
        Self::new()
    }
}

impl NetbirdClient {
    pub fn new() -> Self {
        let binary = std::env::var("NETBIRD_BIN").unwrap_or_else(|_| find_netbird_binary());
        let client = Self {
            binary: Arc::new(RwLock::new(binary.clone())),
            logs: Arc::new(LogBuffer::default()),
            op_lock: Arc::new(AsyncMutex::new(())),
        };
        client.log(format!("NetBird Binary: {}", binary));
        client.log(format!("Plattform: {} {}", std::env::consts::OS, std::env::consts::ARCH));
        client
    }

    /// Currently resolved binary path/name. Returns an owned String because the
    /// value lives behind a lock (interior mutability for post-install
    /// re-resolution).
    pub fn binary_path(&self) -> String {
        self.binary.read().clone()
    }

    /// Was NETBIRD_BIN pinned explicitly? Then we never auto-re-resolve.
    fn binary_pinned() -> bool {
        std::env::var_os("NETBIRD_BIN").is_some()
    }

    /// Re-resolve the binary against the absolute candidate paths after a spawn
    /// hit ErrorKind::NotFound (e.g. netbird was just installed into
    /// /usr/local/bin but the GUI's PATH predates it). Updates self.binary in
    /// place and returns true if a different, existing path was found.
    /// Happy-path is untouched: on a Mac where netbird is already resolvable
    /// this is only ever reached when a spawn actually failed with NotFound.
    fn refresh_binary_after_notfound(&self) -> bool {
        if Self::binary_pinned() {
            return false;
        }
        let current = self.binary.read().clone();
        if let Some(found) =
            first_existing(netbird_candidate_paths(), |p| std::path::Path::new(p).exists())
        {
            if found != current {
                *self.binary.write() = found.to_string();
                self.log(format!("NetBird nach Neuinstallation gefunden: {}", found));
                return true;
            }
        }
        false
    }

    fn log(&self, line: impl Into<String>) {
        let l = line.into();
        tracing::info!("{}", l);
        self.logs.push(l);
    }

    async fn run(&self, args: &[&str]) -> AppResult<String> {
        self.run_with_timeout(args, 10).await
    }

    async fn run_with_timeout(&self, args: &[&str], timeout_secs: u64) -> AppResult<String> {
        // Mask sensitive args in logs
        let safe_args: Vec<String> = args
            .iter()
            .enumerate()
            .map(|(i, a)| {
                if i > 0 && args[i - 1] == "--setup-key" {
                    "<redacted>".to_string()
                } else {
                    a.to_string()
                }
            })
            .collect();
        let bin = self.binary_path();
        self.log(format!("$ {} {}", bin, safe_args.join(" ")));

        let mut cmd = Command::new(&bin);
        cmd.args(args)
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());
        #[cfg(target_os = "windows")]
        cmd.creation_flags(0x08000000); // CREATE_NO_WINDOW

        let spawn = timeout(Duration::from_secs(timeout_secs), cmd.output()).await;
        // Fresh Mac: the initial spawn used the bare "netbird" name (nothing on
        // disk at startup). If it just got installed into /usr/local/bin the
        // GUI's PATH won't know it -> NotFound. Re-resolve against the absolute
        // candidate paths ONCE and retry, so enrollment doesn't stay wedged.
        let spawn = if let Ok(Err(ref e)) = spawn {
            if e.kind() == std::io::ErrorKind::NotFound && self.refresh_binary_after_notfound() {
                let bin2 = self.binary_path();
                let mut cmd2 = Command::new(&bin2);
                cmd2.args(args).stdout(Stdio::piped()).stderr(Stdio::piped());
                #[cfg(target_os = "windows")]
                cmd2.creation_flags(0x08000000);
                timeout(Duration::from_secs(timeout_secs), cmd2.output()).await
            } else {
                spawn
            }
        } else {
            spawn
        };

        let output = match spawn {
            Ok(Ok(out)) => out,
            Ok(Err(e)) => {
                return if e.kind() == std::io::ErrorKind::NotFound {
                    Err(AppError::NetbirdMissing)
                } else {
                    Err(AppError::NetbirdCli(e.to_string()))
                };
            }
            Err(_elapsed) => {
                self.log(format!("TIMEOUT: netbird CLI hat nicht innerhalb {}s geantwortet", timeout_secs));
                return Err(AppError::NetbirdCli(
                    format!("Netbird antwortet nicht (Timeout {}s). Bitte App neu starten.", timeout_secs),
                ));
            }
        };

        let stdout = String::from_utf8_lossy(&output.stdout).to_string();
        let stderr = String::from_utf8_lossy(&output.stderr).to_string();

        for line in stderr.lines().filter(|l| !l.trim().is_empty()) {
            self.log(format!("stderr: {}", line));
        }

        if !output.status.success() {
            let msg = if stderr.trim().is_empty() {
                stdout.clone()
            } else {
                stderr.clone()
            };
            // On a headless Linux box netbird usually needs elevated rights; add a
            // plain hint when the failure looks like a permission/socket problem,
            // so an admin is not left guessing on the CLI.
            #[cfg(all(unix, not(target_os = "macos")))]
            let hint = {
                let low = msg.to_lowercase();
                if low.contains("permission denied")
                    || low.contains("operation not permitted")
                    || low.contains("connection refused")
                    || low.contains("/var/run/netbird")
                    || low.contains("dial unix")
                {
                    " (Tipp: auf Servern mit erhoehten Rechten ausfuehren, z.B. sudo.)"
                } else {
                    ""
                }
            };
            #[cfg(not(all(unix, not(target_os = "macos"))))]
            let hint = "";
            return Err(AppError::NetbirdCli(format!(
                "Exit {}: {}{}",
                output.status.code().unwrap_or(-1),
                msg.trim(),
                hint
            )));
        }
        Ok(stdout)
    }

    pub async fn up(&self, management_url: &str, setup_key: Option<&str>) -> AppResult<()> {
        // Serialise against a concurrent down(); status() is intentionally not
        // gated so the poller and the Windows pre-check never block or deadlock.
        let _guard = self.op_lock.lock().await;
        // "up" with a setup key needs more time than status queries (first
        // enrollment can take 15-30s on Windows: service start + handshake +
        // WireGuard tunnel). Use a longer timeout here.
        let full = up_args(management_url, setup_key, true);
        let full_ref: Vec<&str> = full.iter().map(|s| s.as_str()).collect();
        match self.run_with_timeout(&full_ref, 30).await {
            Ok(_) => Ok(()),
            Err(AppError::NetbirdCli(msg)) if is_unknown_flag_error(&msg) => {
                // An older/foreign netbird build rejected one of the optional
                // SSH-comfort flags. The CORE enrollment must never die on a
                // convenience flag: retry once with core flags only.
                self.log(
                    "NetBird kennt ein optionales SSH-Flag nicht, Rettungsversuch nur mit Kern-Flags",
                );
                let core = up_args(management_url, setup_key, false);
                let core_ref: Vec<&str> = core.iter().map(|s| s.as_str()).collect();
                self.run_with_timeout(&core_ref, 30).await?;
                Ok(())
            }
            Err(e) => Err(e),
        }
    }

    pub async fn down(&self) -> AppResult<()> {
        let _guard = self.op_lock.lock().await;
        self.run_with_timeout(&["down"], 15).await?;
        Ok(())
    }

    /// Connect with self-healing, shared by the GUI and the CLI so both get the
    /// same robustness: ensure the service is up, try once, and on failure
    /// restart the service and try again. Covers fresh installs or a stopped
    /// service where a plain `up` would just fail.
    pub async fn up_with_retry(
        &self,
        management_url: &str,
        setup_key: Option<&str>,
    ) -> AppResult<()> {
        // Pre-check (Windows): if the service is not reachable, start it first.
        #[cfg(target_os = "windows")]
        {
            if matches!(
                self.status().await,
                Err(AppError::NetbirdMissing) | Err(AppError::NetbirdCli(_))
            ) {
                self.log("NetBird Service nicht erreichbar, starte Service ...");
                self.start_service().await;
                // Auf Bereitschaft pollen (max 12s) statt blind zu warten: sobald der
                // Dienst antwortet, sofort weiter -> Versuch 1 klappt meist und der
                // langsame Restart-Retry entfaellt. Bei langsamem Start (AV-Scan) bis 12s.
                for _ in 0..12 {
                    tokio::time::sleep(Duration::from_secs(1)).await;
                    if self.status().await.is_ok() {
                        break;
                    }
                }
            }
        }

        // Attempt 1.
        if self.up(management_url, setup_key).await.is_ok() {
            return Ok(());
        }
        self.log("Erster Verbindungsversuch fehlgeschlagen, versuche Retry ...");
        // Restart the service, then attempt 2.
        self.restart_service().await;
        self.up(management_url, setup_key).await
    }

    #[cfg(target_os = "windows")]
    async fn start_service(&self) {
        use std::os::windows::process::CommandExt;
        let mut sc = Command::new("sc.exe");
        sc.args(["start", "netbird"]).creation_flags(0x08000000);
        let _ = timeout(Duration::from_secs(5), sc.output()).await;
    }

    /// Best-effort restart of the NetBird service/daemon for the connect retry.
    async fn restart_service(&self) {
        #[cfg(target_os = "windows")]
        {
            use std::os::windows::process::CommandExt;
            let mut sc_stop = Command::new("sc.exe");
            sc_stop.args(["stop", "netbird"]).creation_flags(0x08000000);
            let _ = timeout(Duration::from_secs(3), sc_stop.output()).await;
            tokio::time::sleep(Duration::from_millis(800)).await;
            let mut sc_start = Command::new("sc.exe");
            sc_start.args(["start", "netbird"]).creation_flags(0x08000000);
            let _ = timeout(Duration::from_secs(5), sc_start.output()).await;
            // Auf Bereitschaft pollen (max 4s) statt blind 3s zu warten.
            for _ in 0..4 {
                tokio::time::sleep(Duration::from_secs(1)).await;
                if self.status().await.is_ok() {
                    break;
                }
            }
        }
        #[cfg(target_os = "macos")]
        {
            let bin = self.binary_path();
            let _ = timeout(
                Duration::from_secs(3),
                Command::new(&bin).args(["service", "start"]).output(),
            )
            .await;
            tokio::time::sleep(Duration::from_secs(2)).await;
        }
        #[cfg(all(unix, not(target_os = "macos")))]
        {
            let bin = self.binary_path();
            let _ = timeout(
                Duration::from_secs(3),
                Command::new(&bin).args(["service", "restart"]).output(),
            )
            .await;
            tokio::time::sleep(Duration::from_secs(2)).await;
        }
    }

    pub async fn status(&self) -> AppResult<StatusDto> {
        let raw = self.run(&["status", "--json"]).await?;
        let result = parse_status(&raw)?;
        self.log(format!(
            "Status: {:?} | IP: {} | Management: {}",
            result.state,
            result.local_ip.as_deref().unwrap_or("-"),
            if result.management_connected { "OK" } else { "getrennt" },
        ));
        Ok(result)
    }
}

/// Build the argument vector for `netbird up`. Pure so the exact flag set is
/// unit-tested. `ssh_flags` toggles the optional SSH-comfort flags; with them
/// off only the core enrollment flags (management-url + optional setup-key)
/// remain, which is the degraded rescue path when a netbird build rejects an
/// optional flag.
fn up_args(mgmt: &str, setup_key: Option<&str>, ssh_flags: bool) -> Vec<String> {
    let mut args: Vec<String> = vec![
        "up".to_string(),
        "--management-url".to_string(),
        mgmt.to_string(),
    ];
    if ssh_flags {
        // Always run NetBird's built-in SSH server on every enrolled device, so the
        // NKK fleet (clients + servers) is reachable over the overlay for support.
        // NetBird SSH is identity-based (no passwords) and gated by the access
        // policies; root login is intentionally NOT enabled. The peer's ssh_enabled
        // flag in the management must also be on (set fleet-wide via the API).
        args.push("--allow-server-ssh".to_string());
        // SFTP/SCP for support file transfer (low risk, no privilege escalation).
        args.push("--enable-ssh-sftp".to_string());
        // Cache the SSO JWT for 5 min so repeated support SSH skips the browser
        // login. Kept under the server's 10-min token-age limit on purpose; root
        // login and port forwarding stay OFF (use the dashboard user-mapping for
        // admin accounts instead - fail-closed by default).
        args.push("--ssh-jwt-cache-ttl".to_string());
        args.push("300".to_string());
    }
    if let Some(k) = setup_key {
        args.push("--setup-key".to_string());
        args.push(k.to_string());
    }
    args
}

/// True when a netbird CLI error text signals an unrecognised flag, so the
/// caller can retry with the core-only flag set. Pure + tested (Cobra prints
/// "unknown flag" for long and "unknown shorthand flag" for short options).
fn is_unknown_flag_error(msg: &str) -> bool {
    let low = msg.to_lowercase();
    low.contains("unknown flag") || low.contains("unknown shorthand")
}

fn parse_status(raw: &str) -> AppResult<StatusDto> {
    let v: serde_json::Value = serde_json::from_str(raw)
        .map_err(|e| AppError::NetbirdParse(format!("invalid JSON: {}", e)))?;

    // Management connection state - covers multiple netbird versions:
    // v0.68+: { "management": { "connected": true } } and { "daemonStatus": "Connected" }
    // older:  { "managementState": { "Connected": true } } or { "managementConnState": "Connected" }
    let daemon_status = first_str(
        &v,
        &[
            &["daemonStatus"],
            &["managementConnState"],
            &["ManagementConnState"],
        ],
    );

    let management_connected = first_bool(
        &v,
        &[
            &["management", "connected"],
            &["managementState", "Connected"],
            &["managementState", "connected"],
            &["ManagementState", "Connected"],
        ],
    )
    .unwrap_or(false)
        || daemon_status
            .as_deref()
            .map(|s| s.eq_ignore_ascii_case("connected"))
            .unwrap_or(false);

    // Re-login needed - NetBird 0.7x signals expired/invalid auth via daemonStatus.
    // These must NOT be treated as a plain "disconnected" that the auto-reconnect
    // can fix by replaying the setup key; the user has to authenticate again.
    let needs_login = daemon_status
        .as_deref()
        .map(|s| {
            s.eq_ignore_ascii_case("NeedsLogin")
                || s.eq_ignore_ascii_case("SessionExpired")
                || s.eq_ignore_ascii_case("LoginFailed")
        })
        .unwrap_or(false);

    // Local wireguard IP - v0.68+ uses "netbirdIp", older uses "wireguardIp"
    let local_ip = first_str(
        &v,
        &[
            &["netbirdIp"],
            &["wireguardIp"],
            &["WireguardIP"],
            &["localPeerState", "ip"],
            &["localPeerState", "IP"],
        ],
    )
    // Strip CIDR suffix (e.g. "100.102.159.205/16" → "100.102.159.205")
    .map(|s| s.split('/').next().unwrap_or(&s).to_string());

    // Peers - staged fallback so a schema change can't silently parse 0 peers:
    // 1) peers.details[] (current), 2) peers[] (peers as a bare array),
    // 3) Peers[] (PascalCase). Each step actually checks as_array().
    let mut peers = Vec::new();
    // Did ANY recognised peers container exist (even if empty)? Used below to
    // tell "no peers" apart from "schema we don't understand".
    let peers_key_present = v
        .get("peers")
        .and_then(|p| p.get("details").and_then(|d| d.as_array()).or_else(|| p.as_array()))
        .or_else(|| v.get("Peers").and_then(|p| p.as_array()))
        .is_some();
    let peer_array = v
        .get("peers")
        .and_then(|p| p.get("details"))
        .and_then(|d| d.as_array())
        .or_else(|| v.get("peers").and_then(|p| p.as_array()))
        .or_else(|| v.get("Peers").and_then(|p| p.as_array()))
        .cloned()
        .unwrap_or_default();

    for p in peer_array {
        let name = first_str(
            &p,
            &[&["fqdn"], &["FQDN"], &["name"], &["Name"]],
        )
        .unwrap_or_else(|| "unbenannt".to_string());
        let ip = first_str(
            &p,
            &[&["netbirdIp"], &["ip"], &["IP"], &["wireguardIp"], &["WireguardIP"]],
        )
        .map(|s| s.split('/').next().unwrap_or(&s).to_string())
        .unwrap_or_default();
        let status_str = first_str(&p, &[&["status"], &["Status"]]).unwrap_or_default();
        let connected = status_str.eq_ignore_ascii_case("connected");
        let latency_ms = first_str(&p, &[&["latency"], &["Latency"]])
            .and_then(|s| parse_latency(&s))
            .or_else(|| {
                // NetBird 0.7x serialises `latency` as a Go time.Duration: an
                // integer in NANOSECONDS (15 ms => 15_000_000), not a "15ms"
                // string. Treating it as ms would be off by a factor of 1e6.
                p.get("latency")
                    .or_else(|| p.get("Latency"))
                    .and_then(|x| x.as_i64())
                    .filter(|ns| *ns > 0)
                    .map(nanos_to_ms)
            });
        let relay = first_str(&p, &[&["connectionType"], &["ConnectionType"]])
            .or_else(|| {
                p.get("relayed")
                    .and_then(|x| x.as_bool())
                    .map(|r| if r { "Relayed".into() } else { "P2P".into() })
            });
        peers.push(PeerDto {
            name,
            ip,
            connected,
            latency_ms,
            relay,
        });
    }

    let any_peer_connected = peers.iter().any(|p| p.connected);
    // "Connected" once management is up AND the tunnel is actually carrying:
    // either a peer is connected, OR the client has a WireGuard IP but no peers
    // in its ACL (routing-only / fresh policy). Without the latter branch a
    // correctly enrolled client that only reaches the terminal server via a
    // NetBird route (no visible peer) would hang on "Connecting" forever.
    let tunnel_up = any_peer_connected || (peers.is_empty() && local_ip.is_some());
    let state = if management_connected && tunnel_up {
        ConnectionState::Connected
    } else if management_connected || !peers.is_empty() {
        ConnectionState::Connecting
    } else {
        ConnectionState::Disconnected
    };

    // Unknown-schema guard: the JSON parsed, but NONE of the known
    // management/daemon/ip/peers shapes matched. A renamed schema would
    // otherwise masquerade as a clean "disconnected". Flag it (and log) so the
    // UI can distinguish "really disconnected" from "we can't read this".
    let schema_unknown = !management_connected
        && daemon_status.is_none()
        && local_ip.is_none()
        && !peers_key_present;
    if schema_unknown {
        tracing::warn!(
            "NetBird-Status: unbekanntes JSON-Schema (keine bekannte Management-/IP-/Peers-Struktur). Rohantwort ggf. neue netbird-Version."
        );
    }

    Ok(StatusDto {
        state,
        management_connected,
        peers,
        local_ip,
        updated_at: chrono::Utc::now().to_rfc3339(),
        cli_available: true,
        needs_login,
        schema_unknown,
    })
}

/// Convert a NetBird latency (Go time.Duration, nanoseconds) to whole
/// milliseconds. Sub-millisecond but non-zero latencies are reported as 1 ms so
/// "measured, very fast" stays distinguishable from "no measurement" (None).
fn nanos_to_ms(ns: i64) -> u32 {
    let ms = ns as f64 / 1_000_000.0;
    if ms <= 0.0 {
        0
    } else if ms < 1.0 {
        1
    } else {
        ms.round().min(u32::MAX as f64) as u32
    }
}

fn first_str(v: &serde_json::Value, paths: &[&[&str]]) -> Option<String> {
    for path in paths {
        if let Some(val) = walk(v, path) {
            if let Some(s) = val.as_str() {
                if !s.is_empty() {
                    return Some(s.to_string());
                }
            }
        }
    }
    None
}

fn first_bool(v: &serde_json::Value, paths: &[&[&str]]) -> Option<bool> {
    for path in paths {
        if let Some(val) = walk(v, path) {
            if let Some(b) = val.as_bool() {
                return Some(b);
            }
        }
    }
    None
}

fn walk<'a>(v: &'a serde_json::Value, path: &[&str]) -> Option<&'a serde_json::Value> {
    let mut cur = v;
    for k in path {
        cur = cur.get(*k)?;
    }
    Some(cur)
}

fn parse_latency(s: &str) -> Option<u32> {
    let s = s.trim();
    if s.is_empty() || s == "0s" || s == "0" {
        return None;
    }
    if let Some(stripped) = s.strip_suffix("ms") {
        return stripped.parse::<f64>().ok().map(|f| f as u32);
    }
    if let Some(stripped) = s.strip_suffix("µs") {
        return stripped.parse::<f64>().ok().map(|f| (f / 1000.0) as u32);
    }
    if let Some(stripped) = s.strip_suffix("us") {
        return stripped.parse::<f64>().ok().map(|f| (f / 1000.0) as u32);
    }
    if let Some(stripped) = s.strip_suffix('s') {
        return stripped.parse::<f64>().ok().map(|f| (f * 1000.0) as u32);
    }
    s.parse::<f64>().ok().map(|f| f as u32)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_latency_variants() {
        assert_eq!(parse_latency("23ms"), Some(23));
        assert_eq!(parse_latency("23.5ms"), Some(23));
        assert_eq!(parse_latency("1.2s"), Some(1200));
        assert_eq!(parse_latency("500µs"), Some(0));
        assert_eq!(parse_latency(""), None);
        assert_eq!(parse_latency("0s"), None);
    }

    #[test]
    fn parses_v068_status() {
        let raw = r#"{
            "peers": {
                "total": 1,
                "connected": 1,
                "details": [{
                    "fqdn": "serv-secure.netbird.selfhosted",
                    "netbirdIp": "100.102.162.60",
                    "status": "Connected",
                    "connectionType": "Relayed",
                    "latency": 0
                }]
            },
            "daemonVersion": "0.68.1",
            "daemonStatus": "Connected",
            "management": { "url": "https://vpn.secure.nkk-hb.de:443", "connected": true, "error": "" },
            "signal": { "url": "https://vpn.secure.nkk-hb.de:443", "connected": true, "error": "" },
            "netbirdIp": "100.102.159.205/16"
        }"#;
        let s = parse_status(raw).unwrap();
        assert!(s.management_connected);
        assert_eq!(s.state, ConnectionState::Connected);
        assert_eq!(s.local_ip.as_deref(), Some("100.102.159.205"));
        assert_eq!(s.peers.len(), 1);
        assert_eq!(s.peers[0].ip, "100.102.162.60");
        assert!(s.peers[0].connected);
    }

    #[test]
    fn parses_minimal_status() {
        let raw = r#"{
            "managementState": { "Connected": true },
            "wireguardIp": "100.64.0.1",
            "peers": {
                "details": [
                    {
                        "fqdn": "ts1.netbird.cloud",
                        "IP": "100.64.0.2",
                        "status": "Connected",
                        "latency": "18ms",
                        "connectionType": "P2P"
                    }
                ]
            }
        }"#;
        let s = parse_status(raw).unwrap();
        assert!(s.management_connected);
        assert_eq!(s.local_ip.as_deref(), Some("100.64.0.1"));
        assert_eq!(s.peers.len(), 1);
        assert_eq!(s.peers[0].name, "ts1.netbird.cloud");
        assert_eq!(s.peers[0].latency_ms, Some(18));
    }

    #[test]
    fn parses_latency_nanoseconds_from_integer() {
        // NetBird 0.7x: latency as Go time.Duration in nanoseconds.
        let raw = r#"{
            "management": { "connected": true },
            "netbirdIp": "100.64.0.1/16",
            "peers": { "details": [
                { "fqdn": "ts2", "netbirdIp": "100.64.0.2", "status": "Connected", "latency": 15000000 }
            ]}
        }"#;
        let s = parse_status(raw).unwrap();
        assert_eq!(s.peers[0].latency_ms, Some(15));
    }

    #[test]
    fn nanos_to_ms_handles_sub_millisecond() {
        assert_eq!(nanos_to_ms(500_000), 1); // 0.5 ms -> at least 1
        assert_eq!(nanos_to_ms(0), 0);
        assert_eq!(nanos_to_ms(18_000_000), 18);
    }

    #[test]
    fn parses_peers_as_bare_array() {
        let raw = r#"{
            "management": { "connected": true },
            "netbirdIp": "100.64.0.1",
            "peers": [ { "fqdn": "ts2", "ip": "100.64.0.2", "status": "Connected" } ]
        }"#;
        let s = parse_status(raw).unwrap();
        assert_eq!(s.peers.len(), 1);
        assert_eq!(s.peers[0].name, "ts2");
    }

    #[test]
    fn detects_needs_login() {
        let raw = r#"{ "daemonStatus": "SessionExpired", "peers": { "details": [] } }"#;
        let s = parse_status(raw).unwrap();
        assert!(s.needs_login);
        assert!(!s.management_connected);
    }

    #[test]
    fn up_args_with_ssh_flags_contains_ssh_and_core() {
        let a = up_args("https://vpn.secure.nkk-hb.de:443", Some("KEY123"), true);
        // management-url present, in order
        let mgmt_pos = a.iter().position(|s| s == "--management-url").unwrap();
        assert_eq!(a[mgmt_pos + 1], "https://vpn.secure.nkk-hb.de:443");
        // SSH comfort flags present
        assert!(a.iter().any(|s| s == "--allow-server-ssh"));
        assert!(a.iter().any(|s| s == "--enable-ssh-sftp"));
        assert!(a.iter().any(|s| s == "--ssh-jwt-cache-ttl"));
        // setup key present + value
        let key_pos = a.iter().position(|s| s == "--setup-key").unwrap();
        assert_eq!(a[key_pos + 1], "KEY123");
        assert_eq!(a[0], "up");
    }

    #[test]
    fn up_args_without_ssh_flags_keeps_mgmt_and_key_drops_ssh() {
        let a = up_args("https://vpn.secure.nkk-hb.de:443", Some("KEY123"), false);
        assert!(a.iter().any(|s| s == "--management-url"));
        let mgmt_pos = a.iter().position(|s| s == "--management-url").unwrap();
        assert_eq!(a[mgmt_pos + 1], "https://vpn.secure.nkk-hb.de:443");
        // no SSH comfort flags
        assert!(!a.iter().any(|s| s == "--allow-server-ssh"));
        assert!(!a.iter().any(|s| s == "--enable-ssh-sftp"));
        assert!(!a.iter().any(|s| s == "--ssh-jwt-cache-ttl"));
        // key still there
        assert!(a.iter().any(|s| s == "--setup-key"));
        assert!(a.iter().any(|s| s == "KEY123"));
    }

    #[test]
    fn up_args_without_key_has_no_setup_key_flag() {
        let a = up_args("https://vpn.secure.nkk-hb.de:443", None, false);
        assert!(!a.iter().any(|s| s == "--setup-key"));
        assert!(a.iter().any(|s| s == "--management-url"));
    }

    #[test]
    fn detects_unknown_flag_error() {
        assert!(is_unknown_flag_error("Error: unknown flag: --enable-ssh-sftp"));
        assert!(is_unknown_flag_error("unknown shorthand flag: 'x' in -x"));
        assert!(is_unknown_flag_error("UNKNOWN FLAG whatever"));
        assert!(!is_unknown_flag_error("Exit 1: setup key expired"));
    }

    #[test]
    fn first_existing_picks_first_present() {
        let cands = ["/a/netbird", "/b/netbird", "/c/netbird"];
        // Only /b exists
        assert_eq!(
            first_existing(&cands, |p| p == "/b/netbird"),
            Some("/b/netbird")
        );
        // First wins when several exist
        assert_eq!(
            first_existing(&cands, |p| p == "/a/netbird" || p == "/c/netbird"),
            Some("/a/netbird")
        );
        // None exist
        assert_eq!(first_existing(&cands, |_| false), None);
    }

    #[test]
    fn parse_status_flags_unknown_schema() {
        // Completely renamed JSON: none of the known management/ip/peers keys.
        let raw = r#"{ "somethingCompletelyDifferent": { "foo": 1 }, "barState": "whatever" }"#;
        let s = parse_status(raw).unwrap();
        // Must NOT masquerade as a clean disconnected: schema_unknown flags it.
        assert!(s.schema_unknown);
        assert!(!s.management_connected);
    }

    #[test]
    fn parse_status_known_schema_is_not_flagged_unknown() {
        // Happy path stays untouched: a normal connected status is not "unknown".
        let raw = r#"{
            "daemonStatus": "Connected",
            "management": { "connected": true },
            "netbirdIp": "100.64.0.5/16",
            "peers": { "details": [] }
        }"#;
        let s = parse_status(raw).unwrap();
        assert!(!s.schema_unknown);
        // An empty-but-present peers container is also not "unknown".
        let raw2 = r#"{ "management": { "connected": false }, "peers": { "details": [] } }"#;
        let s2 = parse_status(raw2).unwrap();
        assert!(!s2.schema_unknown);
    }

    #[test]
    fn connected_with_zero_peers_but_local_ip() {
        // Routing-only client: management up, has a WireGuard IP, no peers.
        let raw = r#"{
            "daemonStatus": "Connected",
            "management": { "connected": true },
            "netbirdIp": "100.64.0.5/16",
            "peers": { "details": [] }
        }"#;
        let s = parse_status(raw).unwrap();
        assert_eq!(s.state, ConnectionState::Connected);
    }
}
