mod legacy_install;
mod prefs;
mod url_util;

use prefs::Prefs;
use serde::Serialize;
use std::sync::Mutex;
use tauri::{
  menu::{MenuBuilder, MenuItem, PredefinedMenuItem, SubmenuBuilder},
  Manager, State, WebviewUrl, WebviewWindowBuilder,
};
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
  let payload = serde_json::json!({ "detail": detail });
  let js = format!(
    "window.dispatchEvent(new CustomEvent('proxora-update',{}));",
    payload
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
      check_for_updates
    ])
    .setup(|app| {
      let handle = app.handle().clone();
      let menu = build_menu(&handle)?;
      app.set_menu(menu)?;

      let prefs = app.state::<AppState>().prefs.lock().expect("prefs lock").clone();

      let mut builder = WebviewWindowBuilder::new(app, "main", WebviewUrl::App("index.html".into()))
        .title("Proxora")
        .inner_size(1280.0, 800.0)
        .min_inner_size(900.0, 600.0)
        .resizable(true)
        .center()
        .on_navigation({
          let handle = handle.clone();
          move |url| {
            let url = url.to_string();
            if is_setup_url(&url) {
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
