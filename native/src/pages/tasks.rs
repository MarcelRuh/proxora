use crate::app::shared::{Shared, Tag};
use crate::net::{seg, task_exit_ok, Host, Resource, TaskEntry, TaskInfo, TasksResponse};
use crate::theme::{self, c, ROW_H};
use crate::ui::format;
use crate::ui::widgets::{self as w, Btn};
use eframe::egui::{self, Align, Layout, RichText, Sense, Stroke, Ui};
use egui_extras::{Column, TableBuilder};
use egui_phosphor::regular as ph;
use serde_json::{json, Value};
use std::time::Duration;

#[derive(Clone)]
struct Row {
    host_id: String,
    host_name: String,
    task: TaskEntry,
}

#[derive(Clone, Copy, PartialEq, Eq)]
enum StatusFilter {
    All,
    Running,
    Ok,
    Failed,
}

#[derive(Default)]
struct LogView {
    host_id: String,
    row: Option<TaskEntry>,
    info: Resource<TaskInfo>,
}

pub struct TasksPage {
    rows: Resource<Vec<Row>>,
    search: String,
    status: StatusFilter,
    host: Option<String>,
    log: Option<LogView>,
}

impl Default for TasksPage {
    fn default() -> Self {
        Self { rows: Resource::new(), search: String::new(), status: StatusFilter::All, host: None, log: None }
    }
}

pub fn task_label(kind: &str) -> &'static str {
    match kind {
        "qmstart" => "VM starten",
        "qmstop" => "VM stoppen",
        "qmshutdown" => "VM herunterfahren",
        "qmreboot" => "VM neu starten",
        "qmreset" => "VM zurücksetzen",
        "qmsuspend" | "qmpause" => "VM pausieren",
        "qmresume" => "VM fortsetzen",
        "qmcreate" => "VM erstellen",
        "qmdestroy" => "VM löschen",
        "qmclone" => "VM klonen",
        "qmigrate" => "VM migrieren",
        "qmsnapshot" => "Snapshot erstellen",
        "qmrollback" => "Snapshot zurückrollen",
        "qmdelsnapshot" => "Snapshot löschen",
        "qmrestore" => "VM wiederherstellen",
        "qmconfig" => "VM konfigurieren",
        "qmresize" | "resize" => "Disk vergrößern",
        "vzstart" => "Container starten",
        "vzstop" => "Container stoppen",
        "vzshutdown" => "Container herunterfahren",
        "vzreboot" => "Container neu starten",
        "vzcreate" => "Container erstellen",
        "vzdestroy" => "Container löschen",
        "vzclone" => "Container klonen",
        "vzmigrate" => "Container migrieren",
        "vzsnapshot" => "Snapshot erstellen",
        "vzrollback" => "Snapshot zurückrollen",
        "vzdelsnapshot" => "Snapshot löschen",
        "vzrestore" => "Container wiederherstellen",
        "vzdump" => "Backup",
        "aptupdate" => "Paketlisten aktualisieren",
        "download" => "Download",
        "imgdel" => "Image löschen",
        "vncproxy" | "vncshell" | "termproxy" => "Konsole",
        "spiceproxy" => "SPICE-Konsole",
        "startall" => "Alle Gäste starten",
        "stopall" => "Alle Gäste stoppen",
        "srvreload" | "srvrestart" => "Dienst neu laden",
        "zfscreate" => "ZFS-Pool anlegen",
        _ => "Aufgabe",
    }
}

impl TasksPage {
    fn load(&mut self, sh: &mut Shared) {
        sh.ensure_hosts();
        let Some(hosts) = sh.hosts.data.clone() else {
            return;
        };
        let any_running = self.rows.data.as_ref().is_some_and(|r| r.iter().any(|x| x.task.running()));
        let age = if any_running { Duration::from_secs(8) } else { Duration::from_secs(30) };
        let client = sh.client.clone();
        let hosts: Vec<Host> = hosts.into_iter().filter(|h| h.online() && sh.user.can_host(h, "tasks.view")).collect();
        self.rows.ensure(&sh.ctx, age, sh.epoch(Tag::Tasks), || {
            move || {
                let mut out = Vec::new();
                let mut last_err = None;
                for h in &hosts {
                    match client.get::<TasksResponse>(&format!("/api/hosts/{}/tasks", seg(&h.id))) {
                        Ok(r) => out.extend(r.tasks.into_iter().map(|t| Row { host_id: h.id.clone(), host_name: h.name.clone(), task: t })),
                        Err(e) => last_err = Some(e),
                    }
                }
                if out.is_empty() {
                    if let Some(e) = last_err {
                        return Err(e);
                    }
                }
                out.sort_by(|a, b| b.task.starttime.cmp(&a.task.starttime));
                Ok(out)
            }
        });
    }

    pub fn ui(&mut self, ui: &mut Ui, sh: &mut Shared) {
        self.load(sh);
        let rows = self.rows.data.clone().unwrap_or_default();
        let running = rows.iter().filter(|r| r.task.running()).count();
        w::page_header(ui, "Aufgaben", Some(&format!("{} Proxmox-Aufgaben · {running} laufen", rows.len())), |ui| {
            if ui.add(Btn::secondary("Aktualisieren").icon(ph::ARROW_CLOCKWISE).loading(self.rows.loading())).clicked() {
                sh.bump(Tag::Tasks);
            }
        });
        ui.horizontal(|ui| {
            w::search_input(ui, &mut self.search, "Typ, Gast, Node, Benutzer …", 260.0);
            w::segmented(ui, &mut self.status, &[(StatusFilter::All, "Alle"), (StatusFilter::Running, "Laufend"), (StatusFilter::Ok, "OK"), (StatusFilter::Failed, "Fehler")]);
            let hosts: Vec<(Option<String>, String)> = std::iter::once((None, "Alle Hosts".to_owned()))
                .chain(sh.hosts.data.iter().flatten().map(|h| (Some(h.id.clone()), h.name.clone())))
                .collect();
            if hosts.len() > 2 {
                w::combo(ui, "tasks_host", &mut self.host, &hosts, 170.0);
            }
        });
        ui.add_space(10.0);

        if let Some(log) = &mut self.log {
            let mut close = false;
            egui::SidePanel::right("task_log")
                .resizable(true)
                .default_width(520.0)
                .show_separator_line(false)
                .frame(egui::Frame::new().fill(c::BG).inner_margin(egui::Margin { left: 16, right: 0, top: 0, bottom: 0 }))
                .show_inside(ui, |ui| {
                    close = log_panel(ui, sh, log);
                });
            if close {
                self.log = None;
            }
        }
        egui::CentralPanel::default().frame(egui::Frame::new()).show_inside(ui, |ui| {
            self.table(ui, sh, &rows);
        });
    }

    fn table(&mut self, ui: &mut Ui, sh: &mut Shared, rows: &[Row]) {
        if self.rows.data.is_none() {
            w::panel_frame().show(ui, |ui| {
                ui.set_min_width(ui.available_width());
                match self.rows.error.clone() {
                    Some(err) => {
                        if w::error_box(ui, &err) {
                            self.rows.invalidate();
                        }
                    }
                    None => w::skeleton(ui, 8),
                }
            });
            return;
        }
        let q = self.search.trim().to_lowercase();
        let list: Vec<&Row> = rows
            .iter()
            .filter(|r| self.host.as_ref().is_none_or(|h| &r.host_id == h))
            .filter(|r| match self.status {
                StatusFilter::All => true,
                StatusFilter::Running => r.task.running(),
                StatusFilter::Ok => !r.task.running() && task_exit_ok(r.task.status.as_deref().unwrap_or("")),
                StatusFilter::Failed => !r.task.running() && !task_exit_ok(r.task.status.as_deref().unwrap_or("")),
            })
            .filter(|r| {
                q.is_empty()
                    || format!("{} {} {} {} {} {} {}", r.task.kind, task_label(&r.task.kind), r.task.id, r.task.guest_name.as_deref().unwrap_or(""), r.task.node, r.task.user, r.host_name)
                        .to_lowercase()
                        .contains(&q)
            })
            .take(300)
            .collect();
        if list.is_empty() {
            w::panel_frame().show(ui, |ui| {
                ui.set_min_width(ui.available_width());
                w::empty_state(ui, ph::LIST_CHECKS, "Keine Aufgaben", "Hier erscheinen Proxmox-Tasks aller Hosts — Starts, Backups, Migrationen.");
            });
            return;
        }
        let selected = self.log.as_ref().and_then(|l| l.row.as_ref().map(|r| r.upid.clone()));
        let mut open: Option<Row> = None;
        let mut cancel: Option<Row> = None;
        let wide = ui.available_width() > 820.0;
        w::panel_frame().inner_margin(egui::Margin::symmetric(10, 8)).show(ui, |ui| {
            ui.set_min_width(ui.available_width());
            let top = ui.cursor().top();
            ui.painter().hline(ui.max_rect().x_range(), top + 32.0, Stroke::new(1.0_f32, c::BORDER));
            let mut tb = TableBuilder::new(ui)
                .id_salt("tasks_table")
                .striped(true)
                .sense(Sense::click())
                .auto_shrink([false, false])
                .cell_layout(Layout::left_to_right(Align::Center))
                .column(Column::exact(146.0))
                .column(Column::remainder().at_least(170.0).clip(true))
                .column(Column::exact(130.0).clip(true));
            if wide {
                tb = tb.column(Column::exact(140.0).clip(true)).column(Column::exact(70.0));
            }
            tb = tb.column(Column::exact(110.0)).column(Column::exact(40.0));
            tb.header(32.0, |mut r| {
                r.col(|ui| w::th(ui, "Start"));
                r.col(|ui| w::th(ui, "Aufgabe"));
                r.col(|ui| w::th(ui, "Host · Node"));
                if wide {
                    r.col(|ui| w::th(ui, "Benutzer"));
                    r.col(|ui| w::th(ui, "Dauer"));
                }
                r.col(|ui| w::th(ui, "Status"));
                r.col(|_| {});
            })
            .body(|body| {
                body.rows(ROW_H + 6.0, list.len(), |mut row| {
                    let r = list[row.index()];
                    let t = &r.task;
                    row.set_selected(selected.as_deref() == Some(t.upid.as_str()));
                    row.col(|ui| { ui.label(w::mono(format::unix_time(t.starttime as i64))); });
                    row.col(|ui| {
                        ui.vertical(|ui| {
                            ui.spacing_mut().item_spacing.y = 1.0;
                            ui.label(w::strong(task_label(&t.kind)));
                            let target = match (&t.guest_name, t.id.is_empty()) {
                                (Some(n), false) => format!("{} · {n} · {}", t.id, t.kind),
                                (None, false) => format!("{} · {}", t.id, t.kind),
                                _ => t.kind.clone(),
                            };
                            ui.label(w::small(target));
                        });
                    });
                    row.col(|ui| {
                        ui.vertical(|ui| {
                            ui.spacing_mut().item_spacing.y = 1.0;
                            ui.add(egui::Label::new(w::secondary(r.host_name.clone())).truncate());
                            ui.label(w::small(t.node.clone()));
                        });
                    });
                    if wide {
                        row.col(|ui| { ui.add(egui::Label::new(w::small(t.user.clone())).truncate()); });
                        row.col(|ui| {
                            let end = t.endtime.unwrap_or_else(|| chrono::Utc::now().timestamp() as u64);
                            ui.label(w::mono(duration(end.saturating_sub(t.starttime))));
                        });
                    }
                    row.col(|ui| status_cell(ui, t));
                    row.col(|ui| {
                        if t.running() {
                            let h = sh.host(&r.host_id);
                            let ok = h.is_some_and(|h| sh.user.can_host(h, "tasks.cancel"));
                            if ui.add(Btn::icon_only(ph::STOP, "Abbrechen").small().enabled(ok)).clicked() {
                                cancel = Some(r.clone());
                            }
                        }
                    });
                    if row.response().clicked() {
                        open = Some(r.clone());
                    }
                });
            });
        });
        if let Some(r) = open {
            let mut view = LogView { host_id: r.host_id.clone(), row: Some(r.task.clone()), info: Resource::new() };
            view.info.set_key(&r.task.upid);
            self.log = Some(view);
        }
        if let Some(r) = cancel {
            cancel_task(sh, &r.host_id, &r.task);
        }
    }
}

fn cancel_task(sh: &mut Shared, host_id: &str, t: &TaskEntry) {
    let host = host_id.to_owned();
    let node = t.node.clone();
    let upid = t.upid.clone();
    let label = task_label(&t.kind);
    sh.confirm(
        format!("„{label}“ abbrechen?"),
        "Der laufende Proxmox-Task wird gestoppt. Je nach Aufgabe bleibt ein Teilzustand zurück.",
        "Abbrechen",
        true,
        move |sh| {
            let path = format!("/api/hosts/{}/tasks", seg(&host));
            sh.run("task:cancel", "Aufgabe abgebrochen", &[Tag::Tasks], move |c| {
                c.post::<Value>(&path, &json!({ "action": "stop", "node": node, "upid": upid }))
            });
        },
    );
}

fn status_cell(ui: &mut Ui, t: &TaskEntry) {
    if t.running() {
        ui.spinner();
        ui.label(RichText::new("läuft").font(theme::medium(12.5)).color(c::CYAN));
        return;
    }
    let exit = t.status.clone().unwrap_or_default();
    if task_exit_ok(&exit) {
        let warn = exit.to_ascii_uppercase().starts_with("WARNING");
        w::badge(ui, if warn { "Warnung" } else { "OK" }, if warn { c::WARN } else { c::OK });
    } else {
        w::badge(ui, "Fehler", c::DANGER).on_hover_text(exit);
    }
}

fn duration(secs: u64) -> String {
    if secs < 60 {
        format!("{secs} s")
    } else if secs < 3600 {
        format!("{}:{:02} min", secs / 60, secs % 60)
    } else {
        format!("{} h {} min", secs / 3600, (secs % 3600) / 60)
    }
}

fn log_panel(ui: &mut Ui, sh: &mut Shared, view: &mut LogView) -> bool {
    let Some(row) = view.row.clone() else {
        return true;
    };
    let running = view.info.data.as_ref().map(|i| !i.status.finished()).unwrap_or(row.running());
    let client = sh.client.clone();
    let path = format!(
        "/api/hosts/{}/tasks/{}/{}",
        seg(&view.host_id),
        seg(&row.node),
        seg(&row.upid)
    );
    let age = if running { Duration::from_millis(1500) } else { Duration::from_secs(3600) };
    view.info.ensure(&sh.ctx, age, 0, || move || client.get::<TaskInfo>(&path));
    let mut close = false;
    let mut cancel = false;
    w::panel_frame().show(ui, |ui| {
        ui.set_min_width(ui.available_width());
        ui.horizontal(|ui| {
            ui.label(w::icon_text(ph::LIST_CHECKS, 18.0, c::PINK));
            ui.label(RichText::new(task_label(&row.kind)).font(theme::semibold(16.0)).color(c::TEXT));
            ui.with_layout(Layout::right_to_left(Align::Center), |ui| {
                if ui.add(Btn::icon_only(ph::X, "Schließen").small()).clicked() {
                    close = true;
                }
                if running {
                    let ok = sh.host(&view.host_id).is_some_and(|h| sh.user.can_host(h, "tasks.cancel"));
                    if ui.add(Btn::secondary("Abbrechen").icon(ph::STOP).small().enabled(ok)).clicked() {
                        cancel = true;
                    }
                }
            });
        });
        ui.label(w::small(row.upid.clone()));
        ui.add_space(8.0);
        if let Some(info) = &view.info.data {
            let progress = crate::net::log_progress(&info.log);
            if running {
                w::meter(ui, progress.unwrap_or(0.08), ui.available_width(), 5.0);
                ui.add_space(8.0);
            } else {
                let ok = info.status.succeeded();
                let text = if ok { "Erfolgreich beendet".to_owned() } else { format!("Fehlgeschlagen: {}", info.status.exitstatus.clone().unwrap_or_default()) };
                w::callout(ui, if ok { ph::CHECK_CIRCLE } else { ph::WARNING_CIRCLE }, if ok { c::OK } else { c::DANGER }, &text);
                ui.add_space(8.0);
            }
            egui::Frame::new()
                .fill(c::INPUT)
                .stroke(Stroke::new(1.0_f32, c::BORDER))
                .corner_radius(4)
                .inner_margin(egui::Margin::same(10))
                .show(ui, |ui| {
                    ui.set_min_width(ui.available_width());
                    egui::ScrollArea::vertical()
                        .id_salt("task_log_scroll")
                        .auto_shrink([false, false])
                        .stick_to_bottom(true)
                        .show(ui, |ui| {
                            for line in &info.log {
                                ui.label(RichText::new(&line.t).font(theme::mono(11.5)).color(c::TEXT_2));
                            }
                            if info.log.is_empty() {
                                ui.label(w::muted("Kein Log."));
                            }
                        });
                });
        } else if let Some(err) = view.info.error.clone() {
            w::error_box(ui, &err);
        } else {
            w::skeleton(ui, 6);
        }
    });
    if cancel {
        cancel_task(sh, &view.host_id.clone(), &row);
    }
    close
}
