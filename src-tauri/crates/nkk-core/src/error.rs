use serde::Serialize;
use thiserror::Error;

#[derive(Debug, Error)]
pub enum AppError {
    #[error("Netbird CLI nicht gefunden. Bitte den Netbird Client von https://netbird.io/download installieren.")]
    NetbirdMissing,

    #[error("Netbird Fehler: {0}")]
    NetbirdCli(String),

    #[error("Netbird Status konnte nicht gelesen werden: {0}")]
    NetbirdParse(String),

    #[error("IO Fehler: {0}")]
    Io(String),

    #[error("Branding Konfiguration ungültig: {0}")]
    Branding(String),

    #[error("Speicher Fehler (Keyring): {0}")]
    Keyring(String),

    #[allow(dead_code)]
    #[error("Diese Aktion wird auf der aktuellen Plattform nicht unterstützt: {0}")]
    Unsupported(String),

    #[error("Interner Fehler: {0}")]
    Internal(String),
}

impl Serialize for AppError {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        serializer.serialize_str(&self.to_string())
    }
}

impl From<std::io::Error> for AppError {
    fn from(e: std::io::Error) -> Self {
        AppError::Io(e.to_string())
    }
}

impl From<serde_json::Error> for AppError {
    fn from(e: serde_json::Error) -> Self {
        AppError::NetbirdParse(e.to_string())
    }
}

impl From<keyring::Error> for AppError {
    fn from(e: keyring::Error) -> Self {
        AppError::Keyring(e.to_string())
    }
}

pub type AppResult<T> = Result<T, AppError>;
