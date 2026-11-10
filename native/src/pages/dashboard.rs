use crate::app::shared::{Page, Shared, Tag};
use crate::net::{CpuTemps, Dashboard, DiskAlerts, HostOverview, Resource};
use crate::theme::{self, c, ROW_H};
use crate::ui::format;
use crate::ui::widgets::{self as w, Btn};
use eframe::egui::{self, Align, Layout, RichText, Sense, Stroke, Ui, Vec2};
use egui_extras::{Column, TableBuilder};
use egui_phosphor::regular as ph;
use std::time::Duration;

#[derive(Default)]
pub struct DashboardPage {
    data: Resource<Dashboard>,
    disk: Resource<DiskAlerts>,
    temps: Resource<CpuTemps>,
}

impl DashboardPage {
    fn load(&mut self, sh: &mut Shared) {
        let epoch = sh.epoch(Tag::Hosts);
        let client = sh.client.clone();
        self.data.ensure(&sh.ctx, Duration::from_secs(30), epoch, || {
            move || client.get::<Dashboard>("/api/dashboard")
        });
        let client = sh.client.clone();
        self.disk.ensure(&sh.ctx, Duration::from_secs(90), sh.epoch(Tag::Storage), || {
            move || client.get::<DiskAlerts>("/api/disk-alerts")
        });
        let client = sh.client.clone();
        self.temps.ensure(&sh.ctx, Duration::from_secs(90), epoch, || {
            move || client.get::<CpuTemps>("/api/cpu-temp")
        });
        sh.ensure_guests();
    }

    pub fn ui(&mut self, ui: &mut Ui, sh: &mut Shared) {
        self.load(sh);
        let context = self.data.data.as_ref().map(|d| {
            format!(
                "{} von {} Hosts online · {} von {} Gästen laufen",
                d.hosts.online,
                d.hosts.total,
                d.virtualization.running,
                d.virtualization.vms + d.virtualization.lxc
            )
        });
        w::page_header(ui, "Übersicht", context.as_deref(), |ui| {
            if ui
                .add(Btn::secondary("Aktualisieren").icon(ph::ARROW_CLOCKWISE).loading(self.data.loading()))
                .clicked()
            {
                sh.bump(Tag::Hosts);
                sh.bump(Tag::Guests);
            }
        });

        let Some(dash) = self.data.data.clone() else {
            if let Some(err) = self.data.error.clone() {
                if w::error_box(ui, &err) {
                    self.data.invalidate();
                }
            } else {
                w::panel_frame().show(ui, |ui| {
                    ui.set_min_width(ui.available_width());
                    w::skeleton(ui, 6);
                });
            }
            return;
        };
        if let Some(err) = &self.data.error {
            w::callout(ui, ph::WARNING, c::WARN, &format!("Anzeige veraltet: {}", err.message));
            ui.add_space(10.0);
        }

        egui::ScrollArea::vertical()
            .auto_shrink([false, false])
            .show(ui, |ui| {
                summary_strip(ui, &dash);
                ui.add_space(16.0);
                self.attention(ui, sh, &dash);
                hosts_table(ui, sh, &dash);
            });
    }

    fn attention(&mut self, ui: &mut Ui, sh: &mut Shared, dash: &Dashboard) {
        struct Item {
            icon: &'static str,
            color: egui::Color32,
            text: String,
            action: Option<(&'static str, Target)>,
        }
        enum Target {
            Host(String),
            Page(Page),
        }
        let mut items: Vec<Item> = Vec::new();
        for h in &dash.hosts.items {
            let state = h.connection_state.to_ascii_lowercase();
            if state != "online" {
                let (color, _) = theme::state_tone(&state);
                let detail = h.last_error.clone().filter(|e| !e.is_empty()).map(|d| format!(" — {d}")).unwrap_or_default();
                let what = match state.as_str() {
                    "offline" => "ist offline",
                    "maintenance" => "ist im Wartungsmodus",
                    "connecting" => "verbindet sich",
                    _ => "meldet einen Fehler",
                };
                items.push(Item {
                    icon: ph::WARNING_CIRCLE,
                    color,
                    text: format!("{} {what}{detail}", h.name),
                    action: Some(("Host öffnen", Target::Host(h.id.clone()))),
                });
            }
        }
        if let Some(summary) = &sh.update_summary.data {
            for h in summary.hosts.iter().filter(|h| h.count > 0) {
                items.push(Item {
                    icon: ph::PACKAGE,
                    color: c::WARN,
                    text: format!("{}: {} Paket-Update{} verfügbar", h.name, h.count, if h.count == 1 { "" } else { "s" }),
                    action: Some(("Updates", Target::Page(Page::Updates))),
                });
            }
        }
        if let Some(disk) = &self.disk.data {
            for s in disk.samples.iter().take(6) {
                items.push(Item {
                    icon: ph::HARD_DRIVES,
                    color: if s.percent >= disk.alert_percent { c::DANGER } else { c::WARN },
                    text: format!("{} auf {}: {:.0} % belegt", s.name, s.host_name, s.percent),
                    action: Some(("Storage", Target::Page(Page::Storage))),
                });
            }
        }
        if let Some(temps) = &self.temps.data {
            for s in temps.samples.iter().take(4) {
                items.push(Item {
                    icon: ph::THERMOMETER,
                    color: c::DANGER,
                    text: format!("{} ({}): CPU {:.0} °C", s.host_name, s.node.clone().unwrap_or_default(), s.celsius),
                    action: Some(("Host öffnen", Target::Host(s.host_id.clone()))),
                });
            }
        }
        for t in sh.tasks.iter().filter(|t| !t.running() && !t.ok).take(3) {
            items.push(Item {
                icon: ph::X_CIRCLE,
                color: c::DANGER,
                text: format!("{} fehlgeschlagen: {}", t.label, t.error.clone().unwrap_or_default()),
                action: Some(("Aufgaben", Target::Page(Page::Tasks))),
            });
        }
        if items.is_empty() {
            return;
        }
        let mut go: Option<Target> = None;
        w::section(ui, "Braucht Aufmerksamkeit", |ui| {
            ui.label(w::small(format!("{} Hinweise", items.len())));
        }, |ui| {
            for (i, item) in items.iter().enumerate() {
                if i > 0 {
                    w::separator(ui);
                }
                ui.horizontal(|ui| {
                    ui.label(w::icon_text(item.icon, 16.0, item.color));
                    ui.add(egui::Label::new(w::body(item.text.clone())).truncate());
                    if let Some((label, target)) = &item.action {
                        ui.with_layout(Layout::right_to_left(Align::Center), |ui| {
                            if ui.add(Btn::ghost(label).small().icon(ph::ARROW_RIGHT)).clicked() {
                                go = Some(match target {
                                    Target::Host(id) => Target::Host(id.clone()),
                                    Target::Page(p) => Target::Page(*p),
                                });
                            }
                        });
                    }
                });
            }
        });
        ui.add_space(16.0);
        match go {
            Some(Target::Host(id)) => sh.open_host(&id),
            Some(Target::Page(p)) => sh.go(p),
            None => {}
        }
    }
}

fn summary_strip(ui: &mut Ui, dash: &Dashboard) {
    w::panel_frame().show(ui, |ui| {
        ui.set_min_width(ui.available_width());
        let cols = 5;
        let gap = 24.0;
        let cell_w = (ui.available_width() - gap * (cols as f32 - 1.0)) / cols as f32;
        ui.horizontal(|ui| {
            ui.spacing_mut().item_spacing.x = gap;
            let v = &dash.virtualization;
            let h = &dash.hosts;
            let r = &dash.resources;
            stat(ui, cell_w, "Hosts", &format!("{} / {}", h.online, h.total), if h.offline + h.warning > 0 { Some((format!("{} gestört", h.offline + h.warning), c::DANGER)) } else { Some(("alle online".into(), c::OK)) }, None);
            stat(ui, cell_w, "Gäste", &format!("{} laufen", v.running), Some((format!("{} VMs · {} Container", v.vms, v.lxc), c::MUTED)), None);
            stat(ui, cell_w, "CPU", &format::percent(r.cpu), Some(("Cluster gesamt".into(), c::MUTED)), Some(r.cpu as f32));
            stat(ui, cell_w, "Arbeitsspeicher", &format::bytes(r.mem_used), Some((format!("von {}", format::bytes(r.mem_total)), c::MUTED)), Some(format::ratio(r.mem_used, r.mem_total)));
            stat(ui, cell_w, "Storage", &format::bytes(r.disk_used), Some((format!("von {}", format::bytes(r.disk_total)), c::MUTED)), Some(format::ratio(r.disk_used, r.disk_total)));
        });
    });
}

fn stat(ui: &mut Ui, width: f32, name: &str, value: &str, sub: Option<(String, egui::Color32)>, frac: Option<f32>) {
    ui.allocate_ui_with_layout(Vec2::new(width, 64.0), Layout::top_down(Align::Min), |ui| {
        ui.set_width(width);
        ui.spacing_mut().item_spacing.y = 3.0;
        ui.label(w::label(name));
        ui.label(RichText::new(value).font(theme::semibold(17.0)).color(c::TEXT));
        if let Some(f) = frac {
            w::meter(ui, f, width, 5.0);
        }
        if let Some((text, color)) = sub {
            ui.label(RichText::new(text).font(theme::regular(11.5)).color(color));
        }
    });
}

fn hosts_table(ui: &mut Ui, sh: &mut Shared, dash: &Dashboard) {
    if dash.hosts.items.is_empty() {
        w::panel_frame().show(ui, |ui| {
            ui.set_min_width(ui.available_width());
            w::empty_state(ui, ph::DESKTOP_TOWER, "Noch keine Hosts", "Füge unter „Hosts“ deinen ersten Proxmox-Server hinzu.");
            ui.vertical_centered(|ui| {
                if ui.add(Btn::primary("Host hinzufügen").icon(ph::PLUS)).clicked() {
                    sh.go(Page::Hosts);
                }
            });
            ui.add_space(16.0);
        });
        return;
    }
    let updates: std::collections::HashMap<String, u64> = sh
        .update_summary
        .data
        .as_ref()
        .map(|s| s.hosts.iter().map(|h| (h.id.clone(), h.count)).collect())
        .unwrap_or_default();
    let alert = if dash.cpu_temp_alert_c > 0.0 { dash.cpu_temp_alert_c } else { 85.0 };
    let mut groups: Vec<(String, Vec<&HostOverview>)> = Vec::new();
    for h in &dash.hosts.items {
        let key = if h.origin.as_deref() == Some("PEER") {
            format!("Geteilt von {}", h.peer_name.clone().unwrap_or_else(|| "Peer".into()))
        } else {
            "Eigene Hosts".into()
        };
        match groups.iter_mut().find(|(k, _)| *k == key) {
            Some((_, list)) => list.push(h),
            None => groups.push((key, vec![h])),
        }
    }
    let mut open: Option<String> = None;
    let show_group_titles = groups.len() > 1;
    for (gi, (group, hosts)) in groups.iter().enumerate() {
        let online = hosts.iter().filter(|h| h.connection_state.eq_ignore_ascii_case("online")).count();
        let heading = if show_group_titles { group.clone() } else { "Hosts".into() };
        w::section(ui, &heading, |ui| {
            ui.label(w::small(format!("{online} / {} online", hosts.len())));
        }, |ui| {
            let top = ui.cursor().top();
            ui.painter().hline(ui.max_rect().x_range(), top + 30.0, Stroke::new(1.0_f32, c::BORDER));
            TableBuilder::new(ui)
                .id_salt(("dash_hosts", gi))
                .striped(true)
                .sense(Sense::click())
                .cell_layout(Layout::left_to_right(Align::Center))
                .column(Column::remainder().at_least(180.0).clip(true))
                .column(Column::exact(96.0))
                .column(Column::exact(140.0))
                .column(Column::exact(170.0))
                .column(Column::exact(170.0))
                .column(Column::exact(70.0))
                .column(Column::exact(90.0))
                .column(Column::exact(80.0))
                .header(30.0, |mut row| {
                    for title in ["Host", "Status", "CPU", "RAM", "Storage", "Temp.", "Uptime", "Updates"] {
                        row.col(|ui| w::th(ui, title));
                    }
                })
                .body(|mut body| {
                    for h in hosts {
                        body.row(ROW_H + 8.0, |mut row| {
                            row.col(|ui| {
                                ui.vertical(|ui| {
                                    ui.spacing_mut().item_spacing.y = 1.0;
                                    ui.label(w::strong(h.name.clone()));
                                    let mut sub = h
                                        .proxmox_version
                                        .clone()
                                        .map(|v| format!("PVE {v}"))
                                        .unwrap_or_default();
                                    if let (Some(n), Some(o)) = (h.node_count, h.online_nodes) {
                                        if n > 1 {
                                            sub.push_str(&format!(" · {o}/{n} Nodes"));
                                        }
                                    }
                                    ui.label(w::small(sub));
                                });
                            });
                            row.col(|ui| {
                                w::state_badge(ui, &h.connection_state);
                            });
                            let online = h.connection_state.eq_ignore_ascii_case("online");
                            row.col(|ui| {
                                if online {
                                    w::meter_cell(ui, h.cpu.map(|v| v as f32));
                                } else {
                                    ui.label(w::small("—"));
                                }
                            });
                            row.col(|ui| usage_cell(ui, online, h.mem_used, h.mem_total));
                            row.col(|ui| usage_cell(ui, online, h.disk_used, h.disk_total));
                            row.col(|ui| match h.cpu_temp_c {
                                Some(t) if online => {
                                    let color = if t >= alert { c::DANGER } else if t >= alert - 10.0 { c::WARN } else { c::TEXT_2 };
                                    ui.label(RichText::new(format!("{t:.0} °C")).font(theme::mono(12.0)).color(color));
                                }
                                _ => {
                                    let text = match h.cpu_temp_state.as_deref() {
                                        Some("reading") => "…",
                                        _ => "—",
                                    };
                                    ui.label(w::small(text));
                                }
                            });
                            row.col(|ui| {
                                ui.label(w::mono(h.uptime.map(format::uptime).unwrap_or_else(|| "—".into())));
                            });
                            row.col(|ui| match updates.get(&h.id) {
                                Some(n) if *n > 0 => {
                                    w::badge(ui, &n.to_string(), c::WARN);
                                }
                                _ => {
                                    ui.label(w::small("—"));
                                }
                            });
                            if row.response().clicked() {
                                open = Some(h.id.clone());
                            }
                        });
                    }
                });
        });
        ui.add_space(16.0);
    }
    if let Some(id) = open {
        sh.open_host(&id);
    }
}

fn usage_cell(ui: &mut Ui, online: bool, used: Option<u64>, total: Option<u64>) {
    match (online, used, total) {
        (true, Some(u), Some(t)) if t > 0 => {
            ui.vertical(|ui| {
                ui.spacing_mut().item_spacing.y = 3.0;
                ui.label(RichText::new(format::used_of(u, t)).font(theme::mono(11.5)).color(c::TEXT_2));
                w::meter(ui, format::ratio(u, t), 130.0, 4.0);
            });
        }
        _ => {
            ui.label(w::small("—"));
        }
    }
}
