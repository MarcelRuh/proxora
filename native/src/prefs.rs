use directories::ProjectDirs;
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Prefs {
    pub server_url: String,
    pub allow_insecure_tls: bool,
    pub last_username: String,
}

impl Default for Prefs {
    fn default() -> Self {
        Self {
            server_url: String::new(),
            allow_insecure_tls: false,
            last_username: String::new(),
        }
    }
}

fn prefs_path() -> Option<PathBuf> {
    ProjectDirs::from("app", "Proxora", "proxora-native").map(|d| d.config_dir().join("prefs.json"))
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
    let path = prefs_path().ok_or_else(|| "config dir unavailable".to_string())?;
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let raw = serde_json::to_string_pretty(prefs).map_err(|e| e.to_string())?;
    fs::write(path, raw).map_err(|e| e.to_string())
}
