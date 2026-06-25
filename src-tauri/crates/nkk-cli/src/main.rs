//! NKK Secure Access - headless CLI.
//!
//! A no-GUI client for Linux servers and automation/RMM. It drives the VPN
//! through the very same `nkk-core` (NetbirdClient, branding) the desktop app
//! uses, so the two can never drift apart. Human output on stdout by default,
//! `--json` for machines. Exit codes are stable so scripts can branch on them.

use clap::{Parser, Subcommand};
use nkk_core::branding::{self, BrandingDto};
use nkk_core::netbird::{ConnectionState, NetbirdClient, StatusDto};
use std::path::PathBuf;

#[derive(Parser)]
#[command(
    name = "nkk-secure-access-cli",
    version,
    about = "NKK Secure Access - headless VPN client (NetBird)"
)]
struct Cli {
    /// Machine-readable JSON output where supported (status, version).
    #[arg(long, global = true)]
    json: bool,
    #[command(subcommand)]
    command: Command,
}

#[derive(Subcommand)]
enum Command {
    /// VPN verbinden (Aufbau anstossen). Erstes Enrollment mit --setup-key.
    Connect {
        /// Setup-Key fuer das erste Enrollment.
        #[arg(long)]
        setup_key: Option<String>,
        /// Management-URL ueberschreiben (sonst aus branding.json).
        #[arg(long)]
        mgmt: Option<String>,
    },
    /// VPN trennen.
    Disconnect,
    /// Verbindungsstatus anzeigen.
    Status,
    /// App- und NetBird-Version anzeigen.
    Version,
}

/// Candidate directories that may hold branding.json on a headless box.
fn branding_dirs() -> Vec<PathBuf> {
    let mut dirs = Vec::new();
    if let Ok(d) = std::env::var("NKK_RESOURCE_DIR") {
        dirs.push(PathBuf::from(d));
    }
    if let Ok(exe) = std::env::current_exe() {
        if let Some(p) = exe.parent() {
            dirs.push(p.to_path_buf());
        }
    }
    dirs.push(PathBuf::from("/etc/nkk-secure-access"));
    dirs.push(PathBuf::from("."));
    dirs
}

fn load_branding() -> Option<BrandingDto> {
    branding_dirs().into_iter().find_map(|d| branding::load(&d).ok())
}

fn state_label(s: &ConnectionState) -> &'static str {
    match s {
        ConnectionState::Connected => "Verbunden",
        ConnectionState::Connecting => "Verbindet",
        ConnectionState::Disconnected => "Getrennt",
        ConnectionState::Error => "Fehler",
    }
}

fn print_status_human(s: &StatusDto) {
    let connected = s.peers.iter().filter(|p| p.connected).count();
    println!("NKK Secure Access");
    println!("  Zustand:     {}", state_label(&s.state));
    println!(
        "  Management:  {}",
        if s.management_connected { "verbunden" } else { "getrennt" }
    );
    println!("  Lokale IP:   {}", s.local_ip.as_deref().unwrap_or("-"));
    println!("  Peers:       {} von {} verbunden", connected, s.peers.len());
    if s.needs_login {
        println!("  Hinweis:     Neu-Anmeldung noetig (netbird up).");
    }
    if !s.cli_available {
        println!("  Hinweis:     NetBird ist nicht installiert oder nicht erreichbar.");
    }
}

/// Exit codes: 0 ok/connected, 1 disconnected/error, 2 connecting/needs-input,
/// 3 management unreachable, 5 netbird missing.
async fn run(cli: Cli) -> i32 {
    let nb = NetbirdClient::new();
    match cli.command {
        Command::Connect { setup_key, mgmt } => {
            let mgmt_url = mgmt.or_else(|| load_branding().map(|b| b.netbird.management_url));
            let Some(mgmt_url) = mgmt_url else {
                eprintln!(
                    "Keine Management-URL gefunden. Gib --mgmt <URL> an oder lege branding.json \
                     bereit (NKK_RESOURCE_DIR oder /etc/nkk-secure-access)."
                );
                return 2;
            };
            match nb.up(&mgmt_url, setup_key.as_deref()).await {
                Ok(()) => {
                    println!("Verbindung wird aufgebaut.");
                    0
                }
                Err(e) => {
                    eprintln!("Verbinden fehlgeschlagen: {e}");
                    3
                }
            }
        }
        Command::Disconnect => match nb.down().await {
            Ok(()) => {
                println!("Getrennt.");
                0
            }
            Err(e) => {
                eprintln!("Trennen fehlgeschlagen: {e}");
                1
            }
        },
        Command::Status => match nb.status().await {
            Ok(s) => {
                if cli.json {
                    match serde_json::to_string_pretty(&s) {
                        Ok(j) => println!("{j}"),
                        Err(e) => {
                            eprintln!("JSON-Ausgabe fehlgeschlagen: {e}");
                            return 1;
                        }
                    }
                } else {
                    print_status_human(&s);
                }
                match s.state {
                    ConnectionState::Connected => 0,
                    ConnectionState::Connecting => 2,
                    _ => 1,
                }
            }
            Err(e) => {
                eprintln!("Status nicht verfuegbar: {e}");
                1
            }
        },
        Command::Version => {
            let app = env!("CARGO_PKG_VERSION");
            if cli.json {
                println!(
                    "{{\"app\":\"{}\",\"netbird_binary\":\"{}\"}}",
                    app,
                    nb.binary_path()
                );
            } else {
                println!("NKK Secure Access CLI {app}");
                println!("NetBird-Binary: {}", nb.binary_path());
            }
            0
        }
    }
}

#[tokio::main]
async fn main() {
    let cli = Cli::parse();
    std::process::exit(run(cli).await);
}
