//! Detect leftover per-user (%LOCALAPPDATA%\\Proxora) installs after the
//! per-machine (Program Files) NSIS change in 2.4.1.

use serde::Serialize;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LegacyInstallHint {
  /// `self` = this process still runs from LOCALAPPDATA; `sibling` = Program
  /// Files build with an old LOCALAPPDATA copy still present.
  pub kind: &'static str,
  pub path: String,
}

#[cfg(windows)]
pub fn detect() -> Option<LegacyInstallHint> {
  let local = dirs::data_local_dir()?.join("Proxora");
  let legacy_exe = local.join("Proxora.exe");
  if !legacy_exe.is_file() {
    return None;
  }
  let exe = std::env::current_exe().ok()?;
  let exe_l = exe.to_string_lossy().to_ascii_lowercase();
  let path = local.to_string_lossy().to_string();
  if exe_l.contains(r"\appdata\local\proxora\") {
    return Some(LegacyInstallHint {
      kind: "self",
      path,
    });
  }
  if exe_l.contains(r"\program files") {
    return Some(LegacyInstallHint {
      kind: "sibling",
      path,
    });
  }
  None
}

#[cfg(not(windows))]
pub fn detect() -> Option<LegacyInstallHint> {
  None
}
