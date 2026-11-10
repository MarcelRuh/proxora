//! Guest file manager (QEMU agent or SFTP), embedded in the guest inspector.

use super::guests::GuestKey;
use crate::app::dialog::form_modal;
use crate::app::shared::Shared;
use crate::net::{query, ApiError, ApiResult, Client, FileEntry, FileList, FileRead, Kind, Pending, TransferTicket};
use crate::theme::{self, c};
use crate::ui::format;
use crate::ui::widgets::{self as w, Btn};
use base64::Engine;
use eframe::egui::{self, Align, Layout, Sense, Ui};
use egui_phosphor::regular as ph;
use serde_json::{json, Value};
use std::path::PathBuf;

const B64: base64::engine::GeneralPurpose = base64::engine::general_purpose::STANDARD;
const QUICK: &[&str] = &["/", "/root", "/home", "/etc", "/var/log", "/tmp", "/opt"];

#[derive(Clone, Copy, PartialEq, Eq)]
enum Via {
    Agent,
    Sftp,
}

struct Editor {
    path: String,
    content: String,
    original: String,
    loading: Option<Pending<ApiResult<FileRead>>>,
    error: Option<String>,
}

pub struct FileBrowser {
    key: GuestKey,
    via: Via,
    agent_possible: bool,
    ips: Vec<String>,
    target: String,
    port: String,
    username: String,
    password: String,
    private_key: String,
    passphrase: String,
    connected: bool,
    path: String,
    listing: Option<Pending<ApiResult<FileList>>>,
    entries: Vec<FileEntry>,
    error: Option<String>,
    editor: Option<Editor>,
    rename: Option<(FileEntry, String)>,
    new_folder: Option<String>,
    new_file: Option<String>,
}

impl FileBrowser {
    pub fn new(key: GuestKey, ips: Vec<String>, agent_running: bool) -> Self {
        let agent_possible = key.kind == Kind::Vm && agent_running;
        Self {
            via: if agent_possible { Via::Agent } else { Via::Sftp },
            agent_possible,
            target: ips.first().cloned().unwrap_or_default(),
            ips,
            key,
            port: "22".into(),
            username: "root".into(),
            password: String::new(),
            private_key: String::new(),
            passphrase: String::new(),
            connected: false,
            path: "/root".into(),
            listing: None,
            entries: Vec::new(),
            error: None,
            editor: None,
            rename: None,
            new_folder: None,
            new_file: None,
        }
    }

    fn files_path(&self) -> String {
        format!("{}/files", self.key.path())
    }

    fn body(&self, op: &str, path: &str) -> Value {
        let mut b = json!({ "op": op, "path": path });
        match self.via {
            Via::Agent => b["via"] = json!("agent"),
            Via::Sftp => {
                b["via"] = json!("sftp");
                b["target"] = json!(self.target.trim());
                b["port"] = json!(self.port.trim().parse::<u16>().unwrap_or(22));
                b["username"] = json!(self.username.trim());
                if !self.private_key.trim().is_empty() {
                    b["privateKey"] = json!(self.private_key);
                    if !self.passphrase.is_empty() {
                        b["passphrase"] = json!(self.passphrase);
                    }
                } else {
                    b["password"] = json!(self.password);
                }
            }
        }
        b
    }

    fn refresh(&mut self, sh: &Shared) {
        let client = sh.client.clone();
        let path = self.files_path();
        let body = self.body("list", &self.path);
        self.error = None;
        self.listing = Some(Pending::spawn(&sh.ctx, move || client.post::<FileList>(&path, &body)));
    }

    fn cd(&mut self, sh: &Shared, path: &str) {
        self.path = if path.is_empty() { "/".into() } else { path.to_owned() };
        self.refresh(sh);
    }

    pub fn ui(&mut self, ui: &mut Ui, sh: &mut Shared) {
        if let Some(res) = self.listing.as_ref().and_then(Pending::poll) {
            self.listing = None;
            match res {
                Ok(list) => {
                    self.connected = true;
                    self.path = list.path;
                    let mut entries = list.entries;
                    entries.sort_by(|a, b| (b.kind == "dir").cmp(&(a.kind == "dir")).then(a.name.to_lowercase().cmp(&b.name.to_lowercase())));
                    self.entries = entries;
                }
                Err(err) => self.error = Some(err.message),
            }
        }
        let can_write = {
            let host = sh.host(&self.key.host_id);
            sh.user.can_guest(host, &self.key.host_id, self.key.kind, self.key.vmid, &self.key.kind.perm("files.write"))
        };

        if !self.connected {
            self.connect_form(ui, sh);
            return;
        }

        // Toolbar
        ui.horizontal(|ui| {
            w::badge(ui, if self.via == Via::Agent { "Guest Agent" } else { "SFTP" }, c::CYAN);
            if ui.add(Btn::icon_only(ph::ARROW_LEFT, "Ebene hoch").small()).clicked() {
                let parent = parent_of(&self.path);
                self.cd(sh, &parent);
            }
            if ui.add(Btn::icon_only(ph::ARROW_CLOCKWISE, "Neu laden").small().loading(self.listing.is_some())).clicked() {
                self.refresh(sh);
            }
            let mut acc = String::new();
            let mut go: Option<String> = None;
            if ui.add(egui::Label::new(w::mono("/")).sense(Sense::click())).clicked() {
                go = Some("/".into());
            }
            for part in self.path.split('/').filter(|p| !p.is_empty()) {
                acc.push('/');
                acc.push_str(part);
                if ui.add(egui::Label::new(w::mono(format!("{part}/"))).sense(Sense::click())).clicked() {
                    go = Some(acc.clone());
                }
            }
            if let Some(p) = go {
                self.cd(sh, &p);
            }
        });
        ui.horizontal(|ui| {
            for q in QUICK {
                if ui.add(Btn::ghost(q).small().selected(self.path == *q)).clicked() {
                    self.cd(sh, q);
                }
            }
        });
        ui.horizontal(|ui| {
            if ui.add(Btn::secondary("Hochladen").icon(ph::UPLOAD_SIMPLE).small().enabled(can_write)).clicked() {
                self.upload(sh);
            }
            if ui.add(Btn::secondary("Ordner").icon(ph::FOLDER_SIMPLE).small().enabled(can_write)).clicked() {
                self.new_folder = Some(String::new());
            }
            if ui.add(Btn::secondary("Neue Datei").icon(ph::FILE).small().enabled(can_write)).clicked() {
                self.new_file = Some(String::new());
            }
            ui.with_layout(Layout::right_to_left(Align::Center), |ui| {
                if ui.add(Btn::ghost("Trennen").small()).clicked() {
                    self.connected = false;
                }
            });
        });
        ui.add_space(6.0);
        if let Some(err) = self.error.clone() {
            w::callout(ui, ph::WARNING_CIRCLE, c::DANGER, &err);
            ui.add_space(6.0);
        }

        let mut open_dir: Option<String> = None;
        let mut edit: Option<String> = None;
        let mut download: Option<FileEntry> = None;
        let mut delete: Option<FileEntry> = None;
        let mut rename: Option<FileEntry> = None;
        if self.entries.is_empty() && self.listing.is_none() {
            ui.label(w::muted("Ordner ist leer."));
        }
        for e in &self.entries {
            let is_dir = e.kind == "dir";
            let (rect, resp) = ui.allocate_exact_size(egui::vec2(ui.available_width(), 30.0), Sense::click());
            if resp.hovered() {
                ui.painter().rect_filled(rect, 3.0, c::HOVER);
            }
            let icon = if is_dir { ph::FOLDER } else { ph::FILE };
            let color = if is_dir { c::PURPLE } else { c::MUTED };
            ui.painter().text(rect.left_center() + egui::vec2(12.0, 0.0), egui::Align2::CENTER_CENTER, icon, theme::icon_font(15.0), color);
            ui.painter().text(rect.left_center() + egui::vec2(28.0, 0.0), egui::Align2::LEFT_CENTER, &e.name, theme::regular(13.0), c::TEXT);
            let meta = if is_dir {
                String::new()
            } else {
                format!("{}  ·  {}", format::bytes(e.size), e.mtime.map(|m| format::unix_time((m / 1000) as i64)).unwrap_or_default())
            };
            ui.painter().text(rect.right_center() - egui::vec2(96.0, 0.0), egui::Align2::RIGHT_CENTER, meta, theme::mono(11.0), c::MUTED);
            let mut child = ui.new_child(egui::UiBuilder::new().max_rect(rect.shrink2(egui::vec2(4.0, 1.0))).layout(Layout::right_to_left(Align::Center)));
            if !is_dir && child.add(Btn::icon_only(ph::DOWNLOAD_SIMPLE, "Herunterladen").small()).clicked() {
                download = Some(e.clone());
            }
            if can_write && child.add(Btn::icon_only(ph::TRASH, "Löschen").small()).clicked() {
                delete = Some(e.clone());
            }
            if can_write && child.add(Btn::icon_only(ph::PENCIL_SIMPLE, "Umbenennen").small()).clicked() {
                rename = Some(e.clone());
            }
            if resp.clicked() {
                if is_dir {
                    open_dir = Some(e.path.clone());
                } else {
                    edit = Some(e.path.clone());
                }
            }
        }
        if let Some(p) = open_dir {
            self.cd(sh, &p);
        }
        if let Some(p) = edit {
            self.open_editor(sh, &p);
        }
        if let Some(e) = download {
            self.download(sh, &e);
        }
        if let Some(e) = rename {
            let name = e.name.clone();
            self.rename = Some((e, name));
        }
        if let Some(e) = delete {
            let body = self.body("delete", &e.path);
            let path = self.files_path();
            sh.confirm(
                format!("„{}“ löschen?", e.name),
                if e.kind == "dir" { "Der Ordner wird samt Inhalt gelöscht." } else { "Die Datei wird endgültig gelöscht." },
                "Löschen",
                true,
                move |sh| sh.run("files:delete", "Gelöscht", &[], move |c| c.post::<Value>(&path, &body)),
            );
            self.refresh_later(sh);
        }
        self.dialogs(ui.ctx(), sh);
    }

    fn refresh_later(&mut self, sh: &Shared) {
        // Small delay so the server-side op is visible in the listing.
        let client = sh.client.clone();
        let path = self.files_path();
        let body = self.body("list", &self.path);
        self.listing = Some(Pending::spawn(&sh.ctx, move || {
            std::thread::sleep(std::time::Duration::from_millis(900));
            client.post::<FileList>(&path, &body)
        }));
    }

    fn connect_form(&mut self, ui: &mut Ui, sh: &mut Shared) {
        w::section(ui, "Dateizugriff", |_| {}, |ui| {
            if self.key.kind == Kind::Vm {
                ui.horizontal(|ui| {
                    if ui.add(Btn::secondary("Guest Agent").small().selected(self.via == Via::Agent).enabled(self.agent_possible)).on_disabled_hover_text("VM muss laufen und der QEMU Guest Agent aktiv sein").clicked() {
                        self.via = Via::Agent;
                    }
                    if ui.add(Btn::secondary("SFTP").small().selected(self.via == Via::Sftp)).clicked() {
                        self.via = Via::Sftp;
                    }
                });
                ui.add_space(8.0);
            }
            if self.via == Via::Agent {
                ui.label(w::secondary("Zugriff über den QEMU Guest Agent — keine Zugangsdaten nötig, Dateien bis 48 KiB."));
            } else {
                egui::Grid::new("sftp_form").num_columns(2).spacing([12.0, 8.0]).show(ui, |ui| {
                    ui.label(w::label("Adresse"));
                    ui.horizontal(|ui| {
                        w::text_input(ui, &mut self.target, "IP des Gasts", 160.0);
                        if self.ips.len() > 1 {
                            let opts: Vec<(String, String)> = self.ips.iter().map(|i| (i.clone(), i.clone())).collect();
                            w::combo(ui, "sftp_ip", &mut self.target, &opts, 140.0);
                        }
                    });
                    ui.end_row();
                    ui.label(w::label("Port"));
                    w::text_input(ui, &mut self.port, "22", 70.0);
                    ui.end_row();
                    ui.label(w::label("Benutzer"));
                    w::text_input(ui, &mut self.username, "root", 160.0);
                    ui.end_row();
                    ui.label(w::label("Passwort"));
                    w::password_input(ui, &mut self.password, "", 220.0);
                    ui.end_row();
                    ui.label(w::label("Private Key"));
                    ui.add(egui::TextEdit::multiline(&mut self.private_key).desired_rows(2).hint_text("optional, PEM").font(theme::mono(11.0)).desired_width(260.0));
                    ui.end_row();
                    if !self.private_key.trim().is_empty() {
                        ui.label(w::label("Passphrase"));
                        w::password_input(ui, &mut self.passphrase, "", 220.0);
                        ui.end_row();
                    }
                });
                ui.label(w::small("Der Host-Key wird nicht geprüft. Nur in vertrauenswürdigen Netzen nutzen."));
            }
            if let Some(err) = self.error.clone() {
                ui.add_space(8.0);
                w::callout(ui, ph::WARNING_CIRCLE, c::DANGER, &err);
            }
            ui.add_space(10.0);
            let ready = self.via == Via::Agent || (!self.target.trim().is_empty() && !self.username.trim().is_empty());
            if ui.add(Btn::primary("Verbinden").icon(ph::PLUGS_CONNECTED).enabled(ready).loading(self.listing.is_some())).clicked() {
                if self.via == Via::Agent {
                    self.path = "/".into();
                }
                self.refresh(sh);
            }
        });
    }

    fn open_editor(&mut self, sh: &Shared, path: &str) {
        let client = sh.client.clone();
        let api = self.files_path();
        let body = self.body("read", path);
        self.editor = Some(Editor {
            path: path.to_owned(),
            content: String::new(),
            original: String::new(),
            loading: Some(Pending::spawn(&sh.ctx, move || client.post::<FileRead>(&api, &body))),
            error: None,
        });
    }

    fn download(&mut self, sh: &mut Shared, e: &FileEntry) {
        let Some(dest) = rfd::FileDialog::new().set_file_name(&e.name).save_file() else {
            return;
        };
        let api = self.files_path();
        let name = e.name.clone();
        match self.via {
            Via::Agent => {
                let body = self.body("read", &e.path);
                sh.run("files:download", format!("{name} heruntergeladen"), &[], move |c| {
                    let r: FileRead = c.post(&api, &body)?;
                    let bytes = B64.decode(r.content_base64.as_bytes()).map_err(|e| ApiError::msg(e.to_string()))?;
                    std::fs::write(&dest, bytes).map_err(|e| ApiError::msg(e.to_string()))?;
                    Ok(Value::Null)
                });
            }
            Via::Sftp => {
                let mut body = self.body("transfer-ticket", &e.path);
                body["mode"] = json!("download");
                let base = self.files_path();
                sh.run("files:download", format!("{name} heruntergeladen"), &[], move |c| {
                    let t: TransferTicket = c.post(&api, &body)?;
                    c.download(&format!("{base}/download{}", query(&[("ticket", t.ticket)])), &dest)?;
                    Ok(Value::Null)
                });
            }
        }
    }

    fn upload(&mut self, sh: &mut Shared) {
        let Some(files) = rfd::FileDialog::new().pick_files() else {
            return;
        };
        for file in files {
            let name = file.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_default();
            let target = join(&self.path, &name);
            let api = self.files_path();
            let base = self.files_path();
            match self.via {
                Via::Agent => {
                    let mut body = self.body("write", &target);
                    sh.run("files:upload", format!("{name} hochgeladen"), &[], move |c| {
                        let bytes = std::fs::read(&file).map_err(|e| ApiError::msg(e.to_string()))?;
                        if bytes.len() > 48 * 1024 {
                            return Err(ApiError::msg("Über den Guest Agent sind höchstens 48 KiB möglich — SFTP nutzen."));
                        }
                        body["contentBase64"] = json!(B64.encode(bytes));
                        c.post::<Value>(&api, &body)
                    });
                }
                Via::Sftp => {
                    let mut body = self.body("transfer-ticket", &target);
                    body["mode"] = json!("upload");
                    sh.run("files:upload", format!("{name} hochgeladen"), &[], move |c| upload_sftp(c, &api, &base, &body, &file));
                }
            }
        }
        self.refresh_later(sh);
    }

    fn dialogs(&mut self, ctx: &egui::Context, sh: &mut Shared) {
        if let Some(mut ed) = self.editor.take() {
            if let Some(res) = ed.loading.as_ref().and_then(Pending::poll) {
                ed.loading = None;
                match res {
                    Ok(r) => match B64.decode(r.content_base64.as_bytes()).ok().and_then(|b| String::from_utf8(b).ok()) {
                        Some(text) => {
                            ed.content = text.clone();
                            ed.original = text;
                        }
                        None => ed.error = Some("Binärdatei — bitte herunterladen statt bearbeiten.".into()),
                    },
                    Err(err) => ed.error = Some(err.message),
                }
            }
            let mut save = false;
            let mut cancel = false;
            let title = ed.path.rsplit('/').next().unwrap_or(&ed.path).to_owned();
            let width = (ctx.screen_rect().width() - 200.0).clamp(480.0, 1000.0);
            let closed = form_modal(ctx, "file_editor", &title, width, |ui| {
                ui.label(w::small(ed.path.clone()));
                ui.add_space(6.0);
                if ed.loading.is_some() {
                    w::skeleton(ui, 6);
                } else if let Some(err) = &ed.error {
                    w::callout(ui, ph::WARNING_CIRCLE, c::DANGER, err);
                } else {
                    ui.add(
                        egui::TextEdit::multiline(&mut ed.content)
                            .font(theme::mono(12.5))
                            .code_editor()
                            .desired_rows(24)
                            .desired_width(f32::INFINITY),
                    );
                }
                ui.add_space(10.0);
                ui.horizontal(|ui| {
                    let dirty = ed.content != ed.original;
                    save = ui.add(Btn::primary("Speichern").icon(ph::FLOPPY_DISK).enabled(dirty && ed.error.is_none())).clicked();
                    cancel = ui.add(Btn::secondary("Schließen")).clicked();
                    if dirty {
                        ui.label(w::small("Ungespeicherte Änderungen"));
                    }
                });
            });
            if save {
                let mut body = self.body("write", &ed.path);
                body["contentBase64"] = json!(B64.encode(ed.content.as_bytes()));
                let api = self.files_path();
                ed.original = ed.content.clone();
                sh.run("files:write", "Datei gespeichert", &[], move |c| c.post::<Value>(&api, &body));
            }
            if !(cancel || closed) {
                self.editor = Some(ed);
            }
        }
        if let Some((entry, mut new_name)) = self.rename.take() {
            let mut ok = false;
            let mut cancel = false;
            let closed = form_modal(ctx, "file_rename", "Umbenennen", 360.0, |ui| {
                w::text_input(ui, &mut new_name, "", ui.available_width());
                ui.add_space(10.0);
                ui.horizontal(|ui| {
                    ok = ui.add(Btn::primary("Umbenennen").enabled(!new_name.trim().is_empty())).clicked();
                    cancel = ui.add(Btn::secondary("Abbrechen")).clicked();
                });
            });
            if ok {
                let mut body = self.body("rename", &entry.path);
                body["to"] = json!(join(&parent_of(&entry.path), new_name.trim()));
                let api = self.files_path();
                sh.run("files:rename", "Umbenannt", &[], move |c| c.post::<Value>(&api, &body));
                cancel = true;
            }
            if cancel || closed {
                if ok {
                    self.refresh_later(sh);
                }
            } else {
                self.rename = Some((entry, new_name));
            }
        }
        for (slot, folder) in [(0, true), (1, false)] {
            let state = if slot == 0 { &mut self.new_folder } else { &mut self.new_file };
            let Some(name) = state else { continue };
            let mut ok = false;
            let mut cancel = false;
            let title = if folder { "Neuer Ordner" } else { "Neue Datei" };
            let closed = form_modal(ctx, title, title, 360.0, |ui| {
                w::text_input(ui, name, "Name", ui.available_width());
                ui.add_space(10.0);
                ui.horizontal(|ui| {
                    ok = ui.add(Btn::primary("Anlegen").enabled(!name.trim().is_empty())).clicked();
                    cancel = ui.add(Btn::secondary("Abbrechen")).clicked();
                });
            });
            let name = name.trim().to_owned();
            if ok {
                let target = join(&self.path, &name);
                let mut body = self.body(if folder { "mkdir" } else { "write" }, &target);
                if !folder {
                    body["contentBase64"] = json!("");
                }
                let api = self.files_path();
                sh.run("files:new", format!("{name} angelegt"), &[], move |c| c.post::<Value>(&api, &body));
            }
            if ok || cancel || closed {
                if slot == 0 {
                    self.new_folder = None;
                } else {
                    self.new_file = None;
                }
                if ok {
                    self.refresh_later(sh);
                }
            }
        }
    }
}

fn upload_sftp(c: &Client, api: &str, base: &str, ticket_body: &Value, file: &PathBuf) -> ApiResult<Value> {
    let size = std::fs::metadata(file).map(|m| m.len()).map_err(|e| ApiError::msg(e.to_string()))?;
    let t: TransferTicket = c.post(api, ticket_body)?;
    // Resume a previous partial upload of the same size (server keeps `.proxora-part`).
    let offset = if t.part_size > 0 && t.part_size <= size && t.part_expected_size.is_none_or(|e| e == size) {
        t.part_size
    } else {
        0
    };
    let url = format!("{base}/upload{}", query(&[("ticket", t.ticket)]));
    c.put_file(&url, file, offset, &[("x-proxora-upload-size", size.to_string()), ("x-proxora-upload-offset", offset.to_string())])
}

fn parent_of(path: &str) -> String {
    let trimmed = path.trim_end_matches('/');
    match trimmed.rfind('/') {
        Some(0) | None => "/".into(),
        Some(i) => trimmed[..i].to_owned(),
    }
}

fn join(dir: &str, name: &str) -> String {
    if dir.ends_with('/') {
        format!("{dir}{name}")
    } else {
        format!("{dir}/{name}")
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn path_helpers() {
        assert_eq!(parent_of("/etc/nginx"), "/etc");
        assert_eq!(parent_of("/etc"), "/");
        assert_eq!(join("/", "a"), "/a");
        assert_eq!(join("/root", "a"), "/root/a");
    }
}
