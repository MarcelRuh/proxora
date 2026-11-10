mod legacy_install;
mod prefs;
mod titlebar;
mod url_util;

use prefs::Prefs;
use serde::Serialize;
use std::sync::Mutex;
use tauri::menu::{MenuBuilder, MenuItem, PredefinedMenuItem, SubmenuBuilder};
use tauri::{Manager, State, WebviewUrl, WebviewWindowBuilder};
use tauri_plugin_opener::OpenerExt;
use tauri_plugin_updater::UpdaterExt;
use url::Url;
use url_util::{is_setup_url, normalize_server_url, same_origin};

struct AppState {
  prefs: Mutex<Prefs>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct PrefsDto {
  server_url: Option<String>,
  allow_insecure_tls: bool,
  legacy_install: Option<legacy_install::LegacyInstallHint>,
  app_version: String,
}

fn apply_insecure_env(allow: bool) {
  // WebView2 reads this before the controller starts (Windows).
  if allow {
    std::env::set_var(
      "WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS",
      "--ignore-certificate-errors",
    );
  } else {
    std::env::remove_var("WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS");
  }
}

fn setup_nav_url() -> Url {
  // Custom protocol host used by Tauri 2 desktop webviews.
  Url::parse("http://tauri.localhost/index.html").expect("setup url")
}

fn setup_nav_url_with_error(code: &str) -> Url {
  let mut url = setup_nav_url();
  url.query_pairs_mut().append_pair("error", code);
  url
}

fn is_webview_error_url(url: &str) -> bool {
  let lower = url.to_ascii_lowercase();
  lower.starts_with("chrome-error:")
    || lower.starts_with("edge-error:")
    || lower.contains("chromewebdata")
    || lower.starts_with("about:neterror")
    || lower.starts_with("data:text/html,chromewebdata")
}

/// Fallback channel when the current document has no valid Origin (WebView error pages).
/// Titlebar uses `proxora-desktop://action` so Rust can handle it without IPC.
fn handle_desktop_scheme(app: &tauri::AppHandle, url: &str) -> bool {
  let Ok(parsed) = Url::parse(url) else {
    return false;
  };
  if parsed.scheme() != "proxora-desktop" {
    return false;
  }
  let action = parsed.host_str().unwrap_or("").to_ascii_lowercase();
  match action.as_str() {
    "change-server" => {
      let _ = clear_server_internal(app);
    }
    "check-updates" => {
      spawn_update_check(app, true);
    }
    "reload" => {
      if let Some(window) = app.get_webview_window("main") {
        let _ = window.reload();
      }
    }
    "minimize" => {
      if let Some(window) = app.get_webview_window("main") {
        let _ = window.minimize();
      }
    }
    "toggle-maximize" => {
      if let Some(window) = app.get_webview_window("main") {
        if window.is_maximized().unwrap_or(false) {
          let _ = window.unmaximize();
        } else {
          let _ = window.maximize();
        }
      }
    }
    "close" => {
      if let Some(window) = app.get_webview_window("main") {
        let _ = window.close();
      }
    }
    "start-dragging" => {
      if let Some(window) = app.get_webview_window("main") {
        let _ = window.start_dragging();
      }
    }
    _ => {}
  }
  true
}

fn navigate_main(app: &tauri::AppHandle, target: Url) -> Result<(), String> {
  let window = app
    .get_webview_window("main")
    .ok_or_else(|| "Main window missing".to_string())?;
  window.navigate(target).map_err(|e| e.to_string())
}

fn open_server(app: &tauri::AppHandle, server_url: &str, last_page: Option<&str>) -> Result<(), String> {
  let target = last_page
    .filter(|p| same_origin(p, server_url))
    .unwrap_or(server_url);
  let parsed = Url::parse(target).map_err(|e| e.to_string())?;
  navigate_main(app, parsed)
}

fn eval_main(app: &tauri::AppHandle, js: &str) {
  if let Some(window) = app.get_webview_window("main") {
    let _ = window.eval(js);
  }
}

fn emit_update_event(app: &tauri::AppHandle, detail: serde_json::Value) {
  // Mirror onto ProxoraDesktop and dispatch a CustomEvent the titlebar listens to.
  let js = format!(
    r#"(function(d){{try{{window.ProxoraDesktop=Object.assign(window.ProxoraDesktop||{{}},{{lastUpdate:d}});}}catch(e){{}}try{{window.dispatchEvent(new CustomEvent('proxora-update',{{detail:d}}));}}catch(e){{}}}})({detail});"#,
    detail = detail
  );
  eval_main(app, &js);
}

async fn run_update_check(app: tauri::AppHandle, interactive: bool) {
  let updater = match app.updater() {
    Ok(u) => u,
    Err(err) => {
      if interactive {
        emit_update_event(
          &app,
          serde_json::json!({ "status": "error", "message": err.to_string() }),
        );
      }
      return;
    }
  };

  match updater.check().await {
    Ok(Some(update)) => {
      let version = update.version.clone();
      emit_update_event(
        &app,
        serde_json::json!({ "status": "available", "version": version }),
      );
      if let Err(err) = update.download_and_install(|_, _| {}, || {}).await {
        emit_update_event(
          &app,
          serde_json::json!({ "status": "error", "message": err.to_string() }),
        );
        return;
      }
      emit_update_event(
        &app,
        serde_json::json!({ "status": "installed", "version": version }),
      );
      app.restart();
    }
    Ok(None) => {
      if interactive {
        emit_update_event(&app, serde_json::json!({ "status": "upToDate" }));
      }
    }
    Err(err) => {
      if interactive {
        emit_update_event(
          &app,
          serde_json::json!({ "status": "error", "message": err.to_string() }),
        );
      }
    }
  }
}

fn spawn_update_check(app: &tauri::AppHandle, interactive: bool) {
  let handle = app.clone();
  tauri::async_runtime::spawn(async move {
    run_update_check(handle, interactive).await;
  });
}

#[tauri::command]
fn get_prefs(state: State<'_, AppState>) -> PrefsDto {
  let prefs = state.prefs.lock().expect("prefs lock");
  PrefsDto {
    server_url: prefs.server_url.clone(),
    allow_insecure_tls: prefs.allow_insecure_tls,
    legacy_install: legacy_install::detect(),
    app_version: env!("CARGO_PKG_VERSION").to_string(),
  }
}

#[tauri::command]
fn save_server(
  app: tauri::AppHandle,
  state: State<'_, AppState>,
  url: String,
  allow_insecure_tls: bool,
) -> Result<(), String> {
  let normalized = normalize_server_url(&url)?;
  let mut prefs = state.prefs.lock().expect("prefs lock");
  let changed = prefs.server_url.as_deref() != Some(normalized.as_str());
  if changed {
    prefs::clear_session_fields(&mut prefs);
  }
  prefs.server_url = Some(normalized.clone());
  prefs.allow_insecure_tls = allow_insecure_tls;
  prefs::save(&prefs)?;
  apply_insecure_env(allow_insecure_tls);
  drop(prefs);
  open_server(&app, &normalized, None)
}

#[tauri::command]
fn clear_server(app: tauri::AppHandle, state: State<'_, AppState>) -> Result<(), String> {
  let _ = state;
  clear_server_internal(&app)
}

#[tauri::command]
fn check_for_updates(app: tauri::AppHandle) -> Result<(), String> {
  spawn_update_check(&app, true);
  Ok(())
}

#[tauri::command]
fn desktop_minimize(window: tauri::WebviewWindow) -> Result<(), String> {
  window.minimize().map_err(|e| e.to_string())
}

#[tauri::command]
fn desktop_toggle_maximize(window: tauri::WebviewWindow) -> Result<bool, String> {
  let maximized = window.is_maximized().map_err(|e| e.to_string())?;
  if maximized {
    window.unmaximize().map_err(|e| e.to_string())?;
  } else {
    window.maximize().map_err(|e| e.to_string())?;
  }
  window.is_maximized().map_err(|e| e.to_string())
}

#[tauri::command]
fn desktop_close(window: tauri::WebviewWindow) -> Result<(), String> {
  window.close().map_err(|e| e.to_string())
}

#[tauri::command]
fn desktop_start_dragging(window: tauri::WebviewWindow) -> Result<(), String> {
  window.start_dragging().map_err(|e| e.to_string())
}

#[tauri::command]
fn desktop_is_maximized(window: tauri::WebviewWindow) -> Result<bool, String> {
  window.is_maximized().map_err(|e| e.to_string())
}

fn clear_server_internal(app: &tauri::AppHandle) -> Result<(), String> {
  let state = app.state::<AppState>();
  let mut prefs = state.prefs.lock().expect("prefs lock");
  prefs.server_url = None;
  prefs.allow_insecure_tls = false;
  prefs::clear_session_fields(&mut prefs);
  prefs::save(&prefs)?;
  apply_insecure_env(false);
  drop(prefs);
  navigate_main(app, setup_nav_url())
}

fn build_menu(app: &tauri::AppHandle) -> tauri::Result<tauri::menu::Menu<tauri::Wry>> {
  let reload = MenuItem::with_id(app, "reload", "Reload", true, Some("CmdOrCtrl+R"))?;
  let change = MenuItem::with_id(app, "change_server", "Change server…", true, None::<&str>)?;
  let updates = MenuItem::with_id(app, "check_updates", "Check for updates…", true, None::<&str>)?;
  let sep = PredefinedMenuItem::separator(app)?;
  let quit = PredefinedMenuItem::quit(app, Some("Quit"))?;
  let proxora = SubmenuBuilder::new(app, "Proxora")
    .item(&reload)
    .item(&change)
    .item(&updates)
    .item(&sep)
    .item(&quit)
    .build()?;
  MenuBuilder::new(app).item(&proxora).build()
}

#[cfg(target_os = "linux")]
fn attach_insecure_tls_hook(window: &tauri::WebviewWindow, allow: bool) {
  if !allow {
    return;
  }
  let _ = window.with_webview(|webview| {
    use webkit2gtk::WebViewExt;
    let wv = webview.inner();
    wv.connect_load_failed_with_tls_errors(move |view, failing_uri, _cert, _errors| {
      view.load_uri(failing_uri);
      true
    });
  });
}

#[cfg(not(target_os = "linux"))]
fn attach_insecure_tls_hook(_window: &tauri::WebviewWindow, _allow: bool) {}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  let initial = prefs::load();
  apply_insecure_env(initial.allow_insecure_tls);

  tauri::Builder::default()
    .plugin(tauri_plugin_opener::init())
    .plugin(tauri_plugin_updater::Builder::new().build())
    .manage(AppState {
      prefs: Mutex::new(initial),
    })
    .invoke_handler(tauri::generate_handler![
      get_prefs,
      save_server,
      clear_server,
      check_for_updates,
      desktop_minimize,
      desktop_toggle_maximize,
      desktop_close,
      desktop_start_dragging,
      desktop_is_maximized
    ])
    .setup(|app| {
      let handle = app.handle().clone();
      // Native menu remains available when WebView error pages break IPC Origin checks.
      let menu = build_menu(&handle)?;
      app.set_menu(menu)?;

      let prefs = app.state::<AppState>().prefs.lock().expect("prefs lock").clone();

      let app_version = env!("CARGO_PKG_VERSION");
      let desktop_ua = format!(
        "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 ProxoraDesktop/{app_version}"
      );
      // Injected into every page (including the remote Proxora UI) so web code can
      // open external https links without relying on window.open.
      let desktop_bridge = format!(
        r#"window.ProxoraDesktop=Object.assign(window.ProxoraDesktop||{{}},{{version:{version:?},openExternal:function(u){{try{{window.location.assign(String(u||""));}}catch(e){{}}}}}});"#,
        version = app_version
      );

      let mut builder = WebviewWindowBuilder::new(app, "main", WebviewUrl::App("index.html".into()))
        .title("Proxora")
        .inner_size(1280.0, 800.0)
        .min_inner_size(900.0, 600.0)
        .resizable(true)
        .decorations(false)
        .shadow(true)
        .center()
        .user_agent(&desktop_ua)
        .initialization_script(titlebar::TITLEBAR_BOOTSTRAP)
        .initialization_script_for_all_frames(&desktop_bridge)
        .on_page_load({
          let handle = handle.clone();
          move |window, payload| {
            if payload.event() != tauri::webview::PageLoadEvent::Finished {
              return;
            }
            let url = payload.url().to_string();
            if !is_webview_error_url(&url) {
              return;
            }
            // Error pages (DNS/TLS/offline) have no valid Origin → IPC dies.
            // Bounce back to setup so the user can change server / retry.
            let target = setup_nav_url_with_error("unreachable");
            let _ = window.navigate(target);
            let _ = handle;
          }
        })
        .on_navigation({
          let handle = handle.clone();
          move |url| {
            let url = url.to_string();
            if handle_desktop_scheme(&handle, &url) {
              return false;
            }
            if is_setup_url(&url) {
              return true;
            }
            if is_webview_error_url(&url) {
              // Allow the browser error document briefly; on_page_load redirects to setup.
              return true;
            }
            let state = handle.state::<AppState>();
            let server = state.prefs.lock().expect("prefs lock").server_url.clone();
            let Some(server) = server else {
              return is_setup_url(&url);
            };
            if same_origin(&url, &server) {
              let mut prefs = state.prefs.lock().expect("prefs lock");
              prefs.last_page_url = Some(url);
              let _ = prefs::save(&prefs);
              return true;
            }
            let _ = handle.opener().open_url(url, None::<&str>);
            false
          }
        });

      if prefs.allow_insecure_tls {
        builder = builder.additional_browser_args("--ignore-certificate-errors");
      }

      let window = builder.build()?;
      attach_insecure_tls_hook(&window, prefs.allow_insecure_tls);

      if let Some(server) = prefs.server_url.as_deref() {
        let last = prefs.last_page_url.clone();
        let handle = handle.clone();
        let server = server.to_string();
        std::thread::spawn(move || {
          let _ = open_server(&handle, &server, last.as_deref());
        });
      }

      // Quiet background check a few seconds after launch.
      let update_handle = handle.clone();
      std::thread::spawn(move || {
        std::thread::sleep(std::time::Duration::from_secs(4));
        spawn_update_check(&update_handle, false);
      });

      Ok(())
    })
    .on_menu_event(|app, event| match event.id().as_ref() {
      "reload" => {
        if let Some(window) = app.get_webview_window("main") {
          let _ = window.reload();
        }
      }
      "change_server" => {
        let _ = clear_server_internal(app);
      }
      "check_updates" => {
        spawn_update_check(app, true);
      }
      _ => {}
    })
    .run(tauri::generate_context!())
    .expect("error while running Proxora desktop");
}
