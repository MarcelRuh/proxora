//! Guest inspector: detail pane for one VM / container next to the list.

use super::files::FileBrowser;
use crate::term::TermRequest;
use super::guests::{power_action, GuestKey};
use crate::app::dialog::form_modal;
use crate::app::shared::{Focus, Shared, Tag};
use crate::net::{
    query, seg, vbool, vnum, vstr, ApiError, ApiResult, BackupFile, BackupFilesResponse,
    BackupsResponse, Client, Firewall, GuestDetail, HaInfo, HostStatus, Kind, NextId, Resource,
    TaskInfo,
};
use crate::theme::{self, c};
use crate::ui::format;
use crate::ui::widgets::{self as w, Btn};
use eframe::egui::{self, Align, Layout, RichText, Ui};
use egui_extras::{Column, TableBuilder};
use egui_phosphor::regular as ph;
use serde_json::{json, Map, Value};
use std::collections::BTreeMap;
use std::time::{Duration, Instant};

#[derive(Clone, Copy, PartialEq, Eq)]
enum Tab {
    Overview,
    Config,
    Snapshots,
    Backups,
    Firewall,
    Ha,
    Files,
}

struct CloneDraft {
    newid: String,
    name: String,
    nextid: Option<crate::net::Pending<ApiResult<NextId>>>,
}

struct MigrateDraft {
    target: String,
}

struct DeleteDraft {
    typed: String,
    purge_backups: Vec<(String, bool)>,
}

struct RestoreDraft {
    file: BackupFile,
    storage: String,
    force: bool,
    start_after: bool,
}

struct BackupDraft {
    storage: String,
    mode: String,
}

pub struct GuestInspector {
    pub key: GuestKey,
    tab: Tab,
    detail: Resource<GuestDetail>,
    config: ConfigEditor,
    snap_name: String,
    snap_desc: String,
    firewall: Resource<Firewall>,
    fw: FwDraft,
    ha: Resource<HaInfo>,
    ha_group: String,
    ha_state: String,
    backups: Resource<BackupFilesResponse>,
    backup_meta: Resource<BackupsResponse>,
    host_status: Resource<HostStatus>,
    files: Option<FileBrowser>,
    clone: Option<CloneDraft>,
    migrate: Option<MigrateDraft>,
    delete: Option<DeleteDraft>,
    restore: Option<RestoreDraft>,
    backup_now: Option<BackupDraft>,
}

#[derive(Default)]
struct FwDraft {
    direction: String,
    action: String,
    proto: String,
    dport: String,
    source: String,
    comment: String,
}

impl GuestInspector {
    pub fn new(key: GuestKey) -> Self {
        Self {
            key,
            tab: Tab::Overview,
            detail: Resource::new(),
            config: ConfigEditor::default(),
            snap_name: String::new(),
            snap_desc: String::new(),
            firewall: Resource::new(),
            fw: FwDraft {
                direction: "in".into(),
                action: "ACCEPT".into(),
                proto: "tcp".into(),
                dport: "22".into(),
                ..Default::default()
            },
            ha: Resource::new(),
            ha_group: String::new(),
            ha_state: "started".into(),
            backups: Resource::new(),
            backup_meta: Resource::new(),
            host_status: Resource::new(),
            files: None,
            clone: None,
            migrate: None,
            delete: None,
            restore: None,
            backup_now: None,
        }
    }

    #[cfg(feature = "demo")]
    pub fn demo_config_tab(&mut self) {
        self.tab = Tab::Config;
    }

    fn can(&self, sh: &Shared, action: &str) -> bool {
        let host = sh.host(&self.key.host_id);
        sh.user
            .can_guest(host, &self.key.host_id, self.key.kind, self.key.vmid, &self.key.kind.perm(action))
    }

    fn load(&mut self, sh: &mut Shared) {
        let client = sh.client.clone();
        let path = self.key.path();
        let epoch = sh.epoch(Tag::Guests);
        if self.detail.poll() {
            if let Some(d) = &self.detail.data {
                self.config.sync(&d.config);
            }
        }
        self.detail.ensure(&sh.ctx, Duration::from_secs(15), epoch, || {
            move || client.get::<GuestDetail>(&path)
        });
        if self.detail.poll() {
            if let Some(d) = &self.detail.data {
                self.config.sync(&d.config);
            }
        }
    }

    /// Returns true when the inspector should close.
    pub fn ui(&mut self, ui: &mut Ui, sh: &mut Shared) -> bool {
        self.load(sh);
        let mut close = false;
        let name = self
            .detail
            .data
            .as_ref()
            .map(|d| {
                let n = vstr(&d.config, if self.key.kind == Kind::Vm { "name" } else { "hostname" });
                if n.is_empty() { vstr(&d.status, "name") } else { n }
            })
            .filter(|n| !n.is_empty())
            .unwrap_or_else(|| super::guests::list_name(sh, &self.key));

        w::panel_frame().show(ui, |ui| {
            ui.set_min_width(ui.available_width());
            // Header
            ui.horizontal(|ui| {
                let icon = if self.key.kind == Kind::Vm { ph::MONITOR } else { ph::CUBE };
                ui.label(w::icon_text(icon, 20.0, c::PINK));
                ui.label(RichText::new(format!("{} · {name}", self.key.vmid)).font(theme::semibold(17.0)).color(c::TEXT));
                ui.with_layout(Layout::right_to_left(Align::Center), |ui| {
                    if ui.add(Btn::icon_only(ph::X, "Schließen (Esc)").small()).clicked() {
                        close = true;
                    }
                });
            });
            let state = self.detail.data.as_ref().map(GuestDetail::state).unwrap_or_default();
            ui.horizontal(|ui| {
                let busy = sh.op_running(&self.key.op_key());
                if busy {
                    ui.spinner();
                    ui.label(w::small("Aktion läuft …"));
                } else if !state.is_empty() {
                    w::state_badge(ui, &state);
                }
                let host_name = sh.host(&self.key.host_id).map(|h| h.name.clone()).unwrap_or_default();
                ui.label(w::muted(format!("{host_name} / {}", self.key.node)));
                if let Some(d) = &self.detail.data {
                    let up = vnum(&d.status, "uptime") as u64;
                    if up > 0 {
                        ui.label(w::muted(format!("· läuft seit {}", format::uptime(up))));
                    }
                }
            });
            ui.add_space(10.0);
            self.action_bar(ui, sh, &name, &state);
            ui.add_space(12.0);

            let mut tabs = vec![(Tab::Overview, "Übersicht"), (Tab::Config, "Konfiguration"), (Tab::Snapshots, "Snapshots")];
            if sh.user.can_at("backup.view", Some(&self.key.host_id), None) {
                tabs.push((Tab::Backups, "Backups"));
            }
            tabs.push((Tab::Firewall, "Firewall"));
            let clustered = sh.host(&self.key.host_id).is_some_and(|h| h.is_cluster_member);
            if clustered {
                tabs.push((Tab::Ha, "HA"));
            }
            if self.can(sh, "files.read") || self.can(sh, "files.write") {
                tabs.push((Tab::Files, "Dateien"));
            }
            w::tabs(ui, &mut self.tab, &tabs);

            let Some(detail) = self.detail.data.clone() else {
                if let Some(err) = self.detail.error.clone() {
                    if w::error_box(ui, &err) {
                        self.detail.invalidate();
                    }
                } else {
                    w::skeleton(ui, 6);
                }
                return;
            };
            egui::ScrollArea::vertical()
                .id_salt("inspector_scroll")
                .auto_shrink([false, false])
                .show(ui, |ui| match self.tab {
                    Tab::Overview => self.overview(ui, &detail),
                    Tab::Config => self.config_tab(ui, sh, &detail),
                    Tab::Snapshots => self.snapshots(ui, sh, &detail, &name),
                    Tab::Backups => self.backups_tab(ui, sh, &name, &state),
                    Tab::Firewall => self.firewall_tab(ui, sh),
                    Tab::Ha => self.ha_tab(ui, sh),
                    Tab::Files => {
                        let ips = detail.ips.clone();
                        let agent = detail.agent_enabled && state == "running";
                        let browser = self
                            .files
                            .get_or_insert_with(|| FileBrowser::new(self.key.clone(), ips, agent));
                        browser.ui(ui, sh);
                    }
                });
        });

        self.dialogs(ui.ctx(), sh, &name);
        if ui.input(|i| i.key_pressed(egui::Key::Escape)) && sh.confirm.is_none() && !self.any_dialog() {
            close = true;
        }
        close
    }

    fn any_dialog(&self) -> bool {
        self.clone.is_some() || self.migrate.is_some() || self.delete.is_some() || self.restore.is_some() || self.backup_now.is_some()
    }

    fn action_bar(&mut self, ui: &mut Ui, sh: &mut Shared, name: &str, state: &str) {
        let key = self.key.clone();
        let busy = sh.op_running(&key.op_key());
        let running = state == "running";
        let paused = state == "paused";
        let template = self.detail.data.as_ref().is_some_and(|d| vbool(&d.config, "template"));
        ui.horizontal_wrapped(|ui| {
            if !running && !paused && !template {
                if ui.add(Btn::primary("Starten").icon(ph::PLAY).enabled(!busy && self.can(sh, "start"))).clicked() {
                    power_action(sh, &key, name, "start");
                }
            }
            if running {
                if ui.add(Btn::secondary("Herunterfahren").icon(ph::POWER).enabled(!busy && self.can(sh, "shutdown"))).clicked() {
                    power_action(sh, &key, name, "shutdown");
                }
                if ui.add(Btn::secondary("Neustarten").icon(ph::ARROW_COUNTER_CLOCKWISE).enabled(!busy && self.can(sh, "reboot"))).clicked() {
                    power_action(sh, &key, name, "reboot");
                }
            }
            if paused && ui.add(Btn::primary("Fortsetzen").icon(ph::PLAY).enabled(!busy && self.can(sh, "resume"))).clicked() {
                power_action(sh, &key, name, "resume");
            }
            if running || paused {
                if ui.add(Btn::secondary("Stoppen").icon(ph::STOP).enabled(!busy && self.can(sh, "force-stop"))).clicked() {
                    power_action(sh, &key, name, "stop");
                }
            }

            let console_ok = self.can(sh, "console");
            let has_serial = self.detail.data.as_ref().is_some_and(|d| !vstr(&d.config, "serial0").is_empty());
            w::menu_button(ui, ("console_menu", key.vmid), Btn::secondary("Konsole").icon(ph::TERMINAL_WINDOW), |ui| {
                let native_label = if key.kind == Kind::Lxc { "Terminal" } else { "Serielle Konsole" };
                let native_ok = console_ok && (running || paused) && (key.kind == Kind::Lxc || has_serial);
                if w::menu_item(ui, ph::TERMINAL, native_label, native_ok, false) {
                    sh.open_terminal(TermRequest {
                        title: format!("{} · {name}", key.vmid),
                        host_id: key.host_id.clone(),
                        node: key.node.clone(),
                        kind: key.kind.key().into(),
                        vmid: Some(key.vmid),
                        cmd: None,
                        initial_input: None,
                    });
                }
                if w::menu_item(ui, ph::BROWSERS, "Konsole im Browser (VNC)", console_ok, false) {
                    let path = format!("/{}/{}/{}/{}/console", key.kind.web(), seg(&key.host_id), seg(&key.node), key.vmid);
                    sh.open_web(&path);
                }
                if key.kind == Kind::Vm && w::menu_item(ui, ph::MONITOR, "SPICE (remote-viewer)", console_ok && running, false) {
                    open_spice(sh, &key, name);
                }
                if w::menu_item(ui, ph::ARROW_SQUARE_OUT, "Detailseite im Browser", true, false) {
                    let path = format!("/{}/{}/{}/{}", key.kind.web(), seg(&key.host_id), seg(&key.node), key.vmid);
                    sh.open_web(&path);
                }
            });

            w::menu_button(ui, ("more_menu", key.vmid), Btn::icon_only(ph::DOTS_THREE, "Weitere Aktionen"), |ui| {
                if key.kind == Kind::Vm {
                    if w::menu_item(ui, ph::PAUSE, "Pausieren", running && self.can(sh, "pause"), false) {
                        power_action(sh, &key, name, "pause");
                    }
                    if w::menu_item(ui, ph::LIGHTNING, "Reset (hart)", (running || paused) && self.can(sh, "reset"), false) {
                        power_action(sh, &key, name, "reset");
                    }
                    w::menu_separator(ui);
                }
                if w::menu_item(ui, ph::CAMERA, "Snapshot erstellen …", self.can(sh, "snapshot.create"), false) {
                    self.tab = Tab::Snapshots;
                }
                if w::menu_item(ui, ph::COPY, "Klonen …", self.can(sh, "clone"), false) {
                    let client = sh.client.clone();
                    let host = key.host_id.clone();
                    let pending = crate::net::Pending::spawn(&sh.ctx, move || {
                        client.get::<NextId>(&format!("/api/hosts/{}/nextid", seg(&host)))
                    });
                    self.clone = Some(CloneDraft {
                        newid: (key.vmid + 1).to_string(),
                        name: format!("{name}-clone"),
                        nextid: Some(pending),
                    });
                }
                let clustered = sh.host(&key.host_id).is_some_and(|h| h.is_cluster_member);
                if clustered && w::menu_item(ui, ph::ARROW_RIGHT, "Migrieren …", self.can(sh, "migrate"), false) {
                    self.migrate = Some(MigrateDraft { target: String::new() });
                }
                w::menu_separator(ui);
                let backup_run = sh.user.can_at("backup.run", Some(&key.host_id), None);
                if w::menu_item(ui, ph::ARCHIVE, "Backup jetzt …", backup_run, false) {
                    self.backup_now = Some(BackupDraft { storage: String::new(), mode: "snapshot".into() });
                }
                if w::menu_item(ui, ph::CLOCK_COUNTER_CLOCKWISE, "Wiederherstellen …", sh.user.can_at("backup.view", Some(&key.host_id), None), false) {
                    self.tab = Tab::Backups;
                }
                w::menu_separator(ui);
                if w::menu_item(ui, ph::TRASH, "Löschen …", self.can(sh, "delete"), true) {
                    self.delete = Some(DeleteDraft { typed: String::new(), purge_backups: Vec::new() });
                }
            });
        });
    }

    // ------------------------------------------------------------ overview

    fn overview(&mut self, ui: &mut Ui, d: &GuestDetail) {
        let s = &d.status;
        let cfg = &d.config;
        let running = d.state() == "running";
        w::section(ui, "Ressourcen", |_| {}, |ui| {
            let cpus = vnum(s, "cpus").max(1.0);
            let cpu = vnum(s, "cpu");
            w::meter_block(ui, "CPU", cpu as f32, &format!("{} · {} vCPU", format::percent(cpu), cpus));
            let mem = vnum(s, "mem") as u64;
            let maxmem = vnum(s, "maxmem") as u64;
            w::meter_block(ui, "Arbeitsspeicher", format::ratio(mem, maxmem), &format::used_of(mem, maxmem));
            let (du, dt) = match &d.agent_disk {
                Some(a) if a.total > 0 => (a.used, a.total),
                _ => (vnum(s, "disk") as u64, vnum(s, "maxdisk") as u64),
            };
            if dt > 0 && (du > 0 || self.key.kind == Kind::Lxc) {
                w::meter_block(ui, "Disk", format::ratio(du, dt), &format::used_of(du, dt));
            } else {
                ui.label(w::label("Disk"));
                let hint = if self.key.kind == Kind::Vm && !d.agent_enabled {
                    "Belegung unbekannt — QEMU Guest Agent ist aus."
                } else if self.key.kind == Kind::Vm && running {
                    "Belegung unbekannt — Guest Agent antwortet nicht."
                } else {
                    "Größe: siehe Konfiguration."
                };
                ui.label(w::small(hint));
                ui.add_space(8.0);
            }
        });
        ui.add_space(12.0);
        w::section(ui, "Netzwerk", |_| {}, |ui| {
            if d.ips.is_empty() {
                ui.label(w::muted(if running { "Keine IP bekannt." } else { "Gast ist gestoppt." }));
            }
            for ip in &d.ips {
                ui.horizontal(|ui| {
                    ui.label(w::mono(ip.clone()));
                    w::copy_button(ui, ip);
                });
            }
            ui.add_space(4.0);
            w::kv_grid(ui, "net_io", &[
                ("Empfangen", format::bytes(vnum(s, "netin") as u64)),
                ("Gesendet", format::bytes(vnum(s, "netout") as u64)),
            ]);
        });
        ui.add_space(12.0);
        w::section(ui, "Allgemein", |_| {}, |ui| {
            let mut rows: Vec<(&str, String)> = Vec::new();
            if self.key.kind == Kind::Vm {
                rows.push(("OS-Typ", vstr(cfg, "ostype")));
                rows.push(("CPU", format!("{} Kerne × {} Sockel · {}", vstr(cfg, "cores"), or(vstr(cfg, "sockets"), "1"), or(vstr(cfg, "cpu"), "Standard"))));
                rows.push(("BIOS / Maschine", format!("{} · {}", or(vstr(cfg, "bios"), "seabios"), or(vstr(cfg, "machine"), "i440fx"))));
                rows.push(("Boot", vstr(cfg, "boot")));
                rows.push(("Guest Agent", if d.agent_enabled { "aktiv".into() } else { "aus".into() }));
            } else {
                rows.push(("OS-Typ", vstr(cfg, "ostype")));
                rows.push(("CPU", format!("{} Kerne", or(vstr(cfg, "cores"), "alle"))));
                rows.push(("Swap", format!("{} MiB", or(vstr(cfg, "swap"), "0"))));
                rows.push(("Unprivilegiert", yes_no(vbool(cfg, "unprivileged"))));
                rows.push(("Features", vstr(cfg, "features")));
            }
            rows.push(("RAM (Konfig)", format!("{} MiB", vstr(cfg, "memory"))));
            rows.push(("Start bei Boot", yes_no(vbool(cfg, "onboot"))));
            rows.push(("Schutz", yes_no(vbool(cfg, "protection"))));
            rows.push(("Tags", vstr(cfg, "tags").replace(';', ", ")));
            if let Some(Value::Object(ha)) = s.get("ha") {
                if vbool(ha, "managed") {
                    rows.push(("HA", format!("verwaltet · {}", vstr(ha, "state"))));
                }
            }
            let lock = vstr(s, "lock");
            if !lock.is_empty() {
                rows.push(("Sperre", lock));
            }
            w::kv_grid(ui, "guest_general", &rows);
            let desc = vstr(cfg, "description");
            if !desc.trim().is_empty() {
                ui.add_space(10.0);
                ui.label(w::label("Beschreibung"));
                ui.add(egui::Label::new(w::secondary(desc)).wrap());
            }
        });
    }

    // ------------------------------------------------------------ config

    fn config_tab(&mut self, ui: &mut Ui, sh: &mut Shared, d: &GuestDetail) {
        let editable = self.can(sh, "config");
        let kind = self.key.kind;
        if !editable {
            w::callout(ui, ph::LOCK, c::MUTED, "Schreibgeschützt — dir fehlt die Berechtigung zum Ändern.");
            ui.add_space(10.0);
        }
        let saving = sh.op_running(&format!("{}:config", self.key.op_key()));
        let dirty = self.config.dirty();
        ui.add_enabled_ui(editable && !saving, |ui| {
            w::section(ui, "CPU & Arbeitsspeicher", |_| {}, |ui| {
                egui::Grid::new("cfg_cpu").num_columns(2).spacing([16.0, 8.0]).show(ui, |ui| {
                    self.config.text_row(ui, "cores", "Kerne", "1");
                    if kind == Kind::Vm {
                        self.config.text_row(ui, "sockets", "Sockel", "1");
                    }
                    self.config.text_row(ui, "memory", "RAM (MiB)", "2048");
                    if kind == Kind::Vm {
                        self.config.text_row(ui, "balloon", "Ballooning min. (MiB)", "0 = aus");
                    } else {
                        self.config.text_row(ui, "swap", "Swap (MiB)", "512");
                    }
                });
            });
            ui.add_space(12.0);
            w::section(ui, "Allgemein", |_| {}, |ui| {
                egui::Grid::new("cfg_general").num_columns(2).spacing([16.0, 8.0]).show(ui, |ui| {
                    let name_key = if kind == Kind::Vm { "name" } else { "hostname" };
                    self.config.text_row(ui, name_key, "Name", "");
                    if kind == Kind::Vm {
                        self.config.combo_row(ui, "ostype", "OS-Typ", &["l26", "win11", "win10", "win8", "win7", "l24", "other"]);
                    }
                    self.config.text_row(ui, "tags", "Tags (; getrennt)", "prod;web");
                    self.config.bool_row(ui, "onboot", "Start bei Boot");
                    self.config.bool_row(ui, "protection", "Löschschutz");
                    if kind == Kind::Vm {
                        self.config.bool_row(ui, "agent", "QEMU Guest Agent");
                        self.config.bool_row(ui, "tablet", "Tablet-Zeiger");
                        self.config.bool_row(ui, "numa", "NUMA");
                    }
                });
                ui.add_space(6.0);
                ui.label(w::label("Beschreibung"));
                let entry = self.config.edits.entry("description".into()).or_default();
                ui.add(egui::TextEdit::multiline(entry).desired_rows(3).desired_width(f32::INFINITY));
            });
            if kind == Kind::Vm {
                ui.add_space(12.0);
                let mut windows_profile = false;
                w::section(ui, "Hardware", |ui| {
                    if ui.add(Btn::ghost("Windows-Profil").icon(ph::APP_WINDOW).small()).on_hover_text("win11, OVMF, q35, CPU host, VirtIO SCSI single, Agent").clicked() {
                        windows_profile = true;
                    }
                }, |ui| {
                    egui::Grid::new("cfg_hw").num_columns(2).spacing([16.0, 8.0]).show(ui, |ui| {
                        self.config.combo_row(ui, "cpu", "CPU-Typ", &["x86-64-v2-AES", "host", "kvm64", "qemu64", "x86-64-v3"]);
                        self.config.combo_row(ui, "bios", "BIOS", &["seabios", "ovmf"]);
                        self.config.combo_row(ui, "machine", "Maschine", &["i440fx", "q35", "pc-q35-9.2"]);
                        self.config.combo_row(ui, "vga", "Grafik", &["std", "virtio", "qxl", "serial0", "none"]);
                        self.config.combo_row(ui, "scsihw", "SCSI-Controller", &["virtio-scsi-single", "virtio-scsi-pci", "lsi", "pvscsi"]);
                        self.config.combo_row(ui, "keyboard", "Tastatur", &["de", "en-us", "de-ch", "fr"]);
                    });
                });
                if windows_profile {
                    for (k, v) in [
                        ("ostype", "win11"), ("bios", "ovmf"), ("machine", "pc-q35-9.2"), ("cpu", "host"),
                        ("scsihw", "virtio-scsi-single"), ("agent", "1"), ("tablet", "1"), ("onboot", "1"),
                        ("keyboard", "de"), ("vga", "std"),
                    ] {
                        self.config.edits.insert(k.into(), v.into());
                    }
                }
            }
            ui.add_space(12.0);
            self.disks_section(ui, sh, d);
            ui.add_space(12.0);
            w::section(ui, "Netzwerk & weitere Schlüssel", |ui| {
                ui.label(w::small("Rohwerte wie in Proxmox"));
            }, |ui| {
                self.config.raw_rows(ui, kind);
            });
        });
        ui.add_space(12.0);
        ui.horizontal(|ui| {
            if ui.add(Btn::primary("Speichern").icon(ph::FLOPPY_DISK).enabled(editable && dirty).loading(saving)).clicked() {
                self.save_config(sh);
            }
            if ui.add(Btn::secondary("Zurücksetzen").enabled(dirty && !saving)).clicked() {
                self.config.reset();
            }
            if dirty {
                ui.label(w::small(format!("{} Änderung(en)", self.config.change_count())));
            }
        });
        ui.add_space(20.0);
    }

    fn disks_section(&mut self, ui: &mut Ui, sh: &mut Shared, d: &GuestDetail) {
        let disk_keys: Vec<String> = d
            .config
            .keys()
            .filter(|k| is_disk_key(k))
            .cloned()
            .collect();
        let resize_ok = self.can(sh, "config");
        let mut resize: Option<(String, String)> = None;
        w::section(ui, "Disks", |_| {}, |ui| {
            if disk_keys.is_empty() {
                ui.label(w::muted("Keine Disks konfiguriert."));
            }
            for k in &disk_keys {
                let raw = vstr(&d.config, k);
                if raw.contains("media=cdrom") {
                    continue;
                }
                let size = raw.split(',').find_map(|p| p.strip_prefix("size=")).unwrap_or("?").to_owned();
                ui.horizontal(|ui| {
                    ui.label(RichText::new(k).font(theme::mono(12.5)).color(c::TEXT));
                    ui.label(w::small(raw.split(',').next().unwrap_or("").to_owned()));
                    ui.with_layout(Layout::right_to_left(Align::Center), |ui| {
                        let entry = self.config.resize.entry(k.clone()).or_default();
                        if ui.add(Btn::secondary("Vergrößern").small().enabled(resize_ok && !entry.trim().is_empty())).clicked() {
                            resize = Some((k.clone(), entry.trim().to_owned()));
                        }
                        ui.add(egui::TextEdit::singleline(entry).hint_text("+ GiB").desired_width(60.0));
                        ui.label(w::mono(size));
                    });
                });
            }
        });
        if let Some((disk, add)) = resize {
            let gib: String = add.chars().filter(|c| c.is_ascii_digit()).collect();
            if gib.is_empty() {
                sh.toasts.warning("Ungültige Größe", "Nur ganze GiB angeben, z. B. 10.");
                return;
            }
            let path = self.key.path();
            let key = self.key.clone();
            self.config.resize.remove(&disk);
            sh.confirm(
                format!("{disk} um {gib} GiB vergrößern?"),
                "Verkleinern ist nicht möglich. Das Dateisystem im Gast muss danach ggf. erweitert werden.",
                "Vergrößern",
                false,
                move |sh| {
                    let body = json!({ "action": "resize", "disk": disk, "size": format!("+{gib}G"), "wait": false });
                    sh.run_task(format!("{}:resize", key.op_key()), format!("Disk vergrößern · {}", key.vmid), &key.host_id, &[Tag::Guests], move |c| {
                        c.post::<Value>(&path, &body)
                    });
                },
            );
        }
    }

    fn save_config(&mut self, sh: &mut Shared) {
        let Some((config, deletes)) = self.config.diff() else {
            return;
        };
        let mut body_cfg = Map::new();
        for (k, v) in config {
            body_cfg.insert(k, Value::String(v));
        }
        if !deletes.is_empty() {
            body_cfg.insert("delete".into(), Value::String(deletes.join(",")));
        }
        if let Some(digest) = self.config.original.get("digest") {
            body_cfg.insert("digest".into(), Value::String(digest.clone()));
        }
        let path = self.key.path();
        let body = json!({ "action": "config", "config": body_cfg });
        sh.run(
            format!("{}:config", self.key.op_key()),
            format!("Konfiguration gespeichert · {}", self.key.vmid),
            &[Tag::Guests],
            move |c| c.post::<Value>(&path, &body),
        );
        self.config.awaiting_reload = true;
        self.detail.invalidate();
    }

    // ------------------------------------------------------------ snapshots

    fn snapshots(&mut self, ui: &mut Ui, sh: &mut Shared, d: &GuestDetail, name: &str) {
        let can_create = self.can(sh, "snapshot.create");
        let can_rollback = self.can(sh, "snapshot.rollback");
        let can_delete = self.can(sh, "snapshot.delete");
        w::section(ui, "Neuer Snapshot", |_| {}, |ui| {
            ui.horizontal(|ui| {
                w::text_input(ui, &mut self.snap_name, "Name (optional)", 180.0);
                w::text_input(ui, &mut self.snap_desc, "Beschreibung", ui.available_width() - 110.0);
                if ui.add(Btn::primary("Erstellen").icon(ph::CAMERA).enabled(can_create)).clicked() {
                    let snapname = if self.snap_name.trim().is_empty() {
                        format!("snap-{}", chrono::Local::now().format("%Y%m%d-%H%M%S"))
                    } else {
                        self.snap_name.trim().replace(' ', "-")
                    };
                    let body = json!({ "action": "snapshot", "snapname": snapname, "description": self.snap_desc, "wait": false });
                    let path = self.key.path();
                    sh.run_task(format!("{}:snap", self.key.op_key()), format!("Snapshot {snapname} · {name}"), &self.key.host_id, &[Tag::Guests], move |c| c.post::<Value>(&path, &body));
                    self.snap_name.clear();
                    self.snap_desc.clear();
                }
            });
        });
        ui.add_space(12.0);
        let snaps: Vec<_> = d.snapshots.iter().filter(|s| s.name != "current").collect();
        w::section(ui, "Snapshots", |ui| {
            ui.label(w::small(format!("{}", snaps.len())));
        }, |ui| {
            if snaps.is_empty() {
                w::empty_state(ui, ph::CAMERA, "Keine Snapshots", "Ein Snapshot sichert den aktuellen Zustand für ein schnelles Zurückrollen.");
                return;
            }
            let mut rollback: Option<String> = None;
            let mut delete: Option<String> = None;
            for (i, s) in snaps.iter().enumerate() {
                if i > 0 {
                    w::separator(ui);
                }
                ui.horizontal(|ui| {
                    ui.label(w::icon_text(ph::CAMERA, 16.0, c::PURPLE));
                    ui.vertical(|ui| {
                        ui.spacing_mut().item_spacing.y = 1.0;
                        ui.label(w::strong(s.name.clone()));
                        let mut meta = s.snaptime.map(|t| format::unix_time(t as i64)).unwrap_or_default();
                        if s.vmstate {
                            meta.push_str(" · mit RAM");
                        }
                        if let Some(desc) = s.description.as_ref().filter(|d| !d.trim().is_empty()) {
                            meta.push_str(&format!(" · {}", desc.trim()));
                        }
                        ui.label(w::small(meta));
                    });
                    ui.with_layout(Layout::right_to_left(Align::Center), |ui| {
                        if ui.add(Btn::icon_only(ph::TRASH, "Löschen").small().enabled(can_delete)).clicked() {
                            delete = Some(s.name.clone());
                        }
                        if ui.add(Btn::secondary("Zurückrollen").icon(ph::CLOCK_COUNTER_CLOCKWISE).small().enabled(can_rollback)).clicked() {
                            rollback = Some(s.name.clone());
                        }
                    });
                });
            }
            let key = self.key.clone();
            if let Some(snap) = rollback {
                let name = name.to_owned();
                sh.confirm(
                    format!("Auf „{snap}“ zurückrollen?"),
                    "Alle Änderungen seit diesem Snapshot gehen verloren.",
                    "Zurückrollen",
                    true,
                    move |sh| {
                        let body = json!({ "action": "snapshot-rollback", "snapname": snap, "wait": false });
                        let path = key.path();
                        sh.run_task(format!("{}:snap", key.op_key()), format!("Rollback {snap} · {name}"), &key.host_id, &[Tag::Guests], move |c| c.post::<Value>(&path, &body));
                    },
                );
            } else if let Some(snap) = delete {
                let name = name.to_owned();
                sh.confirm(
                    format!("Snapshot „{snap}“ löschen?"),
                    "Der Snapshot wird endgültig entfernt.",
                    "Löschen",
                    true,
                    move |sh| {
                        let body = json!({ "action": "snapshot-delete", "snapname": snap, "wait": false });
                        let path = key.path();
                        sh.run_task(format!("{}:snap", key.op_key()), format!("Snapshot {snap} löschen · {name}"), &key.host_id, &[Tag::Guests], move |c| c.post::<Value>(&path, &body));
                    },
                );
            }
        });
    }

    // ------------------------------------------------------------ backups

    fn load_backups(&mut self, sh: &Shared) {
        let host = self.key.host_id.clone();
        let epoch = sh.epoch(Tag::Backups);
        let client = sh.client.clone();
        let h2 = host.clone();
        self.backups.ensure(&sh.ctx, Duration::from_secs(60), epoch, || {
            move || client.get::<BackupFilesResponse>(&format!("/api/hosts/{}/backups/files", seg(&h2)))
        });
        let client = sh.client.clone();
        self.backup_meta.ensure(&sh.ctx, Duration::from_secs(120), epoch, || {
            move || client.get::<BackupsResponse>(&format!("/api/hosts/{}/backups", seg(&host)))
        });
    }

    fn backups_tab(&mut self, ui: &mut Ui, sh: &mut Shared, name: &str, state: &str) {
        self.load_backups(sh);
        let host = self.key.host_id.clone();
        let can_run = sh.user.can_at("backup.run", Some(&host), None);
        let can_restore = sh.user.can_at("backup.restore", Some(&host), None);
        let can_delete = sh.user.can_at("backup.delete", Some(&host), None);
        ui.horizontal(|ui| {
            if ui.add(Btn::primary("Backup jetzt").icon(ph::ARCHIVE).enabled(can_run)).clicked() {
                self.backup_now = Some(BackupDraft { storage: String::new(), mode: "snapshot".into() });
            }
        });
        ui.add_space(10.0);
        let files: Vec<BackupFile> = self
            .backups
            .data
            .as_ref()
            .map(|r| r.files.iter().filter(|f| f.vmid == Some(self.key.vmid)).cloned().collect())
            .unwrap_or_default();
        w::section(ui, "Backups dieses Gasts", |ui| {
            ui.label(w::small(format!("{}", files.len())));
        }, |ui| {
            if self.backups.initial_loading() {
                w::skeleton(ui, 3);
                return;
            }
            if let Some(err) = self.backups.error.clone() {
                if w::error_box(ui, &err) {
                    self.backups.invalidate();
                }
            }
            if files.is_empty() {
                w::empty_state(ui, ph::ARCHIVE, "Keine Backups", "Starte ein Backup oder lege unter „Backups“ einen Job an.");
                return;
            }
            let mut restore: Option<BackupFile> = None;
            let mut delete: Option<BackupFile> = None;
            for (i, f) in files.iter().enumerate() {
                if i > 0 {
                    w::separator(ui);
                }
                ui.horizontal(|ui| {
                    ui.vertical(|ui| {
                        ui.spacing_mut().item_spacing.y = 1.0;
                        let when = format::unix_time((f.ctime / 1000) as i64);
                        ui.label(w::strong(when));
                        ui.label(w::small(format!("{} · {}{}", f.storage, format::bytes(f.size), if i == 0 { " · neuestes" } else { "" })));
                    });
                    ui.with_layout(Layout::right_to_left(Align::Center), |ui| {
                        if ui.add(Btn::icon_only(ph::TRASH, "Backup löschen").small().enabled(can_delete)).clicked() {
                            delete = Some(f.clone());
                        }
                        if ui.add(Btn::secondary("Wiederherstellen").icon(ph::CLOCK_COUNTER_CLOCKWISE).small().enabled(can_restore)).clicked() {
                            restore = Some(f.clone());
                        }
                    });
                });
            }
            if let Some(file) = restore {
                let storage = self
                    .backup_meta
                    .data
                    .as_ref()
                    .and_then(|m| m.disk_storages.first().cloned())
                    .unwrap_or_default();
                self.restore = Some(RestoreDraft { file, storage, force: state == "running", start_after: true });
            }
            if let Some(file) = delete {
                let host = host.clone();
                let name = name.to_owned();
                sh.confirm(
                    "Backup löschen?",
                    format!("{} wird endgültig gelöscht.", file.volid),
                    "Löschen",
                    true,
                    move |sh| {
                        let body = json!({ "action": "delete-file", "node": file.node, "volid": file.volid });
                        let path = format!("/api/hosts/{}/backups", seg(&host));
                        sh.run("backup:delete", format!("Backup gelöscht · {name}"), &[Tag::Backups], move |c| c.post::<Value>(&path, &body));
                    },
                );
            }
        });
    }

    // ------------------------------------------------------------ firewall

    fn firewall_tab(&mut self, ui: &mut Ui, sh: &mut Shared) {
        let path = format!("{}/firewall", self.key.path());
        let client = sh.client.clone();
        let p2 = path.clone();
        self.firewall.ensure(&sh.ctx, Duration::from_secs(60), sh.epoch(Tag::Guests), || {
            move || client.get::<Firewall>(&p2)
        });
        let editable = self.can(sh, "config");
        let Some(fw) = self.firewall.data.clone() else {
            if let Some(err) = self.firewall.error.clone() {
                if w::error_box(ui, &err) {
                    self.firewall.invalidate();
                }
            } else {
                w::skeleton(ui, 4);
            }
            return;
        };
        let enabled = vbool(&fw.options, "enable");
        w::section(ui, "Firewall", |ui| {
            let mut on = enabled;
            if ui.add_enabled(editable, egui::Checkbox::new(&mut on, "aktiv")).changed() {
                let p = path.clone();
                sh.run("fw:toggle", if on { "Firewall aktiviert" } else { "Firewall deaktiviert" }, &[Tag::Guests], move |c| {
                    c.put::<Value>(&p, &json!({ "enable": if on { 1 } else { 0 } }))
                });
                self.firewall.invalidate();
            }
        }, |ui| {
            w::kv_grid(ui, "fw_opts", &[
                ("Eingehend", or(vstr(&fw.options, "policy_in"), "DROP")),
                ("Ausgehend", or(vstr(&fw.options, "policy_out"), "ACCEPT")),
                ("DHCP / IP-Filter", format!("{} / {}", yes_no(vbool(&fw.options, "dhcp")), yes_no(vbool(&fw.options, "ipfilter")))),
            ]);
        });
        ui.add_space(12.0);
        let mut remove: Option<u64> = None;
        w::section(ui, "Regeln", |ui| {
            ui.label(w::small(format!("{}", fw.rules.len())));
        }, |ui| {
            if fw.rules.is_empty() {
                ui.label(w::muted("Keine Regeln."));
            } else {
                TableBuilder::new(ui)
                    .id_salt("fw_rules")
                    .striped(true)
                    .cell_layout(Layout::left_to_right(Align::Center))
                    .column(Column::exact(28.0))
                    .column(Column::exact(44.0))
                    .column(Column::exact(70.0))
                    .column(Column::exact(54.0))
                    .column(Column::exact(70.0))
                    .column(Column::remainder().clip(true))
                    .column(Column::exact(32.0))
                    .header(26.0, |mut r| {
                        for t in ["#", "Rtg.", "Aktion", "Proto", "Port", "Quelle / Kommentar", ""] {
                            r.col(|ui| w::th(ui, t));
                        }
                    })
                    .body(|mut b| {
                        for rule in &fw.rules {
                            b.row(30.0, |mut r| {
                                r.col(|ui| { ui.label(w::mono(rule.pos.to_string())); });
                                r.col(|ui| { ui.label(w::secondary(rule.kind.clone())); });
                                r.col(|ui| {
                                    let color = if rule.action == "ACCEPT" { c::OK } else { c::DANGER };
                                    w::badge(ui, &rule.action, color);
                                });
                                r.col(|ui| { ui.label(w::mono(rule.proto.clone().unwrap_or_default())); });
                                r.col(|ui| { ui.label(w::mono(rule.dport.clone())); });
                                r.col(|ui| {
                                    let text = [rule.source.clone().unwrap_or_default(), rule.comment.clone().unwrap_or_default()]
                                        .into_iter()
                                        .filter(|s| !s.is_empty())
                                        .collect::<Vec<_>>()
                                        .join(" · ");
                                    ui.add(egui::Label::new(w::small(text)).truncate());
                                });
                                r.col(|ui| {
                                    if ui.add(Btn::icon_only(ph::TRASH, "Regel entfernen").small().enabled(editable)).clicked() {
                                        remove = Some(rule.pos);
                                    }
                                });
                            });
                        }
                    });
            }
            ui.add_space(12.0);
            ui.label(w::label("Regel hinzufügen"));
            ui.horizontal_wrapped(|ui| {
                w::combo(ui, "fw_dir", &mut self.fw.direction, &[("in".into(), "eingehend".into()), ("out".into(), "ausgehend".into())], 100.0);
                w::combo(ui, "fw_act", &mut self.fw.action, &[("ACCEPT".into(), "ACCEPT".into()), ("DROP".into(), "DROP".into()), ("REJECT".into(), "REJECT".into())], 90.0);
                w::combo(ui, "fw_proto", &mut self.fw.proto, &[("tcp".into(), "tcp".into()), ("udp".into(), "udp".into()), ("icmp".into(), "icmp".into()), (String::new(), "alle".into())], 70.0);
                w::text_input(ui, &mut self.fw.dport, "Port", 70.0);
                w::text_input(ui, &mut self.fw.source, "Quelle (optional)", 130.0);
                w::text_input(ui, &mut self.fw.comment, "Kommentar", 130.0);
                if ui.add(Btn::secondary("Hinzufügen").icon(ph::PLUS).small().enabled(editable)).clicked() {
                    let mut body = json!({ "type": self.fw.direction, "action": self.fw.action, "enable": 1 });
                    for (k, v) in [("proto", &self.fw.proto), ("dport", &self.fw.dport), ("source", &self.fw.source), ("comment", &self.fw.comment)] {
                        if !v.trim().is_empty() {
                            body[k] = Value::String(v.trim().to_owned());
                        }
                    }
                    let p = path.clone();
                    sh.run("fw:add", "Firewall-Regel angelegt", &[Tag::Guests], move |c| c.post::<Value>(&p, &body));
                    self.firewall.invalidate();
                }
            });
        });
        if let Some(pos) = remove {
            let p = format!("{path}?pos={pos}");
            sh.run("fw:del", format!("Regel #{pos} entfernt"), &[Tag::Guests], move |c| c.delete::<Value>(&p));
            self.firewall.invalidate();
        }
    }

    // ------------------------------------------------------------ HA

    fn ha_tab(&mut self, ui: &mut Ui, sh: &mut Shared) {
        let path = format!("{}/ha", self.key.path());
        let client = sh.client.clone();
        let p2 = path.clone();
        if self.ha.poll() {
            if let Some(res) = self.ha.data.as_ref().and_then(|h| h.resource.clone()) {
                self.ha_group = vstr(&res, "group");
                let st = vstr(&res, "state");
                if !st.is_empty() {
                    self.ha_state = st;
                }
            }
        }
        self.ha.ensure(&sh.ctx, Duration::from_secs(60), sh.epoch(Tag::Guests), || {
            move || client.get::<HaInfo>(&p2)
        });
        let editable = self.can(sh, "config");
        let Some(ha) = self.ha.data.clone() else {
            if let Some(err) = self.ha.error.clone() {
                w::error_box(ui, &err);
            } else {
                w::skeleton(ui, 3);
            }
            return;
        };
        if !ha.clustered {
            w::empty_state(ui, ph::TREE_STRUCTURE, "Kein Cluster", "Hochverfügbarkeit gibt es nur für Hosts in einem Proxmox-Cluster.");
            return;
        }
        let managed = ha.resource.is_some();
        w::section(ui, "Hochverfügbarkeit", |ui| {
            w::badge(ui, if managed { "verwaltet" } else { "nicht verwaltet" }, if managed { c::OK } else { c::MUTED });
        }, |ui| {
            egui::Grid::new("ha_grid").num_columns(2).spacing([16.0, 8.0]).show(ui, |ui| {
                ui.label(w::label("Zielzustand"));
                w::combo(ui, "ha_state", &mut self.ha_state, &[
                    ("started".into(), "gestartet".into()),
                    ("stopped".into(), "gestoppt".into()),
                    ("ignored".into(), "ignoriert".into()),
                    ("disabled".into(), "deaktiviert".into()),
                ], 160.0);
                ui.end_row();
                ui.label(w::label("Gruppe"));
                let mut groups: Vec<(String, String)> = vec![(String::new(), "keine".into())];
                groups.extend(ha.groups.iter().map(|g| (vstr(g, "group"), vstr(g, "group"))));
                w::combo(ui, "ha_group", &mut self.ha_group, &groups, 160.0);
                ui.end_row();
            });
            ui.add_space(10.0);
            ui.horizontal(|ui| {
                let label = if managed { "Speichern" } else { "HA aktivieren" };
                if ui.add(Btn::primary(label).icon(ph::SHIELD_CHECK).enabled(editable)).clicked() {
                    let mut body = json!({ "enabled": true, "state": self.ha_state });
                    if !self.ha_group.is_empty() {
                        body["group"] = Value::String(self.ha_group.clone());
                    }
                    let p = path.clone();
                    sh.run("ha:set", "HA gespeichert", &[Tag::Guests], move |c| c.put::<Value>(&p, &body));
                    self.ha.invalidate();
                }
                if managed && ui.add(Btn::secondary("HA deaktivieren").enabled(editable)).clicked() {
                    let p = path.clone();
                    sh.run("ha:off", "HA deaktiviert", &[Tag::Guests], move |c| c.put::<Value>(&p, &json!({ "enabled": false })));
                    self.ha.invalidate();
                }
            });
        });
    }

    // ------------------------------------------------------------ dialogs

    fn dialogs(&mut self, ctx: &egui::Context, sh: &mut Shared, name: &str) {
        let key = self.key.clone();
        // Clone
        if let Some(draft) = &mut self.clone {
            if let Some(Ok(n)) = draft.nextid.as_ref().and_then(|p| p.poll()) {
                if n.nextid > 0 {
                    draft.newid = n.nextid.to_string();
                }
                draft.nextid = None;
            }
            let mut submit = false;
            let mut cancel = false;
            let closed = form_modal(ctx, "clone_dlg", &format!("{name} klonen"), 380.0, |ui| {
                w::field(ui, "Neue ID", None, |ui| w::text_input(ui, &mut draft.newid, "", 120.0));
                w::field(ui, "Name", None, |ui| w::text_input(ui, &mut draft.name, "", ui.available_width()));
                ui.label(w::small("Vollständiger Klon. Der Fortschritt erscheint unten in der Statusleiste."));
                ui.add_space(12.0);
                ui.horizontal(|ui| {
                    submit = ui.add(Btn::primary("Klonen").icon(ph::COPY)).clicked();
                    cancel = ui.add(Btn::secondary("Abbrechen")).clicked();
                });
            });
            cancel |= closed;
            if submit {
                if let Ok(newid) = draft.newid.trim().parse::<u64>() {
                    let name_key = if key.kind == Kind::Vm { "name" } else { "hostname" };
                    let mut body = json!({ "action": "clone", "newid": newid, "wait": false });
                    body[name_key] = Value::String(draft.name.trim().to_owned());
                    let path = key.path();
                    sh.run_task(format!("{}:clone", key.op_key()), format!("Klon {newid} von {name}"), &key.host_id, &[Tag::Guests], move |c| c.post::<Value>(&path, &body));
                    cancel = true;
                } else {
                    sh.toasts.warning("Ungültige ID", "Die neue ID muss eine Zahl sein.");
                }
            }
            if cancel {
                self.clone = None;
            }
        }

        // Migrate
        if self.migrate.is_some() {
            let host = key.host_id.clone();
            let client = sh.client.clone();
            self.host_status.ensure(&sh.ctx, Duration::from_secs(60), 0, || {
                move || client.get::<HostStatus>(&format!("/api/hosts/{}/status", seg(&host)))
            });
        }
        if let Some(draft) = &mut self.migrate {
            let targets: Vec<(String, String)> = self
                .host_status
                .data
                .as_ref()
                .map(|s| {
                    s.nodes
                        .iter()
                        .filter(|n| n.node != key.node)
                        .map(|n| (n.node.clone(), format!("{}{}", n.node, if n.is_online() { "" } else { " (offline)" })))
                        .collect()
                })
                .unwrap_or_default();
            if draft.target.is_empty() {
                if let Some((t, _)) = targets.first() {
                    draft.target = t.clone();
                }
            }
            let mut submit = false;
            let mut cancel = false;
            let closed = form_modal(ctx, "migrate_dlg", &format!("{name} migrieren"), 380.0, |ui| {
                if targets.is_empty() {
                    ui.label(w::muted("Kein anderer Node im Cluster gefunden."));
                } else {
                    w::field(ui, "Ziel-Node", None, |ui| w::combo(ui, "mig_target", &mut draft.target, &targets, 220.0));
                    ui.label(w::small("Laufende Gäste werden online migriert, lokale Disks werden mitgenommen."));
                }
                ui.add_space(12.0);
                ui.horizontal(|ui| {
                    submit = ui.add(Btn::primary("Migrieren").icon(ph::ARROW_RIGHT).enabled(!targets.is_empty())).clicked();
                    cancel = ui.add(Btn::secondary("Abbrechen")).clicked();
                });
            });
            if submit {
                let target = draft.target.clone();
                let path = key.path();
                let body = json!({ "action": "migrate", "target": target, "wait": false });
                let k2 = key.clone();
                sh.run_task_then(
                    format!("{}:migrate", key.op_key()),
                    format!("Migration {} → {target}", key.vmid),
                    &key.host_id,
                    &[Tag::Guests],
                    move |c| c.post::<Value>(&path, &body),
                    move |sh| {
                        sh.focus = Some(Focus::Guest { host_id: k2.host_id, node: target, vmid: k2.vmid, kind: k2.kind });
                    },
                );
                cancel = true;
            }
            if cancel || closed {
                self.migrate = None;
            }
        }

        // Backup now
        if self.backup_now.is_some() {
            self.load_backups(sh);
        }
        if let Some(draft) = &mut self.backup_now {
            let storages: Vec<(String, String)> = self
                .backup_meta
                .data
                .as_ref()
                .map(|m| m.backup_storages.iter().map(|s| (s.clone(), s.clone())).collect())
                .unwrap_or_default();
            if draft.storage.is_empty() {
                if let Some((s, _)) = storages.first() {
                    draft.storage = s.clone();
                }
            }
            let mut submit = false;
            let mut cancel = false;
            let closed = form_modal(ctx, "backup_dlg", &format!("Backup von {name}"), 380.0, |ui| {
                w::field(ui, "Ziel-Storage", None, |ui| w::combo(ui, "bk_storage", &mut draft.storage, &storages, 220.0));
                w::field(ui, "Modus", Some("Snapshot: ohne Unterbrechung · Suspend: kurz pausiert · Stop: Gast wird gestoppt"), |ui| {
                    let mut mode = draft.mode.clone();
                    w::combo(ui, "bk_mode", &mut mode, &[("snapshot".into(), "Snapshot".into()), ("suspend".into(), "Suspend".into()), ("stop".into(), "Stop".into())], 160.0);
                    draft.mode = mode;
                });
                ui.add_space(12.0);
                ui.horizontal(|ui| {
                    submit = ui.add(Btn::primary("Backup starten").icon(ph::ARCHIVE).enabled(!draft.storage.is_empty())).clicked();
                    cancel = ui.add(Btn::secondary("Abbrechen")).clicked();
                });
            });
            if submit {
                let body = json!({ "action": "run", "node": key.node, "vmid": key.vmid.to_string(), "storage": draft.storage, "mode": draft.mode, "compress": "zstd" });
                let path = format!("/api/hosts/{}/backups", seg(&key.host_id));
                sh.run_task(format!("{}:backup", key.op_key()), format!("Backup · {name}"), &key.host_id, &[Tag::Backups], move |c| c.post::<Value>(&path, &body));
                cancel = true;
            }
            if cancel || closed {
                self.backup_now = None;
            }
        }

        // Restore
        if let Some(draft) = &mut self.restore {
            let storages: Vec<(String, String)> = self
                .backup_meta
                .data
                .as_ref()
                .map(|m| m.disk_storages.iter().map(|s| (s.clone(), s.clone())).collect())
                .unwrap_or_default();
            let mut submit = false;
            let mut cancel = false;
            let closed = form_modal(ctx, "restore_dlg", &format!("{name} wiederherstellen"), 420.0, |ui| {
                ui.label(w::secondary(format!("Backup vom {}", format::unix_time((draft.file.ctime / 1000) as i64))));
                ui.label(w::small(draft.file.volid.clone()));
                ui.add_space(10.0);
                w::field(ui, "Ziel-Storage", None, |ui| w::combo(ui, "rs_storage", &mut draft.storage, &storages, 220.0));
                ui.checkbox(&mut draft.force, "Bestehenden Gast überschreiben (wird gestoppt)");
                ui.checkbox(&mut draft.start_after, "Danach starten");
                ui.add_space(12.0);
                ui.horizontal(|ui| {
                    let btn = if draft.force { Btn::danger("Wiederherstellen") } else { Btn::primary("Wiederherstellen") };
                    submit = ui.add(btn.icon(ph::CLOCK_COUNTER_CLOCKWISE).enabled(!draft.storage.is_empty())).clicked();
                    cancel = ui.add(Btn::secondary("Abbrechen")).clicked();
                });
            });
            if submit {
                start_restore(sh, &key.host_id, &draft.file, key.vmid, &draft.storage, draft.force, draft.start_after, name);
                cancel = true;
            }
            if cancel || closed {
                self.restore = None;
            }
        }

        // Delete
        if self.delete.is_some() && sh.user.can_at("backup.delete", Some(&key.host_id), None) {
            self.load_backups(sh);
        }
        if let Some(draft) = &mut self.delete {
            if draft.purge_backups.is_empty() {
                if let Some(files) = &self.backups.data {
                    draft.purge_backups = files
                        .files
                        .iter()
                        .filter(|f| f.vmid == Some(key.vmid))
                        .map(|f| (f.volid.clone(), false))
                        .collect();
                }
            }
            let expected = key.vmid.to_string();
            let mut submit = false;
            let mut cancel = false;
            let closed = form_modal(ctx, "delete_dlg", &format!("{name} löschen"), 440.0, |ui| {
                w::callout(ui, ph::WARNING, c::DANGER, "Der Gast und alle seine Disks werden endgültig gelöscht. Läuft er, wird er vorher heruntergefahren.");
                ui.add_space(10.0);
                if !draft.purge_backups.is_empty() {
                    ui.label(w::label("Backups zusätzlich löschen"));
                    for (volid, on) in &mut draft.purge_backups {
                        ui.checkbox(on, RichText::new(volid.rsplit('/').next().unwrap_or(volid)).font(theme::mono(11.5)));
                    }
                    ui.add_space(8.0);
                }
                ui.label(w::label(format!("Zur Bestätigung die ID „{expected}“ eingeben")));
                w::text_input(ui, &mut draft.typed, &expected, 140.0);
                ui.add_space(12.0);
                ui.horizontal(|ui| {
                    submit = ui.add(Btn::danger("Endgültig löschen").icon(ph::TRASH).enabled(draft.typed.trim() == expected)).clicked();
                    cancel = ui.add(Btn::secondary("Abbrechen")).clicked();
                });
            });
            if submit {
                let volids: Vec<String> = draft.purge_backups.iter().filter(|(_, on)| *on).map(|(v, _)| v.clone()).collect();
                start_delete(sh, &key, name, volids);
                cancel = true;
            }
            if cancel || closed {
                self.delete = None;
            }
        }
    }
}

fn or(v: String, fallback: &str) -> String {
    if v.is_empty() { fallback.to_owned() } else { v }
}

fn yes_no(b: bool) -> String {
    if b { "ja".into() } else { "nein".into() }
}

fn is_disk_key(k: &str) -> bool {
    if k == "rootfs" {
        return true;
    }
    ["scsi", "virtio", "sata", "ide", "mp", "efidisk", "tpmstate"]
        .iter()
        .any(|p| k.strip_prefix(p).is_some_and(|rest| !rest.is_empty() && rest.chars().all(|c| c.is_ascii_digit())))
}

fn open_spice(sh: &mut Shared, key: &GuestKey, name: &str) {
    let path = format!("{}/spice", key.path());
    let file = std::env::temp_dir().join(format!("proxora-{}.vv", key.vmid));
    sh.run(format!("{}:spice", key.op_key()), format!("SPICE-Verbindung · {name}"), &[], move |c| {
        c.download(&path, &file)?;
        open::that_detached(&file).map_err(|e| {
            ApiError::msg(format!("remote-viewer konnte nicht gestartet werden ({e}). virt-viewer installieren."))
        })?;
        Ok(Value::Null)
    });
}

/// Polls a task to completion from a worker thread (used by multi-phase flows).
pub fn wait_task(c: &Client, host_id: &str, upid: &str, timeout: Duration) -> ApiResult<TaskInfo> {
    let node = crate::net::upid_node(upid).unwrap_or_default();
    let path = format!(
        "/api/hosts/{}/task{}",
        seg(host_id),
        query(&[("node", node), ("upid", upid.to_owned()), ("limit", "50".into())])
    );
    let start = Instant::now();
    loop {
        let info = c.get::<TaskInfo>(&path)?;
        if info.status.finished() {
            if info.status.succeeded() {
                return Ok(info);
            }
            return Err(ApiError::msg(info.status.exitstatus.unwrap_or_else(|| "Task fehlgeschlagen".into())));
        }
        if start.elapsed() > timeout {
            return Err(ApiError::msg("Zeitüberschreitung beim Warten auf den Proxmox-Task"));
        }
        std::thread::sleep(Duration::from_millis(1200));
    }
}

fn start_delete(sh: &mut Shared, key: &GuestKey, name: &str, backup_volids: Vec<String>) {
    let key = key.clone();
    let host = key.host_id.clone();
    let label = format!("Löschen · {name}");
    sh.run(format!("{}:delete", key.op_key()), label, &[Tag::Guests, Tag::Backups], move |c| {
        let path = key.path();
        let mut phase: Option<String> = None;
        for _ in 0..6 {
            let mut body = json!({ "action": "delete", "confirm": true, "confirmId": key.vmid, "wait": false, "backupVolids": backup_volids });
            if let Some(p) = &phase {
                body["phase"] = Value::String(p.clone());
            }
            let res: crate::net::ActionResponse = c.post(&path, &body)?;
            let Some(upid) = res.upid() else {
                return Ok(Value::Null);
            };
            wait_task(c, &host, &upid, Duration::from_secs(600))?;
            match res.phase.as_deref() {
                Some("shutdown") => phase = Some("delete".into()),
                Some("stop") => phase = Some("stop".into()),
                _ => return Ok(Value::Null),
            }
        }
        Ok(Value::Null)
    });
    sh.toasts.info(format!("{name} wird gelöscht …"));
}

#[allow(clippy::too_many_arguments)]
pub fn start_restore(sh: &mut Shared, host_id: &str, file: &BackupFile, vmid: u64, storage: &str, force: bool, start_after: bool, name: &str) {
    let body = json!({ "action": "restore", "node": file.node, "volid": file.volid, "vmid": vmid, "storage": storage, "force": force, "startAfter": start_after });
    let host = host_id.to_owned();
    let path = format!("/api/hosts/{}/backups", seg(host_id));
    sh.run_task(format!("restore:{host}:{vmid}"), format!("Wiederherstellung · {name}"), host_id, &[Tag::Guests, Tag::Backups], move |c| {
        let started: crate::net::RestoreStarted = c.post(&path, &body)?;
        let job_path = format!("/api/hosts/{}/backups/restore?job={}", seg(&host), seg(&started.job_id));
        for _ in 0..120 {
            std::thread::sleep(Duration::from_millis(1500));
            let job: crate::net::RestoreJob = c.get(&job_path)?;
            if let Some(err) = job.error.filter(|_| job.phase == "error") {
                return Err(ApiError::msg(err));
            }
            if let Some(upid) = job.upid {
                return Ok(json!({ "upid": upid }));
            }
        }
        Err(ApiError::msg("Restore wurde nicht gestartet (Zeitüberschreitung)"))
    });
}

// ---------------------------------------------------------------- config editor

#[derive(Default)]
struct ConfigEditor {
    original: BTreeMap<String, String>,
    edits: BTreeMap<String, String>,
    resize: BTreeMap<String, String>,
    new_key: String,
    new_value: String,
    awaiting_reload: bool,
}

const STRUCTURED: &[&str] = &[
    "cores", "sockets", "memory", "balloon", "swap", "name", "hostname", "ostype", "tags", "onboot",
    "protection", "agent", "tablet", "numa", "description", "cpu", "bios", "machine", "vga", "scsihw",
    "keyboard", "digest",
];

impl ConfigEditor {
    fn sync(&mut self, cfg: &Map<String, Value>) {
        let fresh: BTreeMap<String, String> = cfg
            .iter()
            .map(|(k, v)| {
                let s = match v {
                    Value::String(s) => s.clone(),
                    Value::Null => String::new(),
                    other => other.to_string(),
                };
                (k.clone(), s)
            })
            .collect();
        let untouched = !self.dirty() || self.awaiting_reload;
        if untouched || self.original.is_empty() {
            self.edits = fresh.clone();
            self.awaiting_reload = false;
        }
        self.original = fresh;
    }

    fn reset(&mut self) {
        self.edits = self.original.clone();
        self.resize.clear();
    }

    fn diff(&self) -> Option<(BTreeMap<String, String>, Vec<String>)> {
        let mut changed = BTreeMap::new();
        let mut deletes = Vec::new();
        for (k, v) in &self.edits {
            if k == "digest" {
                continue;
            }
            let orig = self.original.get(k);
            if orig != Some(v) {
                if v.trim().is_empty() {
                    if orig.is_some_and(|o| !o.is_empty()) {
                        deletes.push(k.clone());
                    }
                } else {
                    changed.insert(k.clone(), v.trim().to_owned());
                }
            }
        }
        for k in self.original.keys() {
            if k != "digest" && !self.edits.contains_key(k) {
                deletes.push(k.clone());
            }
        }
        (!changed.is_empty() || !deletes.is_empty()).then_some((changed, deletes))
    }

    fn dirty(&self) -> bool {
        self.diff().is_some()
    }

    fn change_count(&self) -> usize {
        self.diff().map(|(c, d)| c.len() + d.len()).unwrap_or(0)
    }

    fn text_row(&mut self, ui: &mut Ui, key: &str, label: &str, hint: &str) {
        ui.label(w::label(label));
        let entry = self.edits.entry(key.to_owned()).or_default();
        ui.add(egui::TextEdit::singleline(entry).hint_text(RichText::new(hint).color(c::MUTED)).desired_width(220.0));
        ui.end_row();
    }

    fn bool_row(&mut self, ui: &mut Ui, key: &str, label: &str) {
        ui.label(w::label(label));
        let entry = self.edits.entry(key.to_owned()).or_default();
        let mut on = matches!(entry.split(',').next().unwrap_or("").trim(), "1" | "true" | "enabled=1");
        if ui.checkbox(&mut on, "").changed() {
            if key == "agent" && entry.contains(',') {
                let rest: Vec<&str> = entry.split(',').skip(1).collect();
                *entry = format!("{},{}", if on { "1" } else { "0" }, rest.join(","));
            } else {
                *entry = if on { "1".into() } else { "0".into() };
            }
        }
        ui.end_row();
    }

    fn combo_row(&mut self, ui: &mut Ui, key: &str, label: &str, options: &[&str]) {
        ui.label(w::label(label));
        let entry = self.edits.entry(key.to_owned()).or_default();
        ui.horizontal(|ui| {
            egui::ComboBox::from_id_salt(("cfg_combo", key))
                .width(150.0)
                .selected_text(if entry.is_empty() { "Standard".to_owned() } else { entry.clone() })
                .show_ui(ui, |ui| {
                    if ui.selectable_label(entry.is_empty(), "Standard").clicked() {
                        entry.clear();
                    }
                    for o in options {
                        if ui.selectable_label(entry == o, *o).clicked() {
                            *entry = (*o).to_owned();
                        }
                    }
                });
            ui.add(egui::TextEdit::singleline(entry).desired_width(120.0).hint_text("frei"));
        });
        ui.end_row();
    }

    fn raw_rows(&mut self, ui: &mut Ui, kind: Kind) {
        let keys: Vec<String> = self
            .edits
            .keys()
            .filter(|k| !STRUCTURED.contains(&k.as_str()) && !is_disk_key(k))
            .cloned()
            .collect();
        let mut remove: Option<String> = None;
        egui::Grid::new(("cfg_raw", kind.key())).num_columns(3).spacing([10.0, 6.0]).show(ui, |ui| {
            for k in keys {
                ui.label(RichText::new(&k).font(theme::mono(12.0)).color(c::TEXT_2));
                let entry = self.edits.entry(k.clone()).or_default();
                ui.add(egui::TextEdit::singleline(entry).font(theme::mono(12.0)).desired_width(ui.available_width() - 40.0));
                if ui.add(Btn::icon_only(ph::X, "Schlüssel entfernen").small()).clicked() {
                    remove = Some(k);
                }
                ui.end_row();
            }
        });
        if let Some(k) = remove {
            self.edits.remove(&k);
        }
        ui.add_space(8.0);
        ui.horizontal(|ui| {
            w::text_input(ui, &mut self.new_key, "Schlüssel (z. B. net1)", 140.0);
            w::text_input(ui, &mut self.new_value, "Wert", ui.available_width() - 110.0);
            if ui.add(Btn::secondary("Hinzufügen").small().enabled(!self.new_key.trim().is_empty())).clicked() {
                self.edits.insert(self.new_key.trim().to_owned(), self.new_value.trim().to_owned());
                self.new_key.clear();
                self.new_value.clear();
            }
        });
    }
}
