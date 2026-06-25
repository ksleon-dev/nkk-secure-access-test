use std::path::PathBuf;
use tracing_subscriber::{fmt, prelude::*, EnvFilter};

const APP_DIR: &str = "NKK Secure Access";

pub fn log_dir() -> PathBuf {
    let base = if cfg!(target_os = "windows") {
        std::env::var("APPDATA")
            .map(PathBuf::from)
            .unwrap_or_else(|_| PathBuf::from("."))
    } else if cfg!(target_os = "macos") {
        home_path("Library/Application Support")
    } else {
        home_path(".local/share")
    };
    base.join(APP_DIR).join("logs")
}

fn home_path(suffix: &str) -> PathBuf {
    if let Ok(home) = std::env::var("HOME") {
        PathBuf::from(home).join(suffix)
    } else {
        PathBuf::from(".")
    }
}

pub fn init() {
    let dir = log_dir();
    let _ = std::fs::create_dir_all(&dir);

    let file_appender = tracing_appender::rolling::daily(&dir, "nkk-secure-access.log");
    let (non_blocking, guard) = tracing_appender::non_blocking(file_appender);
    // Keep guard alive for application lifetime so logs are flushed.
    Box::leak(Box::new(guard));

    let filter = EnvFilter::try_from_default_env()
        .unwrap_or_else(|_| EnvFilter::new("info,nkk_secure_access_lib=debug"));

    let _ = tracing_subscriber::registry()
        .with(filter)
        .with(fmt::layer().with_target(false))
        .with(
            fmt::layer()
                .with_writer(non_blocking)
                .with_ansi(false)
                .with_target(false),
        )
        .try_init();
}
