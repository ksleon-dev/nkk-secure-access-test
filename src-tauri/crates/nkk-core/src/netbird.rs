use crate::error::{AppError, AppResult};
use parking_lot::Mutex;
use serde::{Deserialize, Serialize};
use std::collections::VecDeque;
use std::process::Stdio;
use std::sync::Arc;
use tokio::process::Command;
use tokio::sync::Mutex as AsyncMutex;
use tokio::time::{timeout, Duration};

const LOG_BUFFER_SIZE: usize = 500;

/// Finds the netbird binary. Bundled macOS .app doesn't inherit the user's
/// shell PATH, so we probe well-known install locations.
fn find_netbird_binary() -> String {
    #[cfg(target_os = "macos")]
    {
        let candidates = [
            "/usr/local/bin/netbird",
            "/opt/homebrew/bin/netbird",
            "/opt/netbird/bin/netbird",
            // Official .app bundle (installer / cask) - no shell PATH inheritance
            "/Applications/NetBird.app/Contents/MacOS/netbird",
            "/usr/bin/netbird",
        ];
        for path in candidates {
            if std::path::Path::new(path).exists() {
                tracing::info!("NetBird gefunden: {}", path);
                return path.to_string();
            }
        }
    }
    #[cfg(target_os = "windows")]
    {
        let candidates = [
            r"C:\Program Files\NetBird\netbird.exe",
            r"C:\Program Files (x86)\NetBird\netbird.exe",
        ];
        for path in candidates {
            if std::path::Path::new(path).exists() {
                tracing::info!("NetBird gefunden: {}", path);
                return path.to_string();
            }
        }
    }
    "netbird".to_string()
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
    binary: String,
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
            binary: binary.clone(),
            logs: Arc::new(LogBuffer::default()),
            op_lock: Arc::new(AsyncMutex::new(())),
        };
        client.log(format!("NetBird Binary: {}", binary));
        client.log(format!("Plattform: {} {}", std::env::consts::OS, std::env::consts::ARCH));
        client
    }

    pub fn binary_path(&self) -> &str {
        &self.binary
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
        self.log(format!("$ {} {}", self.binary, safe_args.join(" ")));

        let mut cmd = Command::new(&self.binary);
        cmd.args(args)
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());
        #[cfg(target_os = "windows")]
        cmd.creation_flags(0x08000000); // CREATE_NO_WINDOW

        let output = match timeout(Duration::from_secs(timeout_secs), cmd.output()).await {
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
        let mut args: Vec<&str> = vec!["up", "--management-url", management_url];
        // Always run NetBird's built-in SSH server on every enrolled device, so the
        // NKK fleet (clients + servers) is reachable over the overlay for support.
        // NetBird SSH is identity-based (no passwords) and gated by the access
        // policies; root login is intentionally NOT enabled. The peer's ssh_enabled
        // flag in the management must also be on (set fleet-wide via the API).
        args.push("--allow-server-ssh");
        // SFTP/SCP for support file transfer (low risk, no privilege escalation).
        args.push("--enable-ssh-sftp");
        // Cache the SSO JWT for 5 min so repeated support SSH skips the browser
        // login. Kept under the server's 10-min token-age limit on purpose; root
        // login and port forwarding stay OFF (use the dashboard user-mapping for
        // admin accounts instead - fail-closed by default).
        args.push("--ssh-jwt-cache-ttl");
        args.push("300");
        if let Some(k) = setup_key {
            args.push("--setup-key");
            args.push(k);
        }
        // "up" with a setup key needs more time than status queries (first
        // enrollment can take 15-30s on Windows: service start + handshake +
        // WireGuard tunnel). Use a longer timeout here.
        self.run_with_timeout(&args, 30).await?;
        Ok(())
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
                tokio::time::sleep(Duration::from_secs(3)).await;
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
            tokio::time::sleep(Duration::from_secs(1)).await;
            let mut sc_start = Command::new("sc.exe");
            sc_start.args(["start", "netbird"]).creation_flags(0x08000000);
            let _ = timeout(Duration::from_secs(5), sc_start.output()).await;
            tokio::time::sleep(Duration::from_secs(3)).await;
        }
        #[cfg(target_os = "macos")]
        {
            let _ = timeout(
                Duration::from_secs(3),
                Command::new(&self.binary).args(["service", "start"]).output(),
            )
            .await;
            tokio::time::sleep(Duration::from_secs(2)).await;
        }
        #[cfg(all(unix, not(target_os = "macos")))]
        {
            let _ = timeout(
                Duration::from_secs(3),
                Command::new(&self.binary).args(["service", "restart"]).output(),
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

    Ok(StatusDto {
        state,
        management_connected,
        peers,
        local_ip,
        updated_at: chrono::Utc::now().to_rfc3339(),
        cli_available: true,
        needs_login,
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
