use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct Prefs {
  pub server_url: Option<String>,
  pub allow_insecure_tls: bool,
  pub last_page_url: Option<String>,
}

fn prefs_path() -> Result<PathBuf, String> {
  let dir = dirs::config_dir()
    .ok_or_else(|| "No config directory".to_string())?
    .join("proxora-desktop");
  fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
  Ok(dir.join("prefs.json"))
}

pub fn load() -> Prefs {
  let Ok(path) = prefs_path() else {
    return Prefs::default();
  };
  let Ok(raw) = fs::read_to_string(path) else {
    return Prefs::default();
  };
  serde_json::from_str(&raw).unwrap_or_default()
}

pub fn save(prefs: &Prefs) -> Result<(), String> {
  let path = prefs_path()?;
  let raw = serde_json::to_string_pretty(prefs).map_err(|e| e.to_string())?;
  fs::write(path, raw).map_err(|e| e.to_string())
}

pub fn clear_session_fields(prefs: &mut Prefs) {
  prefs.last_page_url = None;
}
