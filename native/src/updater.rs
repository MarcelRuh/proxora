use serde::Deserialize;
use std::fs;
use std::io::Write;
use std::path::PathBuf;
use std::sync::mpsc::{self, Receiver, Sender};
use std::thread;

pub const APP_VERSION: &str = env!("CARGO_PKG_VERSION");
const REPO: &str = "MarcelRuh/proxora";
const USER_AGENT: &str = concat!("ProxoraNative/", env!("CARGO_PKG_VERSION"));

#[derive(Debug, Clone)]
pub struct UpdateInfo {
    pub version: String,
    pub download_url: String,
    pub asset_name: String,
    pub release_url: String,
}

#[derive(Debug, Clone)]
pub enum UpdateState {
    Checking,
    UpToDate,
    Available(UpdateInfo),
    Downloading { info: UpdateInfo, progress: f32 },
    ReadyToInstall { info: UpdateInfo, path: PathBuf },
    Error(String),
}

pub enum UpdateCmd {
    Check,
    Download(UpdateInfo),
    Install { path: PathBuf },
}

pub enum UpdateMsg {
    State(UpdateState),
}

#[derive(Deserialize)]
struct GhRelease {
    tag_name: String,
    html_url: String,
    assets: Vec<GhAsset>,
    #[serde(default)]
    draft: bool,
    #[serde(default)]
    prerelease: bool,
}

#[derive(Deserialize)]
struct GhAsset {
    name: String,
    browser_download_url: String,
}

pub fn spawn() -> (Sender<UpdateCmd>, Receiver<UpdateMsg>) {
    let (cmd_tx, cmd_rx) = mpsc::channel::<UpdateCmd>();
    let (msg_tx, msg_rx) = mpsc::channel::<UpdateMsg>();
    thread::Builder::new()
        .name("proxora-updater".into())
        .spawn(move || updater_loop(cmd_rx, msg_tx))
        .expect("updater worker");
    (cmd_tx, msg_rx)
}

fn updater_loop(cmds: Receiver<UpdateCmd>, out: Sender<UpdateMsg>) {
    let client = reqwest::blocking::Client::builder()
        .user_agent(USER_AGENT)
        .timeout(std::time::Duration::from_secs(60))
        .build()
        .expect("http client");

    while let Ok(cmd) = cmds.recv() {
        match cmd {
            UpdateCmd::Check => {
                let _ = out.send(UpdateMsg::State(UpdateState::Checking));
                match check_for_update(&client) {
                    Ok(Some(info)) => {
                        let _ = out.send(UpdateMsg::State(UpdateState::Available(info)));
                    }
                    Ok(None) => {
                        let _ = out.send(UpdateMsg::State(UpdateState::UpToDate));
                    }
                    Err(e) => {
                        let _ = out.send(UpdateMsg::State(UpdateState::Error(e)));
                    }
                }
            }
            UpdateCmd::Download(info) => {
                let _ = out.send(UpdateMsg::State(UpdateState::Downloading {
                    info: info.clone(),
                    progress: 0.05,
                }));
                match download_update(&client, &info, &out) {
                    Ok(path) => {
                        let _ = out.send(UpdateMsg::State(UpdateState::ReadyToInstall {
                            info,
                            path,
                        }));
                    }
                    Err(e) => {
                        let _ = out.send(UpdateMsg::State(UpdateState::Error(e)));
                    }
                }
            }
            UpdateCmd::Install { path } => {
                if let Err(e) = launch_installer(&path) {
                    let _ = out.send(UpdateMsg::State(UpdateState::Error(e)));
                }
            }
        }
    }
}

fn check_for_update(client: &reqwest::blocking::Client) -> Result<Option<UpdateInfo>, String> {
    let url = format!("https://api.github.com/repos/{REPO}/releases?per_page=20");
    let releases: Vec<GhRelease> = client
        .get(&url)
        .header("Accept", "application/vnd.github+json")
        .send()
        .map_err(|e| e.to_string())?
        .error_for_status()
        .map_err(|e| e.to_string())?
        .json()
        .map_err(|e| e.to_string())?;

    let preferred = preferred_asset_suffix();
    let current =
        parse_semver(APP_VERSION).map_err(|_| "ungültige App-Version".to_string())?;

    let mut best: Option<UpdateInfo> = None;
    for rel in releases {
        if rel.draft || rel.prerelease {
            continue;
        }
        let Some(ver_str) = normalize_tag(&rel.tag_name) else {
            continue;
        };
        let Ok(ver) = parse_semver(&ver_str) else {
            continue;
        };
        if ver <= current {
            continue;
        }
        let Some(asset) = rel
            .assets
            .iter()
            .find(|a| a.name.starts_with("ProxoraNative_") && a.name.contains(preferred))
            .or_else(|| {
                rel.assets
                    .iter()
                    .find(|a| a.name.starts_with("ProxoraNative_") && a.name.ends_with(".exe"))
            })
        else {
            continue;
        };

        let candidate = UpdateInfo {
            version: ver_str,
            download_url: asset.browser_download_url.clone(),
            asset_name: asset.name.clone(),
            release_url: rel.html_url.clone(),
        };
        if best
            .as_ref()
            .map(|b| parse_semver(&b.version).ok())
            .flatten()
            .map(|bv| ver > bv)
            .unwrap_or(true)
        {
            best = Some(candidate);
        }
    }
    Ok(best)
}

fn preferred_asset_suffix() -> &'static str {
    #[cfg(target_os = "windows")]
    {
        "x64-setup.exe"
    }
    #[cfg(all(target_os = "linux", target_arch = "x86_64"))]
    {
        "linux_amd64.tar.gz"
    }
    #[cfg(not(any(
        target_os = "windows",
        all(target_os = "linux", target_arch = "x86_64")
    )))]
    {
        "x64-setup.exe"
    }
}

fn normalize_tag(tag: &str) -> Option<String> {
    let t = tag.trim();
    if let Some(rest) = t.strip_prefix("native-v") {
        return Some(rest.to_string());
    }
    if let Some(rest) = t.strip_prefix('v') {
        // only accept if it looks like semver and release has ProxoraNative assets
        if rest.chars().next().map(|c| c.is_ascii_digit()).unwrap_or(false) {
            return Some(rest.to_string());
        }
    }
    None
}

fn parse_semver(s: &str) -> Result<(u64, u64, u64), ()> {
    let clean = s.split('-').next().unwrap_or(s).trim_start_matches('v');
    let mut parts = clean.split('.');
    let major = parts.next().ok_or(())?.parse().map_err(|_| ())?;
    let minor = parts.next().unwrap_or("0").parse().map_err(|_| ())?;
    let patch = parts.next().unwrap_or("0").parse().map_err(|_| ())?;
    Ok((major, minor, patch))
}

fn download_update(
    client: &reqwest::blocking::Client,
    info: &UpdateInfo,
    out: &Sender<UpdateMsg>,
) -> Result<PathBuf, String> {
    let mut resp = client
        .get(&info.download_url)
        .send()
        .map_err(|e| e.to_string())?
        .error_for_status()
        .map_err(|e| e.to_string())?;

    let total = resp.content_length().unwrap_or(0);
    let dir = std::env::temp_dir().join("proxora-native-update");
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let path = dir.join(&info.asset_name);
    let mut file = fs::File::create(&path).map_err(|e| e.to_string())?;

    let mut downloaded: u64 = 0;
    let mut buf = [0u8; 64 * 1024];
    loop {
        let n = {
            use std::io::Read;
            resp.read(&mut buf).map_err(|e| e.to_string())?
        };
        if n == 0 {
            break;
        }
        file.write_all(&buf[..n]).map_err(|e| e.to_string())?;
        downloaded += n as u64;
        let progress = if total > 0 {
            (downloaded as f32 / total as f32).clamp(0.0, 0.99)
        } else {
            0.5
        };
        let _ = out.send(UpdateMsg::State(UpdateState::Downloading {
            info: info.clone(),
            progress,
        }));
    }
    file.flush().map_err(|e| e.to_string())?;
    Ok(path)
}

fn launch_installer(path: &PathBuf) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        const DETACHED: u32 = 0x00000008;
        std::process::Command::new(path)
            .creation_flags(DETACHED)
            .spawn()
            .map_err(|e| e.to_string())?;
        // Give the installer a moment, then quit so files can be replaced.
        std::thread::spawn(|| {
            std::thread::sleep(std::time::Duration::from_millis(400));
            std::process::exit(0);
        });
        return Ok(());
    }
    #[cfg(not(target_os = "windows"))]
    {
        // Open release artifact location / extract hint for Linux users.
        let _ = std::process::Command::new("xdg-open").arg(path).spawn();
        Ok(())
    }
}

pub fn open_url(url: &str) {
    #[cfg(target_os = "windows")]
    {
        let _ = std::process::Command::new("cmd")
            .args(["/C", "start", "", url])
            .spawn();
    }
    #[cfg(target_os = "linux")]
    {
        let _ = std::process::Command::new("xdg-open").arg(url).spawn();
    }
    #[cfg(target_os = "macos")]
    {
        let _ = std::process::Command::new("open").arg(url).spawn();
    }
}
