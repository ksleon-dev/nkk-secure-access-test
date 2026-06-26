//! Small, Tauri-free system probes shared by the desktop app and the CLI:
//! running a command quietly, reading hostname / OS / NetBird version, and the
//! captive-portal connectivity check. One implementation, no drift.

use crate::netbird::NetbirdClient;
use serde::{Deserialize, Serialize};
use tokio::process::Command as TokioCommand;

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct ConnectivityResult {
    pub online: bool,
    #[serde(rename = "captivePortal")]
    pub captive_portal: bool,
    #[serde(rename = "httpCode")]
    pub http_code: u32,
}

/// Run a command and return trimmed stdout, or None on failure/empty output.
/// On Windows it never flashes a console window (CREATE_NO_WINDOW).
pub async fn shell_output(cmd: &str, args: &[&str]) -> Option<String> {
    #[cfg(target_os = "windows")]
    use std::os::windows::process::CommandExt;
    let mut c = TokioCommand::new(cmd);
    c.args(args)
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::null());
    #[cfg(target_os = "windows")]
    c.creation_flags(0x08000000);
    // Hard 5s cap. A wedged binary (e.g. a hung netbird) must never leave a
    // join!-block (inventory, support bundle, version check) hanging forever.
    let out = match tokio::time::timeout(std::time::Duration::from_secs(5), c.output()).await {
        Ok(Ok(out)) => out,
        _ => return None,
    };
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

pub async fn fetch_hostname() -> String {
    shell_output("hostname", &[])
        .await
        .unwrap_or_else(|| "unbekannt".to_string())
}

pub async fn fetch_os_version() -> String {
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

pub async fn fetch_netbird_version(nb: &NetbirdClient) -> Option<String> {
    let out = shell_output(nb.binary_path(), &["version"]).await?;
    Some(out.lines().next().unwrap_or(&out).trim().to_string())
}

/// Captive-portal aware internet check. 204 = clean internet; a 2xx/3xx on a
/// 204-only endpoint = a portal intercepted us; anything else = offline.
pub async fn check_connectivity() -> ConnectivityResult {
    #[cfg(target_os = "windows")]
    let null_dev = "NUL";
    #[cfg(not(target_os = "windows"))]
    let null_dev = "/dev/null";

    let url = "http://connectivitycheck.gstatic.com/generate_204";
    let out = shell_output(
        "curl",
        &[
            "-s", "-o", null_dev, "-w", "%{http_code}", "--max-time", "4", url,
        ],
    )
    .await;
    let code: u32 = out
        .as_deref()
        .and_then(|s| s.trim().parse().ok())
        .unwrap_or(0);

    let (online, captive_portal) = match code {
        204 => (true, false),
        200 | 301 | 302 | 307 | 308 => (false, true),
        _ => (false, false),
    };
    ConnectivityResult {
        online,
        captive_portal,
        http_code: code,
    }
}
