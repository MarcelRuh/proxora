use super::guest_detail::GuestInspector;
use crate::app::shared::{guest_path, Focus, Page, Shared, Tag};
use crate::net::{Guest, Kind};
use crate::theme::{self, c, ROW_H};
use crate::ui::format;
use crate::ui::widgets::{self as w, Btn};
use eframe::egui::{self, Align, Layout, RichText, Sense, Stroke, Ui};
use egui_extras::{Column, TableBuilder};
use egui_phosphor::regular as ph;
use serde_json::{json, Value};
use std::collections::HashSet;

#[derive(Clone, Debug, PartialEq, Eq, Hash)]
pub struct GuestKey {
    pub host_id: String,
    pub node: String,
    pub vmid: u64,
    pub kind: Kind,
}

impl GuestKey {
    pub fn of(g: &Guest, kind: Kind) -> Self {
        Self {
            host_id: g.host_id.clone().unwrap_or_default(),
            node: g.node.clone(),
            vmid: g.vmid,
            kind,
        }
    }
    pub fn op_key(&self) -> String {
        format!("guest:{}:{}:{}", self.host_id, self.kind.key(), self.vmid)
    }
    pub fn path(&self) -> String {
        guest_path(&self.host_id, self.kind, &self.node, self.vmid)
    }
}

#[derive(Clone, Copy, PartialEq, Eq)]
enum StatusFilter {
    All,
    Running,
    Stopped,
    Paused,
}

#[derive(Clone, Copy, PartialEq, Eq)]
enum SortCol {
    Id,
    Name,
    Cpu,
    Mem,
    Uptime,
}

pub struct GuestsPage {
    kind: Kind,
    search: String,
    status: StatusFilter,
    host: Option<String>,
    sort: SortCol,
    asc: bool,
    checked: HashSet<GuestKey>,
    inspector: Option<GuestInspector>,
}

impl GuestsPage {
    pub fn new(kind: Kind) -> Self {
        Self {
            kind,
            search: String::new(),
            status: StatusFilter::All,
            host: None,
            sort: SortCol::Id,
            asc: true,
            checked: HashSet::new(),
            inspector: None,
        }
    }

    fn list<'a>(&self, sh: &'a Shared) -> Vec<&'a Guest> {
        let Some(data) = &sh.guests.data else {
            return Vec::new();
        };
        let src = match self.kind {
            Kind::Vm => &data.vms,
            Kind::Lxc => &data.containers,
        };
        let q = self.search.trim().to_lowercase();
        let mut out: Vec<&Guest> = src
            .iter()
            .filter(|g| match self.status {
                StatusFilter::All => true,
                StatusFilter::Running => g.status == "running",
                StatusFilter::Stopped => g.status == "stopped",
                StatusFilter::Paused => g.status == "paused",
            })
            .filter(|g| self.host.as_ref().is_none_or(|h| g.host_id.as_deref() == Some(h.as_str())))
            .filter(|g| {
                q.is_empty() || {
                    let hay = format!(
                        "{} {} {} {} {} {} {}",
                        g.vmid,
                        g.name,
                        g.tags.as_deref().unwrap_or(""),
                        g.description.as_deref().unwrap_or(""),
                        g.ips.as_ref().map(|i| i.join(" ")).unwrap_or_default(),
                        g.host_name.as_deref().unwrap_or(""),
                        g.node
                    )
                    .to_lowercase();
                    hay.contains(&q)
                }
            })
            .collect();
        out.sort_by(|a, b| {
            let ord = match self.sort {
                SortCol::Id => a.vmid.cmp(&b.vmid),
                SortCol::Name => a.name.to_lowercase().cmp(&b.name.to_lowercase()),
                SortCol::Cpu => a.cpu.partial_cmp(&b.cpu).unwrap_or(std::cmp::Ordering::Equal),
                SortCol::Mem => a.mem.cmp(&b.mem),
                SortCol::Uptime => a.uptime.cmp(&b.uptime),
            };
            if self.asc {
                ord
            } else {
                ord.reverse()
            }
        });
        out
    }

    pub fn ui(&mut self, ui: &mut Ui, sh: &mut Shared) {
        sh.ensure_guests();
        if let Some(Focus::Guest { host_id, node, vmid, kind }) = sh.focus.clone() {
            if kind == self.kind {
                sh.focus = None;
                let key = GuestKey { host_id, node, vmid, kind };
                self.open(key);
            }
        }

        let (total, running) = sh
            .guests
            .data
            .as_ref()
            .map(|d| {
                let src = if self.kind == Kind::Vm { &d.vms } else { &d.containers };
                (src.len(), src.iter().filter(|g| g.running()).count())
            })
            .unwrap_or((0, 0));
        let heading = self.kind.plural();
        let context = format!("{total} gesamt · {running} laufen");
        let can_create = sh.user.can(&self.kind.perm("create"));
        let kind = self.kind;
        w::page_header(ui, heading, Some(&context), |ui| {
            let label = if kind == Kind::Vm { "VM erstellen" } else { "Container erstellen" };
            if ui
                .add(Btn::primary(label).icon(ph::PLUS).enabled(can_create))
                .on_disabled_hover_text("Keine Berechtigung")
                .clicked()
            {
                sh.go(if kind == Kind::Vm { Page::CreateVm } else { Page::CreateLxc });
            }
        });

        // Toolbar
        ui.horizontal(|ui| {
            w::search_input(ui, &mut self.search, "Name, ID, Tag, IP …", 280.0);
            w::segmented(
                ui,
                &mut self.status,
                &[
                    (StatusFilter::All, "Alle"),
                    (StatusFilter::Running, "Laufend"),
                    (StatusFilter::Stopped, "Gestoppt"),
                    (StatusFilter::Paused, "Pausiert"),
                ],
            );
            let hosts: Vec<(Option<String>, String)> = std::iter::once((None, "Alle Hosts".to_owned()))
                .chain(
                    sh.hosts
                        .data
                        .iter()
                        .flatten()
                        .map(|h| (Some(h.id.clone()), h.name.clone())),
                )
                .collect();
            if hosts.len() > 2 {
                w::combo(ui, ("guest_host", self.kind.key()), &mut self.host, &hosts, 170.0);
            }
        });
        ui.add_space(10.0);

        if !self.checked.is_empty() {
            self.bulk_bar(ui, sh);
            ui.add_space(8.0);
        }

        let narrow = ui.available_width() < 900.0;
        if let (true, Some(insp)) = (narrow, &mut self.inspector) {
            if insp.ui(ui, sh) {
                self.inspector = None;
            }
            return;
        }
        if let Some(insp) = &mut self.inspector {
            let mut close = false;
            egui::SidePanel::right(egui::Id::new(("guest_inspector", self.kind.key())))
                .resizable(true)
                .default_width(520.0)
                .width_range(420.0..=760.0)
                .show_separator_line(false)
                .frame(egui::Frame::new().fill(c::BG).inner_margin(egui::Margin { left: 16, right: 0, top: 0, bottom: 0 }))
                .show_inside(ui, |ui| {
                    close = insp.ui(ui, sh);
                });
            if close {
                self.inspector = None;
            }
        }
        egui::CentralPanel::default()
            .frame(egui::Frame::new())
            .show_inside(ui, |ui| self.table(ui, sh));
    }

    #[cfg(feature = "demo")]
    pub fn demo_config_tab(&mut self) {
        if let Some(i) = &mut self.inspector {
            i.demo_config_tab();
        }
    }

    fn open(&mut self, key: GuestKey) {
        if self.inspector.as_ref().is_some_and(|i| i.key == key) {
            return;
        }
        self.inspector = Some(GuestInspector::new(key));
    }

    fn table(&mut self, ui: &mut Ui, sh: &mut Shared) {
        let list = self.list(sh);
        if sh.guests.data.is_none() {
            w::panel_frame().show(ui, |ui| {
                ui.set_min_width(ui.available_width());
                if let Some(err) = sh.guests.error.clone() {
                    if w::error_box(ui, &err) {
                        sh.guests.invalidate();
                    }
                } else {
                    w::skeleton(ui, 8);
                }
            });
            return;
        }
        if list.is_empty() {
            w::panel_frame().show(ui, |ui| {
                ui.set_min_width(ui.available_width());
                let filtered = !self.search.is_empty() || self.status != StatusFilter::All || self.host.is_some();
                if filtered {
                    w::empty_state(ui, ph::FUNNEL, "Keine Treffer", "Filter anpassen oder Suche leeren.");
                } else {
                    let (title, text) = match self.kind {
                        Kind::Vm => ("Keine VMs", "Erstelle eine VM oder lass dir Gäste zuweisen."),
                        Kind::Lxc => ("Keine Container", "Erstelle einen Container oder lass dir Gäste zuweisen."),
                    };
                    w::empty_state(ui, ph::CUBE, title, text);
                }
            });
            return;
        }

        let width = ui.available_width();
        let show_ip = width > 860.0;
        let show_uptime = width > 760.0;
        let show_mem = width > 640.0;
        let show_host = width > 560.0;
        let selected = self.inspector.as_ref().map(|i| i.key.clone());
        let mut clicked: Option<GuestKey> = None;
        let mut sort_click: Option<SortCol> = None;
        let mut actions: Vec<(GuestKey, &'static str)> = Vec::new();
        let kind = self.kind;

        w::panel_frame()
            .inner_margin(egui::Margin::symmetric(10, 8))
            .show(ui, |ui| {
                ui.set_min_width(ui.available_width());
                let top = ui.cursor().top();
                ui.painter().hline(ui.max_rect().x_range(), top + 32.0, Stroke::new(1.0_f32, c::BORDER));
                let mut tb = TableBuilder::new(ui)
                    .id_salt(("guests", kind.key()))
                    .striped(true)
                    .sense(Sense::click())
                    .auto_shrink([false, false])
                    .cell_layout(Layout::left_to_right(Align::Center))
                    .column(Column::exact(26.0))
                    .column(Column::exact(58.0))
                    .column(Column::remainder().at_least(150.0).clip(true))
                    .column(Column::exact(104.0));
                if show_host {
                    tb = tb.column(Column::exact(130.0).clip(true));
                }
                tb = tb.column(Column::exact(118.0));
                if show_mem {
                    tb = tb.column(Column::exact(150.0));
                }
                if show_ip {
                    tb = tb.column(Column::exact(128.0).clip(true));
                }
                if show_uptime {
                    tb = tb.column(Column::exact(84.0));
                }
                tb = tb.column(Column::exact(44.0));
                tb.header(32.0, |mut row| {
                    row.col(|_| {});
                    row.col(|ui| sort_header(ui, "ID", SortCol::Id, self.sort, self.asc, &mut sort_click));
                    row.col(|ui| sort_header(ui, "Name", SortCol::Name, self.sort, self.asc, &mut sort_click));
                    row.col(|ui| w::th(ui, "Status"));
                    if show_host {
                        row.col(|ui| w::th(ui, "Host · Node"));
                    }
                    row.col(|ui| sort_header(ui, "CPU", SortCol::Cpu, self.sort, self.asc, &mut sort_click));
                    if show_mem {
                        row.col(|ui| sort_header(ui, "RAM", SortCol::Mem, self.sort, self.asc, &mut sort_click));
                    }
                    if show_ip {
                        row.col(|ui| w::th(ui, "IP"));
                    }
                    if show_uptime {
                        row.col(|ui| sort_header(ui, "Uptime", SortCol::Uptime, self.sort, self.asc, &mut sort_click));
                    }
                    row.col(|_| {});
                })
                .body(|body| {
                    body.rows(ROW_H + 6.0, list.len(), |mut row| {
                        let g = list[row.index()];
                        let key = GuestKey::of(g, kind);
                        row.set_selected(selected.as_ref() == Some(&key));
                        let busy = sh.op_running(&key.op_key());
                        row.col(|ui| {
                            let mut on = self.checked.contains(&key);
                            if ui.checkbox(&mut on, "").changed() {
                                if on {
                                    self.checked.insert(key.clone());
                                } else {
                                    self.checked.remove(&key);
                                }
                            }
                        });
                        row.col(|ui| {
                            ui.label(RichText::new(g.vmid.to_string()).font(theme::mono(12.5)).color(c::TEXT_2));
                        });
                        row.col(|ui| {
                            ui.vertical(|ui| {
                                ui.spacing_mut().item_spacing.y = 1.0;
                                ui.horizontal(|ui| {
                                    ui.spacing_mut().item_spacing.x = 6.0;
                                    ui.add(egui::Label::new(w::strong(g.display_name())).truncate());
                                    if g.template {
                                        w::badge(ui, "Vorlage", c::PURPLE);
                                    }
                                });
                                let tags = g.tag_list();
                                if !tags.is_empty() {
                                    ui.label(w::small(tags.join(" · ")));
                                }
                            });
                        });
                        row.col(|ui| {
                            if busy {
                                ui.spinner();
                                ui.label(w::small("läuft …"));
                            } else {
                                w::state_badge(ui, &g.status);
                            }
                        });
                        if show_host {
                            row.col(|ui| {
                                ui.vertical(|ui| {
                                    ui.spacing_mut().item_spacing.y = 1.0;
                                    ui.add(egui::Label::new(w::secondary(g.host_name.clone().unwrap_or_default())).truncate());
                                    ui.label(w::small(g.node.clone()));
                                });
                            });
                        }
                        row.col(|ui| {
                            if g.running() {
                                w::meter_cell(ui, Some(g.cpu as f32));
                            } else {
                                ui.label(w::small(format!("{} vCPU", g.cpus)));
                            }
                        });
                        if show_mem {
                            row.col(|ui| {
                                if g.maxmem > 0 && g.running() {
                                    ui.vertical(|ui| {
                                        ui.spacing_mut().item_spacing.y = 3.0;
                                        ui.label(RichText::new(format::used_of(g.mem, g.maxmem)).font(theme::mono(11.0)).color(c::TEXT_2));
                                        w::meter(ui, format::ratio(g.mem, g.maxmem), 120.0, 4.0);
                                    });
                                } else {
                                    ui.label(w::small(format::bytes(g.maxmem)));
                                }
                            });
                        }
                        if show_ip {
                            row.col(|ui| {
                                let ip = g.ips.as_ref().and_then(|i| i.first().cloned()).unwrap_or_default();
                                if ip.is_empty() {
                                    ui.label(w::small("—"));
                                } else {
                                    ui.add(egui::Label::new(w::mono(ip)).truncate());
                                }
                            });
                        }
                        if show_uptime {
                            row.col(|ui| {
                                ui.label(w::mono(if g.running() { format::uptime(g.uptime) } else { "—".into() }));
                            });
                        }
                        row.col(|ui| {
                            let host = g.host_id.clone().unwrap_or_default();
                            let h = sh.host(&host);
                            if g.running() {
                                let ok = sh.user.can_guest(h, &host, kind, g.vmid, &kind.perm("shutdown"));
                                if ui.add(Btn::icon_only(ph::POWER, "Herunterfahren").small().enabled(ok && !busy)).clicked() {
                                    actions.push((key.clone(), "shutdown"));
                                }
                            } else if !g.template {
                                let ok = sh.user.can_guest(h, &host, kind, g.vmid, &kind.perm("start"));
                                if ui.add(Btn::icon_only(ph::PLAY, "Starten").small().enabled(ok && !busy)).clicked() {
                                    actions.push((key.clone(), "start"));
                                }
                            }
                        });
                        if row.response().clicked() {
                            clicked = Some(key);
                        }
                    });
                });
            });

        if let Some(col) = sort_click {
            if self.sort == col {
                self.asc = !self.asc;
            } else {
                self.sort = col;
                self.asc = matches!(col, SortCol::Id | SortCol::Name);
            }
        }
        for (key, action) in actions {
            let name = list_name(sh, &key);
            power_action(sh, &key, &name, action);
        }
        if let Some(key) = clicked {
            self.open(key);
        }
    }

    fn bulk_bar(&mut self, ui: &mut Ui, sh: &mut Shared) {
        let n = self.checked.len();
        let mut clear = false;
        let mut run: Option<&'static str> = None;
        w::panel_frame()
            .fill(theme::tint(c::PINK, 16))
            .inner_margin(egui::Margin::symmetric(12, 8))
            .show(ui, |ui| {
                ui.set_min_width(ui.available_width());
                ui.horizontal(|ui| {
                    ui.label(w::strong(format!("{n} ausgewählt")));
                    ui.add_space(8.0);
                    if ui.add(Btn::secondary("Starten").icon(ph::PLAY).small()).clicked() {
                        run = Some("start");
                    }
                    if ui.add(Btn::secondary("Herunterfahren").icon(ph::POWER).small()).clicked() {
                        run = Some("shutdown");
                    }
                    if ui.add(Btn::secondary("Neustarten").icon(ph::ARROW_COUNTER_CLOCKWISE).small()).clicked() {
                        run = Some("reboot");
                    }
                    if ui.add(Btn::secondary("Stoppen").icon(ph::STOP).small()).clicked() {
                        run = Some("stop");
                    }
                    ui.with_layout(Layout::right_to_left(Align::Center), |ui| {
                        if ui.add(Btn::ghost("Auswahl aufheben").small()).clicked() {
                            clear = true;
                        }
                    });
                });
            });
        if clear {
            self.checked.clear();
        }
        if let Some(action) = run {
            let keys: Vec<GuestKey> = self.checked.iter().cloned().collect();
            let label = action_label(action);
            let run_all = move |sh: &mut Shared| {
                for key in &keys {
                    let name = list_name(sh, key);
                    send_action(sh, key, &name, action);
                }
            };
            if action == "start" {
                run_all(sh);
            } else {
                sh.confirm(
                    format!("{n} Gäste: {label}?"),
                    "Die Aktion wird für alle ausgewählten Gäste ausgeführt, für die du berechtigt bist.",
                    label,
                    action == "stop",
                    run_all,
                );
            }
            self.checked.clear();
        }
    }
}

fn sort_header(ui: &mut Ui, text: &str, col: SortCol, current: SortCol, asc: bool, click: &mut Option<SortCol>) {
    let arrow = if current == col {
        if asc { " ↑" } else { " ↓" }
    } else {
        ""
    };
    let color = if current == col { c::TEXT } else { c::MUTED };
    let r = ui.add(
        egui::Label::new(RichText::new(format!("{text}{arrow}")).font(theme::medium(12.0)).color(color))
            .sense(Sense::click()),
    );
    if r.clicked() {
        *click = Some(col);
    }
}

pub fn list_name(sh: &Shared, key: &GuestKey) -> String {
    sh.guests
        .data
        .as_ref()
        .and_then(|d| {
            let src = if key.kind == Kind::Vm { &d.vms } else { &d.containers };
            src.iter()
                .find(|g| g.vmid == key.vmid && g.host_id.as_deref() == Some(key.host_id.as_str()))
                .map(Guest::display_name)
        })
        .unwrap_or_else(|| format!("{} {}", key.kind.label(), key.vmid))
}

pub fn action_label(action: &str) -> &'static str {
    match action {
        "start" => "Starten",
        "shutdown" => "Herunterfahren",
        "reboot" => "Neustarten",
        "stop" => "Stoppen",
        "reset" => "Reset",
        "pause" => "Pausieren",
        "resume" => "Fortsetzen",
        _ => "Aktion",
    }
}

fn action_perm(action: &str) -> &'static str {
    match action {
        "stop" => "force-stop",
        "start" => "start",
        "shutdown" => "shutdown",
        "reboot" => "reboot",
        "reset" => "reset",
        "pause" => "pause",
        "resume" => "resume",
        _ => "view",
    }
}

/// Sends a power action without confirmation (after the caller confirmed).
pub fn send_action(sh: &mut Shared, key: &GuestKey, name: &str, action: &'static str) {
    let host = sh.host(&key.host_id);
    if !sh
        .user
        .can_guest(host, &key.host_id, key.kind, key.vmid, &key.kind.perm(action_perm(action)))
    {
        return;
    }
    let path = key.path();
    let mut body = json!({ "action": action, "wait": false });
    if action == "reset" {
        body["confirm"] = Value::Bool(true);
    }
    let label = format!("{} · {name}", action_label(action));
    sh.run_task(key.op_key(), label, &key.host_id, &[Tag::Guests, Tag::Tasks], move |c| {
        c.post::<Value>(&path, &body)
    });
}

/// Power action with the web UI's confirmation rules.
pub fn power_action(sh: &mut Shared, key: &GuestKey, name: &str, action: &'static str) {
    let key2 = key.clone();
    let name2 = name.to_owned();
    match action {
        "start" | "resume" | "pause" => send_action(sh, key, name, action),
        "shutdown" => sh.confirm(
            format!("{name} herunterfahren?"),
            "Sendet ein ACPI-Shutdown. Der Gast fährt sauber herunter.",
            "Herunterfahren",
            false,
            move |sh| send_action(sh, &key2, &name2, "shutdown"),
        ),
        "reboot" => sh.confirm(
            format!("{name} neu starten?"),
            "Der Gast wird über das Betriebssystem neu gestartet.",
            "Neustarten",
            false,
            move |sh| send_action(sh, &key2, &name2, "reboot"),
        ),
        "stop" => sh.confirm(
            format!("{name} hart stoppen?"),
            "Entspricht dem Ziehen des Netzsteckers. Nicht gespeicherte Daten im Gast gehen verloren.",
            "Stoppen",
            true,
            move |sh| send_action(sh, &key2, &name2, "stop"),
        ),
        "reset" => sh.confirm(
            format!("{name} zurücksetzen?"),
            "Harter Reset der VM ohne Herunterfahren.",
            "Reset",
            true,
            move |sh| send_action(sh, &key2, &name2, "reset"),
        ),
        _ => {}
    }
}
