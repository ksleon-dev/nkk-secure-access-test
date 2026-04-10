use crate::error::{AppError, AppResult};
use parking_lot::Mutex;
use serde::{Deserialize, Serialize};
use std::collections::VecDeque;
use std::process::Stdio;
use std::sync::Arc;
use tokio::process::Command;

const LOG_BUFFER_SIZE: usize = 500;

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
}

impl NetbirdClient {
    pub fn new() -> Self {
        let binary = std::env::var("NETBIRD_BIN").unwrap_or_else(|_| "netbird".to_string());
        Self {
            binary,
            logs: Arc::new(LogBuffer::default()),
        }
    }

    fn log(&self, line: impl Into<String>) {
        let l = line.into();
        tracing::info!("{}", l);
        self.logs.push(l);
    }

    async fn run(&self, args: &[&str]) -> AppResult<String> {
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
        // Prevent visible CMD window popup on Windows — netbird CLI is
        // a console app and would flash a black box on each call otherwise.
        #[cfg(target_os = "windows")]
        cmd.creation_flags(0x08000000); // CREATE_NO_WINDOW
        let output = cmd.output().await
            .map_err(|e| {
                if e.kind() == std::io::ErrorKind::NotFound {
                    AppError::NetbirdMissing
                } else {
                    AppError::NetbirdCli(e.to_string())
                }
            })?;

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
            return Err(AppError::NetbirdCli(format!(
                "Exit {}: {}",
                output.status.code().unwrap_or(-1),
                msg.trim()
            )));
        }
        Ok(stdout)
    }

    pub async fn up(&self, management_url: &str, setup_key: Option<&str>) -> AppResult<()> {
        let mut args: Vec<&str> = vec!["up", "--management-url", management_url];
        if let Some(k) = setup_key {
            args.push("--setup-key");
            args.push(k);
        }
        self.run(&args).await?;
        Ok(())
    }

    pub async fn down(&self) -> AppResult<()> {
        self.run(&["down"]).await?;
        Ok(())
    }

    pub async fn status(&self) -> AppResult<StatusDto> {
        let raw = self.run(&["status", "--json"]).await?;
        parse_status(&raw)
    }
}

fn parse_status(raw: &str) -> AppResult<StatusDto> {
    let v: serde_json::Value = serde_json::from_str(raw)
        .map_err(|e| AppError::NetbirdParse(format!("invalid JSON: {}", e)))?;

    // Management connection state
    let management_connected = first_bool(
        &v,
        &[
            &["managementState", "Connected"],
            &["managementState", "connected"],
            &["ManagementState", "Connected"],
        ],
    )
    .unwrap_or(false)
        || first_str(
            &v,
            &[&["managementConnState"], &["ManagementConnState"]],
        )
        .map(|s| s.eq_ignore_ascii_case("connected"))
        .unwrap_or(false);

    // Local wireguard IP
    let local_ip = first_str(
        &v,
        &[
            &["wireguardIp"],
            &["WireguardIP"],
            &["localPeerState", "ip"],
            &["localPeerState", "IP"],
        ],
    );

    // Peers
    let mut peers = Vec::new();
    let peer_array = v
        .get("peers")
        .and_then(|p| p.get("details").or_else(|| Some(p)))
        .or_else(|| v.get("Peers"))
        .and_then(|x| x.as_array())
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
            &[&["ip"], &["IP"], &["wireguardIp"], &["WireguardIP"]],
        )
        .unwrap_or_default();
        let status_str = first_str(&p, &[&["status"], &["Status"]]).unwrap_or_default();
        let connected = status_str.eq_ignore_ascii_case("connected");
        let latency_ms = first_str(&p, &[&["latency"], &["Latency"]])
            .and_then(|s| parse_latency(&s))
            .or_else(|| {
                p.get("latency")
                    .and_then(|x| x.as_u64())
                    .map(|x| x as u32)
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
    let state = if management_connected && any_peer_connected {
        ConnectionState::Connected
    } else if management_connected {
        ConnectionState::Connected
    } else if !peers.is_empty() {
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
    })
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
}
