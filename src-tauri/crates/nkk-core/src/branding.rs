use crate::error::{AppError, AppResult};
use serde::{Deserialize, Serialize};
use std::path::Path;
use std::sync::OnceLock;

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct ProductInfo {
    pub name: String,
    #[serde(rename = "shortName")]
    pub short_name: String,
    pub version: String,
    #[serde(default)]
    pub tagline: Option<String>,
    #[serde(rename = "logoText", default)]
    pub logo_text: Option<Vec<String>>,
    /// Friendly name of the network the VPN connects to, e.g. "NKK Netz".
    /// Used in notifications. Falls back to a neutral wording when absent.
    #[serde(rename = "networkName", default)]
    pub network_name: Option<String>,
    /// Optional brand footnotes (e.g. marketing one-liners). Empty = none shown.
    #[serde(default)]
    pub footnotes: Option<Vec<String>>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct VendorInfo {
    pub name: String,
    pub footer: String,
    #[serde(rename = "supportEmail")]
    pub support_email: String,
    #[serde(rename = "supportUrl")]
    pub support_url: String,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct ThemeInfo {
    pub primary: String,
    #[serde(rename = "primaryHover")]
    pub primary_hover: String,
    pub accent: String,
    pub background: String,
    pub foreground: String,
    #[serde(rename = "logoPath")]
    pub logo_path: String,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct NetbirdInfo {
    #[serde(rename = "managementUrl")]
    pub management_url: String,
    #[serde(rename = "adminUrl")]
    pub admin_url: String,
    /// Windows/AD domain pre-filled in the credential dialog (e.g. "NKKHB").
    #[serde(rename = "defaultDomain", default)]
    pub default_domain: Option<String>,
    /// Internal DNS suffix stripped from peer FQDNs in the UI (e.g. "nkk.internal").
    #[serde(rename = "internalDomainSuffix", default)]
    pub internal_domain_suffix: Option<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct QuickLaunchEntry {
    pub label: String,
    #[serde(rename = "type")]
    pub kind: String,
    pub target: String,
    #[serde(default)]
    pub description: Option<String>,
    #[serde(default)]
    pub default: bool,
    #[serde(default)]
    pub icon: Option<String>,
    /// Hidden from the main launch list; only reachable via its hotkey.
    #[serde(default)]
    pub hidden: bool,
    /// Optional Shift+<digit> hotkey (e.g. "1") that launches this entry.
    #[serde(default)]
    pub hotkey: Option<String>,
    /// Optional role gate. "manager" => only the Geschaeftsfuehrer profile sees
    /// this entry; absent/"user" => everyone. White-label tenants can add their
    /// own manager-only targets without code changes.
    #[serde(default)]
    pub role: Option<String>,
}

/// Hidden service-menu gate. The hash protects against accidental employee
/// access, NOT against an attacker with the binary. Online-rotatable via a
/// signed branding update.
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct AdminInfo {
    /// Per-tenant salt (string) mixed into the password hash.
    #[serde(default)]
    pub salt: String,
    /// Lowercase hex SHA-256 of `salt + ":" + password`.
    #[serde(rename = "passwordSha256", default)]
    pub password_sha256: String,
}

/// One command of an installable "level". Prefer `program` + `args` (no shell,
/// no injection). `shell` runs a full command line via cmd /c or sh -c and is
/// only for cases that genuinely need a pipe.
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct LevelStep {
    #[serde(default)]
    pub label: Option<String>,
    #[serde(default)]
    pub program: Option<String>,
    #[serde(default)]
    pub args: Option<Vec<String>>,
    #[serde(default)]
    pub shell: Option<String>,
}

/// A named, ordered set of commands KronSolutions can run from the service menu
/// (and optionally the installer) to install/patch a "level". Defined in the
/// trusted, bundled branding.json; gated behind the admin unlock.
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct LevelDef {
    pub id: String,
    pub label: String,
    #[serde(default)]
    pub description: Option<String>,
    #[serde(default)]
    pub steps: Vec<LevelStep>,
}

/// LAN / path-arbiter facts per tenant (nothing hardcoded). Used to recognise
/// the trusted office network and to detect conflicting multi-path situations.
#[derive(Clone, Debug, Serialize, Deserialize, Default)]
pub struct LanInfo {
    /// Server subnet that must have exactly one path, e.g. "192.168.0.0/24".
    #[serde(rename = "serverSubnet", default)]
    pub server_subnet: Option<String>,
    /// Office Wi-Fi subnet (e.g. VLAN60 "192.168.60.0/24").
    #[serde(rename = "wifiSubnet", default)]
    pub wifi_subnet: Option<String>,
    /// NetBird overlay subnet, e.g. "192.168.240.0/24".
    #[serde(rename = "overlaySubnet", default)]
    pub overlay_subnet: Option<String>,
    /// Expected on-site default gateway IP (optional hint signal).
    #[serde(default)]
    pub gateway: Option<String>,
    /// AD / DNS suffix, e.g. "nkkhb.local" (optional hint signal).
    #[serde(rename = "dnsSuffix", default)]
    pub dns_suffix: Option<String>,
    /// Office Wi-Fi SSID (optional, weak hint; not used on macOS).
    #[serde(default)]
    pub ssid: Option<String>,
    /// Internal anchor host for a reachability probe (e.g. the DC).
    #[serde(rename = "anchorHost", default)]
    pub anchor_host: Option<String>,
    #[serde(rename = "anchorPort", default)]
    pub anchor_port: Option<u16>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct BrandingDto {
    pub product: ProductInfo,
    pub vendor: VendorInfo,
    pub theme: ThemeInfo,
    pub netbird: NetbirdInfo,
    #[serde(rename = "quickLaunch", default)]
    pub quick_launch: Vec<QuickLaunchEntry>,
    #[serde(rename = "newsUrl", default)]
    pub news_url: Option<String>,
    #[serde(rename = "webhookUrl", default)]
    pub webhook_url: Option<String>,
    /// Read from branding.json but never serialized back over IPC to the
    /// webview (skip_serializing), so the hash does not reach the JS context.
    #[serde(default, skip_serializing)]
    pub admin: Option<AdminInfo>,
    /// Installable levels (command bundles). Skip_serializing so the command
    /// lines stay Rust-side; the admin UI lists them via admin_list_levels.
    #[serde(default, skip_serializing)]
    pub levels: Vec<LevelDef>,
    /// LAN / path-arbiter facts (subnets, gateway, anchor, ssid). Used by the
    /// network-context detection; not needed over IPC, so skip_serializing.
    #[serde(default, skip_serializing)]
    pub lan: Option<LanInfo>,
}

static BRANDING_CACHE: OnceLock<BrandingDto> = OnceLock::new();

pub fn load(resource_dir: &Path) -> AppResult<BrandingDto> {
    if let Some(b) = BRANDING_CACHE.get() {
        return Ok(b.clone());
    }
    let candidates = [
        resource_dir.join("resources").join("branding.json"),
        resource_dir.join("branding.json"),
        resource_dir.join("_up_").join("resources").join("branding.json"),
    ];
    let path = candidates
        .iter()
        .find(|p| p.exists())
        .cloned()
        .ok_or_else(|| {
            AppError::Branding(format!(
                "branding.json nicht gefunden. Gesucht unter: {}",
                candidates
                    .iter()
                    .map(|p| p.display().to_string())
                    .collect::<Vec<_>>()
                    .join(", ")
            ))
        })?;

    tracing::info!("Lade Branding aus: {}", path.display());
    let content = std::fs::read_to_string(&path)
        .map_err(|e| AppError::Branding(format!("{}: {}", path.display(), e)))?;
    let mut parsed: BrandingDto =
        serde_json::from_str(&content).map_err(|e| AppError::Branding(e.to_string()))?;
    // Version single-source-of-truth: always reflect the compiled binary
    // (Cargo.toml / CARGO_PKG_VERSION) so branding.json can never drift from the
    // actual build, the updater, or the installer.
    parsed.product.version = env!("CARGO_PKG_VERSION").to_string();
    let _ = BRANDING_CACHE.set(parsed.clone());
    Ok(parsed)
}
