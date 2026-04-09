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
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct BrandingDto {
    pub product: ProductInfo,
    pub vendor: VendorInfo,
    pub theme: ThemeInfo,
    pub netbird: NetbirdInfo,
    #[serde(rename = "quickLaunch", default)]
    pub quick_launch: Vec<QuickLaunchEntry>,
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
    let parsed: BrandingDto =
        serde_json::from_str(&content).map_err(|e| AppError::Branding(e.to_string()))?;
    let _ = BRANDING_CACHE.set(parsed.clone());
    Ok(parsed)
}
