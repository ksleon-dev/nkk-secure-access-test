//! NKK Secure Access - headless CLI.
//!
//! A no-GUI client for Linux servers and automation/RMM. It drives the VPN
//! through the very same `nkk-core` (NetbirdClient, branding) the desktop app
//! uses, so the two can never drift apart. Human output on stdout by default,
//! `--json` for machines. Exit codes are stable so scripts can branch on them.

use clap::{Parser, Subcommand};
use nkk_core::branding::{self, BrandingDto};
use nkk_core::netbird::{ConnectionState, NetbirdClient, StatusDto};
use nkk_core::{profile, sys};
use std::path::PathBuf;

#[derive(Parser)]
#[command(
    // name UND bin_name auf den Befehl pinnen, den der Nutzer tippt (Windows:
    // Sidecar-Exe nkk-secure.exe im PATH, macOS: /usr/local/bin-Symlink). bin_name
    // steuert die "Usage:"-Zeile; ohne Pin zeigt clap den argv[0]-Stem, also z.B.
    // den Triple-suffixierten Artefaktnamen, wenn man die Rohdatei aufruft.
    name = "nkk-secure",
    bin_name = "nkk-secure",
    version,
    about = "NKK Secure Access - VPN-Client fuer die Kommandozeile (NetBird)"
)]
struct Cli {
    /// Machine-readable JSON output where supported (status, version).
    #[arg(long, global = true)]
    json: bool,
    // Optional: ohne Subbefehl zeigt `nkk-secure` einen Kurzstatus statt eines
    // clap-Fehlers (freundlicher Einstieg; --help listet weiterhin alles).
    #[command(subcommand)]
    command: Option<Command>,
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
    /// Internetzugang pruefen (auch Captive-Portal-Erkennung).
    Connectivity,
    /// Inventar (Host, OS, NetBird-Version, IP) fuer RMM.
    Inventory,
    /// Schnelle Gesamtdiagnose: Status, Internet, NetBird-Version.
    Diagnose,
    /// Anzeige-Profil der App zeigen oder setzen (Setzen nur per Profil-Token).
    Profile {
        /// Opakes Profil-Token (vom IT-Admin, wie im Onboarding-Befehl). Ohne
        /// Token wird das aktuelle Profil angezeigt.
        token: Option<String>,
    },
    /// App (und die CLI) auf die neueste Version aktualisieren - headless, ohne GUI.
    /// Fuer Level/RMM gedacht: patcht jeden Client ueber das gehostete, selbst-
    /// aktualisierende Rollout-Skript. Windows/macOS aktualisieren die ganze App
    /// (die CLI kommt als Sidecar mit); auf Linux ersetzt sich die CLI selbst.
    Update,
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

/// Kompakter Ein-Block-Status fuer `nkk-secure` ohne Argument: Verbindung, Profil,
/// Version. Bewusst schlank (keine Onsite-Probe), damit es sofort da ist.
async fn short_status(nb: &NetbirdClient, json: bool) -> i32 {
    let s = nb.status().await.unwrap_or_else(|_| StatusDto::error());
    let role = profile::current_role();
    let ver = env!("CARGO_PKG_VERSION");
    if json {
        let v = serde_json::json!({
            "state": format!("{:?}", s.state),
            "managementConnected": s.management_connected,
            "localIp": s.local_ip,
            "role": role,
            "appVersion": ver,
        });
        println!("{}", serde_json::to_string_pretty(&v).unwrap_or_default());
    } else {
        println!("NKK Secure Access {ver}");
        println!("  Zustand:  {}", state_label(&s.state));
        println!("  Profil:   {role}");
        if let Some(ip) = s.local_ip.as_deref() {
            println!("  IP:       {ip}");
        }
        println!("  (nkk-secure --help fuer alle Befehle)");
    }
    match s.state {
        ConnectionState::Connected => 0,
        _ => 1,
    }
}

/// Exit codes: 0 ok/connected, 1 disconnected/error, 2 connecting/needs-input,
/// 3 management unreachable, 5 netbird missing.
async fn run(cli: Cli) -> i32 {
    let nb = NetbirdClient::new();
    // Ohne Subbefehl: freundlicher Kurzstatus statt clap-Fehler.
    let Some(command) = cli.command else {
        return short_status(&nb, cli.json).await;
    };
    match command {
        Command::Connect { setup_key, mgmt } => {
            let mgmt_url = mgmt.or_else(|| load_branding().map(|b| b.netbird.management_url));
            let Some(mgmt_url) = mgmt_url else {
                eprintln!(
                    "Keine Management-URL gefunden. Gib --mgmt <URL> an oder lege branding.json \
                     bereit (NKK_RESOURCE_DIR oder /etc/nkk-secure-access)."
                );
                return 2;
            };
            match nb.up_with_retry(&mgmt_url, setup_key.as_deref()).await {
                Ok(()) => {
                    // Denselben Marker wie die GUI pflegen: ein bewusster Connect gibt
                    // den Auto-Reconnect der (evtl. laufenden) App wieder frei.
                    profile::set_user_disconnected_marker(false);
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
                // Marker setzen, sonst wuerde der Auto-Reconnect der laufenden
                // Desktop-App das CLI-Trennen sofort wieder ueberstimmen (die App
                // liest den Marker pro Poll-Tick).
                profile::set_user_disconnected_marker(true);
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
        Command::Connectivity => {
            let c = sys::check_connectivity().await;
            if cli.json {
                println!(
                    "{{\"online\":{},\"captivePortal\":{},\"httpCode\":{}}}",
                    c.online, c.captive_portal, c.http_code
                );
            } else if c.online {
                println!("Internet: ok");
            } else if c.captive_portal {
                println!(
                    "Internet: Captive-Portal-Anmeldung noetig (HTTP {}).",
                    c.http_code
                );
            } else {
                println!("Internet: offline (HTTP {}).", c.http_code);
            }
            if c.online {
                0
            } else {
                1
            }
        }
        Command::Inventory => {
            let b = load_branding();
            let mgmt = b.as_ref().map(|x| x.netbird.management_url.clone());
            let app_ver = b
                .as_ref()
                .map(|x| x.product.version.clone())
                .unwrap_or_else(|| env!("CARGO_PKG_VERSION").to_string());
            let (hostname, os_version, status, nb_version) = tokio::join!(
                sys::fetch_hostname(),
                sys::fetch_os_version(),
                nb.status(),
                sys::fetch_netbird_version(&nb),
            );
            let local_ip = status.ok().and_then(|s| s.local_ip);
            let user = std::env::var("USER")
                .or_else(|_| std::env::var("USERNAME"))
                .unwrap_or_default();
            if cli.json {
                let v = serde_json::json!({
                    "hostname": hostname,
                    "os": os_version,
                    "user": user,
                    "appVersion": app_ver,
                    "netbirdVersion": nb_version,
                    "localIp": local_ip,
                    "managementUrl": mgmt,
                });
                println!("{}", serde_json::to_string_pretty(&v).unwrap_or_default());
            } else {
                println!("NKK Secure Access - Inventar");
                println!("  Host:        {hostname}");
                println!("  OS:          {os_version}");
                println!("  Benutzer:    {user}");
                println!("  App:         {app_ver}");
                println!("  NetBird:     {}", nb_version.as_deref().unwrap_or("-"));
                println!("  Lokale IP:   {}", local_ip.as_deref().unwrap_or("-"));
                println!("  Management:  {}", mgmt.as_deref().unwrap_or("-"));
            }
            0
        }
        Command::Diagnose => {
            let (status, conn, nb_version) = tokio::join!(
                nb.status(),
                sys::check_connectivity(),
                sys::fetch_netbird_version(&nb),
            );
            let s = status.unwrap_or_else(|_| StatusDto::error());
            let peers_ok = s.peers.iter().filter(|p| p.connected).count();
            let net = if conn.online {
                "ok"
            } else if conn.captive_portal {
                "Captive Portal"
            } else {
                "offline"
            };
            if cli.json {
                let v = serde_json::json!({
                    "state": format!("{:?}", s.state),
                    "managementConnected": s.management_connected,
                    "localIp": s.local_ip,
                    "peersConnected": peers_ok,
                    "peersTotal": s.peers.len(),
                    "online": conn.online,
                    "captivePortal": conn.captive_portal,
                    "netbirdVersion": nb_version,
                    "cliAvailable": s.cli_available,
                });
                println!("{}", serde_json::to_string_pretty(&v).unwrap_or_default());
            } else {
                println!("NKK Secure Access - Diagnose");
                println!("  VPN:         {}", state_label(&s.state));
                println!("  Internet:    {net}");
                println!(
                    "  Management:  {}",
                    if s.management_connected {
                        "verbunden"
                    } else {
                        "getrennt"
                    }
                );
                println!("  Peers:       {} von {} verbunden", peers_ok, s.peers.len());
                println!("  NetBird:     {}", nb_version.as_deref().unwrap_or("-"));
                if !s.cli_available {
                    println!("  Hinweis:     NetBird ist nicht erreichbar.");
                }
            }
            if matches!(s.state, ConnectionState::Connected) && conn.online {
                0
            } else {
                1
            }
        }
        Command::Profile { token } => match token {
            None => {
                let role = profile::current_role();
                let pending = profile::profile_bootstrap_path()
                    .map(|p| p.exists())
                    .unwrap_or(false);
                if cli.json {
                    println!(
                        "{{\"role\":\"{}\",\"pendingChange\":{}}}",
                        role, pending
                    );
                } else {
                    println!("Profil: {role}");
                    if pending {
                        println!(
                            "Hinweis: Eine Profil-Aenderung wartet und wird beim naechsten \
                             App-Start uebernommen."
                        );
                    }
                }
                0
            }
            Some(token) => {
                // Nur opake Tokens (wie im Onboarding-Befehl): Klartext-Rollen werden
                // bewusst abgelehnt, sonst koennte sich jeder per CLI auf it_admin
                // heben. Das Token steuert ohnehin nur die sichtbaren Kacheln, echten
                // Zugriff erzwingt die NetBird-Gruppe.
                let Some(role) = profile::role_for_token(&token) else {
                    eprintln!(
                        "Unbekanntes Profil-Token. Das Token bekommst du vom IT-Admin \
                         (identisch zum Onboarding-Befehl)."
                    );
                    return 2;
                };
                let Some(path) = profile::profile_bootstrap_path() else {
                    eprintln!("Kein Konfigurationsverzeichnis gefunden.");
                    return 1;
                };
                if let Some(parent) = path.parent() {
                    let _ = std::fs::create_dir_all(parent);
                }
                if let Err(e) = std::fs::write(&path, token.trim()) {
                    eprintln!("Profil konnte nicht geschrieben werden: {e}");
                    return 1;
                }
                println!(
                    "Profil '{role}' vorgemerkt. Die App uebernimmt es beim naechsten Start."
                );
                0
            }
        },
        Command::Update => update_app(cli.json).await,
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

// ============================================================================
//  update: App (und CLI) headless aktualisieren - fuer Level/RMM ueber jeden Client
// ============================================================================

/// Basis-URL fuer die gehosteten Rollout-Skripte aus dem Branding ableiten
/// (Scheme+Host von newsUrl), damit `update` white-label bleibt statt auf
/// NKK-URLs hartkodiert. Ergebnis z.B. https://api.secure.nkk-hb.de/download/<script>.
#[cfg(not(all(unix, not(target_os = "macos"))))]
fn update_script_url(script: &str) -> Option<String> {
    let news = load_branding()?.news_url?;
    let scheme_end = news.find("://")? + 3;
    let host_end = news[scheme_end..]
        .find('/')
        .map(|i| scheme_end + i)
        .unwrap_or(news.len());
    Some(format!("{}/download/{}", &news[..host_end], script))
}

/// Windows: den gehosteten Rollout DETACHED starten (Variante A). Der Installer
/// muss die laufende nkk-secure.exe ersetzen koennen - deshalb kehren wir sofort
/// zurueck (kein Self-Replace-Lock). Level prueft danach mit `nkk-secure version`.
#[cfg(target_os = "windows")]
async fn update_app(_json: bool) -> i32 {
    use std::os::windows::process::CommandExt;
    let Some(url) = update_script_url("update-all-windows.ps1") else {
        eprintln!("Kein Update-Endpunkt im Branding hinterlegt (newsUrl fehlt).");
        return 1;
    };
    let cmd = format!(
        "[Net.ServicePointManager]::SecurityProtocol=3072; irm '{url}' | iex"
    );
    // DETACHED_PROCESS | CREATE_NEW_PROCESS_GROUP: laeuft nach unserem Exit weiter.
    match std::process::Command::new("powershell")
        .args(["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", &cmd])
        .creation_flags(0x0000_0008 | 0x0000_0200)
        .spawn()
    {
        Ok(_) => {
            println!("Update gestartet (laeuft im Hintergrund).");
            println!("Danach mit 'nkk-secure version' die neue Version pruefen.");
            0
        }
        Err(e) => {
            eprintln!("Update-Start fehlgeschlagen: {e}");
            1
        }
    }
}

/// macOS: das gehostete, idempotente Installer-/Updater-Skript starten. Die
/// laufende CLI liegt zwar im App-Bundle, das ersetzt wird, aber unter Unix
/// ueberlebt ein laufendes Binary das Ersetzen (Inode bleibt offen).
#[cfg(target_os = "macos")]
async fn update_app(_json: bool) -> i32 {
    let Some(url) = update_script_url("macos-install.sh") else {
        eprintln!("Kein Update-Endpunkt im Branding hinterlegt (newsUrl fehlt).");
        return 1;
    };
    let script = format!("curl -fsSL '{url}' | bash");
    match std::process::Command::new("bash")
        .args(["-lc", &script])
        .spawn()
    {
        Ok(_) => {
            println!("Update gestartet. Danach 'nkk-secure version' zur Kontrolle.");
            0
        }
        Err(e) => {
            eprintln!("Update-Start fehlgeschlagen: {e}");
            1
        }
    }
}

/// Linux (headless CLI): echtes Self-Update. Standalone-Binary, kein Bundle,
/// also die neue signierte CLI aus dem Release ziehen, minisign gegen den fest
/// eingebackenen Updater-Pubkey pruefen (gleiche Kette wie der GUI-Updater) und
/// atomar ueber sich selbst schreiben. Nur bei bestandener Signatur.
#[cfg(all(unix, not(target_os = "macos")))]
async fn update_app(_json: bool) -> i32 {
    use base64::Engine;
    use minisign_verify::{PublicKey, Signature};

    let Some(manifest) = curl_text(nkk_core::updater::UPDATER_MANIFEST_URL).await else {
        eprintln!("Konnte latest.json nicht laden.");
        return 1;
    };
    let v: serde_json::Value = match serde_json::from_str(&manifest) {
        Ok(v) => v,
        Err(e) => {
            eprintln!("latest.json ungueltig: {e}");
            return 1;
        }
    };
    let latest = v.get("version").and_then(|x| x.as_str()).unwrap_or("");
    if latest.is_empty() {
        eprintln!("latest.json ohne version.");
        return 1;
    }
    let cur = env!("CARGO_PKG_VERSION");
    if version_ge(cur, latest) {
        println!("Bereits aktuell ({cur}).");
        return 0;
    }
    let Some(plat) = v.pointer("/platforms/linux-x86_64") else {
        eprintln!(
            "Kein linux-x86_64-Eintrag in latest.json - die Linux-CLI wird serverseitig \
             (CI) noch nicht als signiertes Release-Asset publiziert."
        );
        return 1;
    };
    let url = plat.get("url").and_then(|x| x.as_str()).unwrap_or("");
    let sig_b64 = plat.get("signature").and_then(|x| x.as_str()).unwrap_or("");
    if url.is_empty() || sig_b64.is_empty() {
        eprintln!("linux-Eintrag in latest.json unvollstaendig.");
        return 1;
    }

    let exe = match std::env::current_exe() {
        Ok(p) => p,
        Err(e) => {
            eprintln!("Eigenen Pfad nicht ermittelbar: {e}");
            return 1;
        }
    };
    let dir = exe.parent().map(|p| p.to_path_buf()).unwrap_or_default();
    let tmp = dir.join(format!(".nkk-secure.update.{}", std::process::id()));

    if !curl_download(url, &tmp).await {
        eprintln!("Download fehlgeschlagen.");
        let _ = std::fs::remove_file(&tmp);
        return 1;
    }
    let data = match std::fs::read(&tmp) {
        Ok(d) => d,
        Err(e) => {
            eprintln!("Konnte heruntergeladene Datei nicht lesen: {e}");
            let _ = std::fs::remove_file(&tmp);
            return 1;
        }
    };
    let verified = (|| -> Option<()> {
        let pk = public_key()?;
        let sig_text = base64::engine::general_purpose::STANDARD
            .decode(sig_b64)
            .ok()
            .and_then(|b| String::from_utf8(b).ok())?;
        let sig = Signature::decode(&sig_text).ok()?;
        pk.verify(&data, &sig, false).ok()
    })();
    if verified.is_none() {
        eprintln!("Signaturpruefung fehlgeschlagen - Update NICHT uebernommen.");
        let _ = std::fs::remove_file(&tmp);
        return 1;
    }

    use std::os::unix::fs::PermissionsExt;
    let _ = std::fs::set_permissions(&tmp, std::fs::Permissions::from_mode(0o755));
    // Atomarer Replace (gleiche Datei-Systeme, da im selben Verzeichnis). Ein
    // laufendes Binary darf unter Unix ersetzt werden (Inode bleibt offen).
    match std::fs::rename(&tmp, &exe) {
        Ok(()) => {
            println!("Aktualisiert auf {latest}.");
            0
        }
        Err(e) => {
            eprintln!("Ersetzen fehlgeschlagen (Rechte/Dateisystem?): {e}");
            let _ = std::fs::remove_file(&tmp);
            1
        }
    }
    // Hinweis: PublicKey/Signature/Engine oben genutzt.
}

#[cfg(all(unix, not(target_os = "macos")))]
fn public_key() -> Option<minisign_verify::PublicKey> {
    use base64::Engine;
    let file = base64::engine::general_purpose::STANDARD
        .decode(nkk_core::updater::UPDATER_PUBKEY_B64)
        .ok()?;
    let text = String::from_utf8(file).ok()?;
    // minisign-Ed25519-Pubkeys beginnen mit "RW" (die Zeile ohne Kommentar).
    let key_line = text.lines().find(|l| l.trim_start().starts_with("RW"))?;
    minisign_verify::PublicKey::from_base64(key_line.trim()).ok()
}

#[cfg(all(unix, not(target_os = "macos")))]
async fn curl_text(url: &str) -> Option<String> {
    let out = tokio::process::Command::new("curl")
        .args(["-fsSL", "--max-time", "20", url])
        .output()
        .await
        .ok()?;
    if out.status.success() {
        String::from_utf8(out.stdout).ok()
    } else {
        None
    }
}

#[cfg(all(unix, not(target_os = "macos")))]
async fn curl_download(url: &str, out: &std::path::Path) -> bool {
    tokio::process::Command::new("curl")
        .args([
            "-fL",
            "--retry",
            "5",
            "--retry-delay",
            "2",
            "--connect-timeout",
            "30",
            "-o",
        ])
        .arg(out)
        .arg(url)
        .status()
        .await
        .map(|s| s.success())
        .unwrap_or(false)
}

/// x.y.z-Vergleich a >= b (keine Semver-Crate noetig, Versionen sind rein numerisch).
#[cfg(all(unix, not(target_os = "macos")))]
fn version_ge(a: &str, b: &str) -> bool {
    fn parse(v: &str) -> (u64, u64, u64) {
        let mut it = v
            .trim()
            .trim_start_matches('v')
            .split('.')
            .map(|x| x.parse::<u64>().unwrap_or(0));
        (
            it.next().unwrap_or(0),
            it.next().unwrap_or(0),
            it.next().unwrap_or(0),
        )
    }
    parse(a) >= parse(b)
}

#[tokio::main]
async fn main() {
    let cli = Cli::parse();
    std::process::exit(run(cli).await);
}
