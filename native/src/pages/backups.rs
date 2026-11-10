use super::guest_detail::start_restore;
use super::host_picker;
use crate::app::dialog::form_modal;
use crate::app::shared::{Shared, Tag};
use crate::net::{seg, BackupFile, BackupFilesResponse, BackupJob, BackupsResponse, CleanupResult, Resource};
use crate::theme::{self, c, ROW_H};
use crate::ui::format;
use crate::ui::widgets::{self as w, Btn};
use eframe::egui::{self, Align, Layout, RichText, Stroke, Ui};
use egui_extras::{Column, TableBuilder};
use egui_phosphor::regular as ph;
use serde_json::{json, Value};
use std::collections::BTreeSet;
use std::time::Duration;

#[derive(Clone, Copy, PartialEq, Eq)]
enum Tab {
    Files,
    Jobs,
}

#[derive(Clone, Copy, PartialEq, Eq)]
enum TypeFilter {
    All,
    Vm,
    Lxc,
}

const DAYS: [(&str, &str); 7] = [("mon", "Mo"), ("tue", "Di"), ("wed", "Mi"), ("thu", "Do"), ("fri", "Fr"), ("sat", "Sa"), ("sun", "So")];

struct JobDraft {
    id: Option<String>,
    enabled: bool,
    days: BTreeSet<&'static str>,
    time: String,
    storage: String,
    mode: String,
    compress: String,
    node: String,
    all: bool,
    vmids: String,
    keep_last: String,
}

impl JobDraft {
    fn new() -> Self {
        Self {
            id: None,
            enabled: true,
            days: BTreeSet::new(),
            time: "02:00".into(),
            storage: String::new(),
            mode: "snapshot".into(),
            compress: "zstd".into(),
            node: String::new(),
            all: true,
            vmids: String::new(),
            keep_last: "7".into(),
        }
    }

    fn from_job(j: &BackupJob) -> Self {
        let mut d = Self::new();
        d.id = Some(j.id.clone());
        d.enabled = j.enabled;
        let (days, time) = match j.schedule.rsplit_once(' ') {
            Some((days, time)) => (days.to_owned(), time.to_owned()),
            None => (String::new(), j.schedule.clone()),
        };
        d.time = time;
        if days.contains("..") {
            let (a, b) = days.split_once("..").unwrap_or(("", ""));
            let ia = DAYS.iter().position(|(k, _)| *k == a).unwrap_or(0);
            let ib = DAYS.iter().position(|(k, _)| *k == b).unwrap_or(6);
            for (k, _) in &DAYS[ia..=ib.max(ia)] {
                d.days.insert(k);
            }
        } else {
            for part in days.split(',') {
                if let Some((k, _)) = DAYS.iter().find(|(k, _)| *k == part.trim()) {
                    d.days.insert(k);
                }
            }
        }
        d.storage = j.storage.clone();
        d.mode = if j.mode.is_empty() { "snapshot".into() } else { j.mode.clone() };
        d.compress = if j.compress.is_empty() { "zstd".into() } else { j.compress.clone() };
        d.node = j.node.clone();
        d.all = j.all;
        d.vmids = j.vmid.clone();
        d.keep_last = j.keep_last.map(|k| k.to_string()).unwrap_or_default();
        d
    }

    fn schedule(&self) -> String {
        if self.days.is_empty() || self.days.len() == 7 {
            self.time.trim().to_owned()
        } else {
            let list: Vec<&str> = DAYS.iter().filter(|(k, _)| self.days.contains(k)).map(|(k, _)| *k).collect();
            format!("{} {}", list.join(","), self.time.trim())
        }
    }
}

struct RestoreDraft {
    file: BackupFile,
    vmid: String,
    storage: String,
    force: bool,
    start_after: bool,
}

pub struct BackupsPage {
    host: Option<String>,
    tab: Tab,
    meta: Resource<BackupsResponse>,
    files: Resource<BackupFilesResponse>,
    search: String,
    kind: TypeFilter,
    job: Option<JobDraft>,
    restore: Option<RestoreDraft>,
}

impl Default for BackupsPage {
    fn default() -> Self {
        Self {
            host: None,
            tab: Tab::Files,
            meta: Resource::new(),
            files: Resource::new(),
            search: String::new(),
            kind: TypeFilter::All,
            job: None,
            restore: None,
        }
    }
}

fn describe_schedule(s: &str) -> String {
    let (days, time) = match s.rsplit_once(' ') {
        Some((d, t)) => (d, t),
        None => ("", s),
    };
    let days_text = if days.is_empty() {
        "täglich".to_owned()
    } else {
        days.replace("mon", "Mo").replace("tue", "Di").replace("wed", "Mi").replace("thu", "Do").replace("fri", "Fr").replace("sat", "Sa").replace("sun", "So").replace("..", "–")
    };
    format!("{days_text} · {time}")
}

impl BackupsPage {
    pub fn ui(&mut self, ui: &mut Ui, sh: &mut Shared) {
        sh.ensure_hosts();
        let user = sh.user.clone();
        let mut new_job = false;
        let can_job = self.host.as_ref().and_then(|id| sh.host(id)).is_some_and(|h| sh.user.can_host(h, "backup.job.create"));
        w::page_header(ui, "Backups", Some("Backup-Jobs und Sicherungsdateien"), |ui| {
            if ui.add(Btn::primary("Job anlegen").icon(ph::PLUS).enabled(can_job)).clicked() {
                new_job = true;
            }
            if ui.add(Btn::secondary("Aktualisieren").icon(ph::ARROW_CLOCKWISE).loading(self.files.loading())).clicked() {
                sh.bump(Tag::Backups);
            }
        });
        ui.horizontal(|ui| {
            host_picker(ui, sh, &mut self.host, |h| h.online() && user.can_host(h, "backup.view"));
        });
        ui.add_space(8.0);
        let Some(host) = self.host.clone() else {
            w::empty_state(ui, ph::ARCHIVE, "Kein Host", "Kein erreichbarer Host mit Backup-Rechten.");
            return;
        };
        if new_job {
            let mut d = JobDraft::new();
            if let Some(m) = &self.meta.data {
                d.storage = m.backup_storages.first().cloned().unwrap_or_default();
            }
            self.job = Some(d);
        }
        if self.meta.set_key(&host) {
            self.files.set_key(&host);
        }
        let epoch = sh.epoch(Tag::Backups);
        let (c1, c2, h1, h2) = (sh.client.clone(), sh.client.clone(), host.clone(), host.clone());
        self.meta.ensure(&sh.ctx, Duration::from_secs(45), epoch, || move || c1.get::<BackupsResponse>(&format!("/api/hosts/{}/backups", seg(&h1))));
        self.files.ensure(&sh.ctx, Duration::from_secs(45), epoch, || move || c2.get::<BackupFilesResponse>(&format!("/api/hosts/{}/backups/files", seg(&h2))));
        let n_files = self.files.data.as_ref().map(|f| f.files.len()).unwrap_or(0);
        let n_jobs = self.meta.data.as_ref().map(|m| m.jobs.len()).unwrap_or(0);
        let files_label = format!("Dateien ({n_files})");
        let jobs_label = format!("Jobs ({n_jobs})");
        w::tabs(ui, &mut self.tab, &[(Tab::Files, &files_label), (Tab::Jobs, &jobs_label)]);
        match self.tab {
            Tab::Files => self.files_tab(ui, sh, &host),
            Tab::Jobs => self.jobs_tab(ui, sh, &host),
        }
        self.dialogs(ui.ctx(), sh, &host);
    }

    fn files_tab(&mut self, ui: &mut Ui, sh: &mut Shared, host: &str) {
        let Some(files) = self.files.data.clone() else {
            w::panel_frame().show(ui, |ui| {
                ui.set_min_width(ui.available_width());
                match self.files.error.clone() {
                    Some(e) => {
                        if w::error_box(ui, &e) {
                            self.files.invalidate();
                        }
                    }
                    None => w::skeleton(ui, 6),
                }
            });
            return;
        };
        let guests = self.meta.data.as_ref().map(|m| m.guests.clone()).unwrap_or_default();
        let name_of = |vmid: Option<u64>| vmid.and_then(|v| guests.iter().find(|g| g.vmid == v).map(|g| g.name.clone()));
        let orphans = files.files.iter().filter(|f| name_of(f.vmid).is_none()).count();
        let h = sh.host(host).cloned();
        let can_delete = h.as_ref().is_some_and(|h| sh.user.can_host(h, "backup.delete"));
        let can_restore = h.as_ref().is_some_and(|h| sh.user.can_host(h, "backup.restore"));
        let mut cleanup = false;
        ui.horizontal(|ui| {
            w::search_input(ui, &mut self.search, "ID, Name, Storage …", 240.0);
            w::segmented(ui, &mut self.kind, &[(TypeFilter::All, "Alle"), (TypeFilter::Vm, "VM"), (TypeFilter::Lxc, "LXC")]);
            ui.with_layout(Layout::right_to_left(Align::Center), |ui| {
                if orphans > 0 && ui.add(Btn::secondary(&format!("Verwaiste aufräumen ({orphans})")).icon(ph::BROOM).enabled(can_delete)).clicked() {
                    cleanup = true;
                }
            });
        });
        ui.add_space(10.0);
        let q = self.search.to_lowercase();
        let list: Vec<&BackupFile> = files
            .files
            .iter()
            .filter(|f| match self.kind {
                TypeFilter::All => true,
                TypeFilter::Vm => f.kind == "vm",
                TypeFilter::Lxc => f.kind == "lxc",
            })
            .filter(|f| {
                q.is_empty()
                    || format!("{} {} {} {}", f.vmid.unwrap_or(0), name_of(f.vmid).unwrap_or_default(), f.volid, f.storage).to_lowercase().contains(&q)
            })
            .collect();
        let mut restore: Option<BackupFile> = None;
        let mut delete: Option<BackupFile> = None;
        w::panel_frame().inner_margin(egui::Margin::symmetric(10, 8)).show(ui, |ui| {
            ui.set_min_width(ui.available_width());
            if list.is_empty() {
                w::empty_state(ui, ph::ARCHIVE, "Keine Backups", "Lege einen Job an oder starte ein Backup aus der Gast-Ansicht.");
                return;
            }
            let top = ui.cursor().top();
            ui.painter().hline(ui.max_rect().x_range(), top + 30.0, Stroke::new(1.0_f32, c::BORDER));
            TableBuilder::new(ui)
                .id_salt("backup_files")
                .striped(true)
                .auto_shrink([false, false])
                .cell_layout(Layout::left_to_right(Align::Center))
                .column(Column::exact(60.0))
                .column(Column::remainder().at_least(160.0).clip(true))
                .column(Column::exact(60.0))
                .column(Column::exact(130.0))
                .column(Column::exact(90.0))
                .column(Column::exact(120.0).clip(true))
                .column(Column::exact(160.0))
                .header(30.0, |mut r| {
                    for t in ["ID", "Gast", "Typ", "Datum", "Größe", "Storage", ""] {
                        r.col(|ui| w::th(ui, t));
                    }
                })
                .body(|body| {
                    body.rows(ROW_H, list.len(), |mut row| {
                        let f = list[row.index()];
                        row.col(|ui| { ui.label(w::mono(f.vmid.map(|v| v.to_string()).unwrap_or_else(|| "?".into()))); });
                        row.col(|ui| match name_of(f.vmid) {
                            Some(n) => { ui.label(w::strong(n)); }
                            None => { w::badge(ui, "verwaist", c::WARN); }
                        });
                        row.col(|ui| { ui.label(w::secondary(f.kind.to_uppercase())); });
                        row.col(|ui| { ui.label(w::mono(format::unix_time((f.ctime / 1000) as i64))); });
                        row.col(|ui| { ui.label(w::mono(format::bytes(f.size))); });
                        row.col(|ui| { ui.label(w::small(f.storage.clone())); });
                        row.col(|ui| {
                            ui.with_layout(Layout::right_to_left(Align::Center), |ui| {
                                if ui.add(Btn::icon_only(ph::TRASH, "Löschen").small().enabled(can_delete)).clicked() {
                                    delete = Some(f.clone());
                                }
                                if ui.add(Btn::secondary("Wiederherstellen").small().enabled(can_restore)).clicked() {
                                    restore = Some(f.clone());
                                }
                            });
                        });
                    });
                });
        });
        let path = format!("/api/hosts/{}/backups", seg(host));
        if let Some(file) = restore {
            let storage = self.meta.data.as_ref().and_then(|m| m.disk_storages.first().cloned()).unwrap_or_default();
            let running = guests.iter().any(|g| Some(g.vmid) == file.vmid && g.status == "running");
            self.restore = Some(RestoreDraft { vmid: file.vmid.map(|v| v.to_string()).unwrap_or_default(), file, storage, force: running, start_after: true });
        }
        if let Some(file) = delete {
            let p = path.clone();
            sh.confirm("Backup löschen?", format!("{} wird endgültig gelöscht.", file.volid), "Löschen", true, move |sh| {
                let body = json!({ "action": "delete-file", "node": file.node, "volid": file.volid });
                sh.run("backup:delete", "Backup gelöscht", &[Tag::Backups], move |c| c.post::<Value>(&p, &body));
            });
        }
        if cleanup {
            sh.confirm(
                format!("{orphans} verwaiste Backups löschen?"),
                "Gelöscht werden Sicherungen von Gästen, die es auf diesem Host nicht mehr gibt.",
                "Aufräumen",
                true,
                move |sh| {
                    sh.run_then("backup:cleanup", "Aufräumen", &[Tag::Backups], move |c| c.post::<Value>(&path, &json!({ "action": "cleanup-orphans" })), |sh, v| {
                        let r: CleanupResult = serde_json::from_value(v).unwrap_or_default();
                        sh.bump(Tag::Backups);
                        if r.failed > 0 {
                            sh.toasts.warning(format!("{} gelöscht, {} fehlgeschlagen", r.deleted, r.failed), "Details im Audit-Log.");
                        } else {
                            sh.toasts.success(format!("{} verwaiste Backups gelöscht", r.deleted));
                        }
                    });
                },
            );
        }
    }

    fn jobs_tab(&mut self, ui: &mut Ui, sh: &mut Shared, host: &str) {
        let Some(meta) = self.meta.data.clone() else {
            w::skeleton(ui, 4);
            return;
        };
        let h = sh.host(host).cloned();
        let can = |p: &str| h.as_ref().is_some_and(|h| sh.user.can_host(h, p));
        let (can_run, can_edit, can_delete) = (can("backup.run"), can("backup.job.update"), can("backup.job.delete"));
        let mut run: Option<BackupJob> = None;
        let mut edit: Option<BackupJob> = None;
        let mut delete: Option<BackupJob> = None;
        w::panel_frame().show(ui, |ui| {
            ui.set_min_width(ui.available_width());
            if meta.jobs.is_empty() {
                w::empty_state(ui, ph::CLOCK_CLOCKWISE, "Keine Backup-Jobs", "Ein Job sichert Gäste automatisch nach Zeitplan.");
                return;
            }
            for (i, j) in meta.jobs.iter().enumerate() {
                if i > 0 {
                    w::separator(ui);
                }
                ui.horizontal(|ui| {
                    ui.label(w::icon_text(ph::CLOCK_CLOCKWISE, 18.0, if j.enabled { c::PINK } else { c::FAINT }));
                    ui.vertical(|ui| {
                        ui.spacing_mut().item_spacing.y = 2.0;
                        ui.horizontal(|ui| {
                            ui.label(w::strong(describe_schedule(&j.schedule)));
                            if !j.enabled {
                                w::badge(ui, "pausiert", c::MUTED);
                            }
                        });
                        let guests = if j.all { "alle Gäste".to_owned() } else { format!("Gäste {}", j.vmid) };
                        let keep = j.keep_last.map(|k| format!(" · behält {k}")).unwrap_or_default();
                        let node = if j.node.is_empty() { String::new() } else { format!(" · {}", j.node) };
                        ui.label(w::small(format!("{} → {} · {} · {}{keep}{node}", guests, j.storage, j.mode, j.compress)));
                    });
                    ui.with_layout(Layout::right_to_left(Align::Center), |ui| {
                        if ui.add(Btn::icon_only(ph::TRASH, "Löschen").small().enabled(can_delete)).clicked() {
                            delete = Some(j.clone());
                        }
                        if ui.add(Btn::icon_only(ph::PENCIL_SIMPLE, "Bearbeiten").small().enabled(can_edit)).clicked() {
                            edit = Some(j.clone());
                        }
                        if ui.add(Btn::secondary("Jetzt ausführen").icon(ph::PLAY).small().enabled(can_run)).clicked() {
                            run = Some(j.clone());
                        }
                    });
                });
            }
        });
        let path = format!("/api/hosts/{}/backups", seg(host));
        if let Some(j) = run {
            let body = json!({ "action": "run-job", "id": j.id, "node": if j.node.is_empty() { meta.primary_node.clone() } else { j.node.clone() } });
            let p = path.clone();
            sh.run_task(format!("backupjob:{}", j.id), format!("Backup-Job {}", describe_schedule(&j.schedule)), host, &[Tag::Backups], move |c| c.post::<Value>(&p, &body));
        }
        if let Some(j) = edit {
            self.job = Some(JobDraft::from_job(&j));
        }
        if let Some(j) = delete {
            sh.confirm("Backup-Job löschen?", format!("Der Job „{}“ wird entfernt. Vorhandene Backups bleiben erhalten.", describe_schedule(&j.schedule)), "Löschen", true, move |sh| {
                sh.run("backupjob:delete", "Backup-Job gelöscht", &[Tag::Backups], move |c| c.post::<Value>(&path, &json!({ "action": "delete-job", "id": j.id })));
            });
        }
    }

    fn dialogs(&mut self, ctx: &egui::Context, sh: &mut Shared, host: &str) {
        let meta = self.meta.data.clone().unwrap_or_default();
        if let Some(d) = &mut self.job {
            let mut save = false;
            let mut cancel = false;
            let title = if d.id.is_some() { "Backup-Job bearbeiten" } else { "Backup-Job anlegen" };
            let closed = form_modal(ctx, "job_dialog", title, 500.0, |ui| {
                ui.checkbox(&mut d.enabled, "Aktiv");
                ui.add_space(8.0);
                ui.label(w::label("Wochentage (keiner = täglich)"));
                ui.horizontal(|ui| {
                    for (k, label) in DAYS {
                        let on = d.days.contains(k);
                        if ui.add(Btn::secondary(label).small().selected(on)).clicked() {
                            if on {
                                d.days.remove(k);
                            } else {
                                d.days.insert(k);
                            }
                        }
                    }
                    ui.add_space(8.0);
                    if ui.add(Btn::ghost("Werktags").small()).clicked() {
                        d.days = ["mon", "tue", "wed", "thu", "fri"].into_iter().collect();
                    }
                    if ui.add(Btn::ghost("Täglich").small()).clicked() {
                        d.days.clear();
                    }
                });
                ui.add_space(8.0);
                egui::Grid::new("job_grid").num_columns(2).spacing([16.0, 10.0]).show(ui, |ui| {
                    ui.label(w::label("Uhrzeit"));
                    w::text_input(ui, &mut d.time, "02:00", 80.0);
                    ui.end_row();
                    ui.label(w::label("Storage"));
                    let st: Vec<(String, String)> = meta.backup_storages.iter().map(|s| (s.clone(), s.clone())).collect();
                    w::combo(ui, "job_storage", &mut d.storage, &st, 200.0);
                    ui.end_row();
                    ui.label(w::label("Modus"));
                    w::combo(ui, "job_mode", &mut d.mode, &[("snapshot".into(), "Snapshot".into()), ("suspend".into(), "Suspend".into()), ("stop".into(), "Stop".into())], 200.0);
                    ui.end_row();
                    ui.label(w::label("Kompression"));
                    w::combo(ui, "job_compress", &mut d.compress, &[("zstd".into(), "zstd".into()), ("lzo".into(), "lzo".into()), ("gzip".into(), "gzip".into()), ("0".into(), "keine".into())], 200.0);
                    ui.end_row();
                    ui.label(w::label("Node"));
                    let mut nodes: Vec<(String, String)> = vec![(String::new(), "alle".into())];
                    nodes.extend(meta.nodes.iter().map(|n| (n.clone(), n.clone())));
                    w::combo(ui, "job_node", &mut d.node, &nodes, 200.0);
                    ui.end_row();
                    ui.label(w::label("Aufbewahren"));
                    ui.horizontal(|ui| {
                        w::text_input(ui, &mut d.keep_last, "7", 60.0);
                        ui.label(w::small("letzte Backups je Gast"));
                    });
                    ui.end_row();
                });
                ui.add_space(8.0);
                ui.checkbox(&mut d.all, "Alle Gäste sichern");
                if !d.all {
                    w::text_input(ui, &mut d.vmids, "IDs, z. B. 100,101", ui.available_width());
                    ui.horizontal_wrapped(|ui| {
                        for g in &meta.guests {
                            let id = g.vmid.to_string();
                            let mut list: Vec<String> = d.vmids.split(',').map(|s| s.trim().to_owned()).filter(|s| !s.is_empty()).collect();
                            let on = list.contains(&id);
                            if ui.add(Btn::secondary(&format!("{} {}", g.vmid, g.name)).small().selected(on)).clicked() {
                                if on {
                                    list.retain(|x| x != &id);
                                } else {
                                    list.push(id);
                                }
                                d.vmids = list.join(",");
                            }
                        }
                    });
                }
                ui.add_space(14.0);
                ui.horizontal(|ui| {
                    let ok = !d.storage.is_empty() && !d.time.trim().is_empty() && (d.all || !d.vmids.trim().is_empty());
                    save = ui.add(Btn::primary("Speichern").icon(ph::FLOPPY_DISK).enabled(ok)).clicked();
                    cancel = ui.add(Btn::secondary("Abbrechen")).clicked();
                });
            });
            if save {
                let mut body = json!({
                    "action": if d.id.is_some() { "update-job" } else { "create-job" },
                    "enabled": d.enabled, "schedule": d.schedule(), "storage": d.storage, "mode": d.mode,
                    "compress": d.compress, "all": d.all,
                });
                if let Some(id) = &d.id {
                    body["id"] = json!(id);
                }
                if !d.all {
                    body["vmid"] = json!(d.vmids.trim());
                }
                if !d.node.is_empty() {
                    body["node"] = json!(d.node);
                }
                body["keepLast"] = d.keep_last.trim().parse::<u64>().map(Value::from).unwrap_or(Value::Null);
                let path = format!("/api/hosts/{}/backups", seg(host));
                sh.run("backupjob:save", "Backup-Job gespeichert", &[Tag::Backups], move |c| c.post::<Value>(&path, &body));
                cancel = true;
            }
            if cancel || closed {
                self.job = None;
            }
        }
        if let Some(d) = &mut self.restore {
            let mut go = false;
            let mut cancel = false;
            let closed = form_modal(ctx, "restore_page_dlg", "Backup wiederherstellen", 440.0, |ui| {
                ui.label(w::secondary(format!("Backup vom {}", format::unix_time((d.file.ctime / 1000) as i64))));
                ui.label(RichText::new(&d.file.volid).font(theme::mono(11.0)).color(c::MUTED));
                ui.add_space(10.0);
                egui::Grid::new("restore_grid").num_columns(2).spacing([16.0, 10.0]).show(ui, |ui| {
                    ui.label(w::label("Ziel-ID"));
                    w::text_input(ui, &mut d.vmid, "", 100.0);
                    ui.end_row();
                    ui.label(w::label("Storage"));
                    let st: Vec<(String, String)> = meta.disk_storages.iter().map(|s| (s.clone(), s.clone())).collect();
                    w::combo(ui, "restore_storage", &mut d.storage, &st, 200.0);
                    ui.end_row();
                });
                ui.checkbox(&mut d.force, "Bestehenden Gast überschreiben");
                ui.checkbox(&mut d.start_after, "Danach starten");
                ui.add_space(14.0);
                ui.horizontal(|ui| {
                    let btn = if d.force { Btn::danger("Wiederherstellen") } else { Btn::primary("Wiederherstellen") };
                    go = ui.add(btn.enabled(d.vmid.trim().parse::<u64>().is_ok() && !d.storage.is_empty())).clicked();
                    cancel = ui.add(Btn::secondary("Abbrechen")).clicked();
                });
            });
            if go {
                let vmid: u64 = d.vmid.trim().parse().unwrap_or(0);
                start_restore(sh, host, &d.file, vmid, &d.storage, d.force, d.start_after, &format!("ID {vmid}"));
                cancel = true;
            }
            if cancel || closed {
                self.restore = None;
            }
        }
    }
}
