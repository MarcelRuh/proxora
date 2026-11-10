fn main() {
  // Explicit app-command ACL so remote Proxora origins can invoke them.
  // Without this, remote capability scopes deny custom commands.
  tauri_build::try_build(
    tauri_build::Attributes::new().app_manifest(
      tauri_build::AppManifest::new().commands(&[
        "get_prefs",
        "save_server",
        "clear_server",
        "check_for_updates",
        "desktop_minimize",
        "desktop_toggle_maximize",
        "desktop_close",
        "desktop_start_dragging",
        "desktop_is_maximized",
      ]),
    ),
  )
  .expect("failed to run tauri-build");
}
