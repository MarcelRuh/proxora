use directories::ProjectDirs;
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Prefs {
    pub server_url: String,
    pub allow_insecure_tls: bool,
    pub last_username: String,
    /// Keep the session cookie across restarts (the server rate-limits logins).
    pub remember_session: bool,
    /// Stored `pm_session` value. Plain text in the user's config dir.
    pub session_token: Option<String>,
    pub sidebar_collapsed: bool,
    pub ui_scale: f32,
    pub auto_check_updates: bool,
}

impl Default for Prefs {
    fn default() -> Self {
        Self {
            server_url: String::new(),
            allow_insecure_tls: false,
            last_username: String::new(),
            remember_session: true,
            session_token: None,
            sidebar_collapsed: false,
            ui_scale: 1.0,
            auto_check_updates: true,
        }
    }
}

pub fn config_dir() -> Option<PathBuf> {
    ProjectDirs::from("app", "Proxora", "proxora-native").map(|d| d.config_dir().to_path_buf())
}

fn prefs_path() -> Option<PathBuf> {
    config_dir().map(|d| d.join("prefs.json"))
}

pub fn load() -> Prefs {
    let Some(path) = prefs_path() else {
        return Prefs::default();
    };
    match fs::read_to_string(&path) {
        Ok(raw) => serde_json::from_str(&raw).unwrap_or_default(),
        Err(_) => Prefs::default(),
    }
}

pub fn save(prefs: &Prefs) -> Result<(), String> {
    let path = prefs_path().ok_or_else(|| "Konfigurationsordner nicht verfügbar".to_string())?;
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let raw = serde_json::to_string_pretty(prefs).map_err(|e| e.to_string())?;
    fs::write(&path, raw).map_err(|e| e.to_string())?;
    restrict_permissions(&path);
    Ok(())
}

#[cfg(unix)]
fn restrict_permissions(path: &std::path::Path) {
    use std::os::unix::fs::PermissionsExt;
    let _ = fs::set_permissions(path, fs::Permissions::from_mode(0o600));
}

#[cfg(not(unix))]
fn restrict_permissions(_path: &std::path::Path) {}
