//! Tauri-free core for NKK Secure Access.
//!
//! Single source of truth shared by the desktop app (`src-tauri`) and the
//! headless CLI (`nkk-cli`): NetBird operations, branding, logging and the
//! error type. Nothing here depends on Tauri, so the GUI and the CLI build
//! against the exact same implementation and cannot drift apart.

pub mod branding;
pub mod error;
pub mod logging;
pub mod netbird;
