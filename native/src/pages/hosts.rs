use crate::app::dialog::form_modal;
use crate::app::shared::{Focus, Shared, Tag};
use crate::net::{seg, ClusterInfo, ConnectionTest, Host, HostStatus, Kind, Pending, ApiResult, Resource};
use crate::term::TermRequest;
use crate::theme::{self, c, ROW_H};
use crate::ui::format;
use crate::ui::widgets::{self as w, Btn};
use eframe::egui::{self, Align, Layout, RichText, Sense, Stroke, Ui};
use egui_extras::{Column, TableBuilder};
use egui_phosphor::regular as ph;
use serde_json::{json, Value};
use std::time::Duration;

#[derive(Default)]
pub struct HostsPage {
    search: String,
    selected: Option<String>,
    inspector: Option<HostInspector>,
    editor: Option<HostEditor>,
}

impl HostsPage {
    pub fn ui(&mut self, ui: &mut Ui, sh: &mut Shared) {
        sh.ensure_hosts();
        if let Some(Focus::Host(id)) = sh.focus.clone() {
            sh.focus = None;
            self.select(&id);
        }
        let hosts = sh.hosts.data.clone().unwrap_or_default();
        let online = hosts.iter().filter(|h| h.online()).count();
        let can_create = sh.user.can("hosts.create");
        let mut add = false;
        w::page_header(ui, "Hosts", Some(&format!("{} Hosts · {online} online", hosts.len())), |ui| {
            if ui.add(Btn::primary("Host hinzufügen").icon(ph::PLUS).enabled(can_create)).on_disabled_hover_text("Keine Berechtigung").clicked() {
                add = true;
            }
        });
        if add {
            self.editor = Some(HostEditor::new(None));
        }
        ui.horizontal(|ui| {
            w::search_input(ui, &mut self.search, "Name oder Adresse …", 280.0);
        });
        ui.add_space(10.0);

        let narrow = ui.available_width() < 900.0;
        if let (true, Some(insp)) = (narrow, &mut self.inspector) {
            let (close, edit) = insp.ui(ui, sh);
            if close {
                self.inspector = None;
                self.selected = None;
            }
            if let Some(h) = edit {
                self.editor = Some(HostEditor::new(Some(&h)));
            }
            if let Some(ed) = &mut self.editor {
                if ed.ui(ui.ctx(), sh) {
                    self.editor = None;
                }
            }
            return;
        }
        if let Some(insp) = &mut self.inspector {
            let mut close = false;
            let mut edit: Option<Host> = None;
            egui::SidePanel::right("host_inspector")
                .resizable(true)
                .default_width(560.0)
                .width_range(440.0..=820.0)
                .show_separator_line(false)
                .frame(egui::Frame::new().fill(c::BG).inner_margin(egui::Margin { left: 16, right: 0, top: 0, bottom: 0 }))
                .show_inside(ui, |ui| {
                    let (c2, e2) = insp.ui(ui, sh);
                    close = c2;
                    edit = e2;
                });
            if close {
                self.inspector = None;
                self.selected = None;
            }
            if let Some(h) = edit {
                self.editor = Some(HostEditor::new(Some(&h)));
            }
        }
        egui::CentralPanel::default().frame(egui::Frame::new()).show_inside(ui, |ui| {
            self.table(ui, sh, &hosts);
        });
        if let Some(ed) = &mut self.editor {
            if ed.ui(ui.ctx(), sh) {
                self.editor = None;
            }
        }
    }

    fn select(&mut self, id: &str) {
        if self.selected.as_deref() != Some(id) {
            self.selected = Some(id.to_owned());
            self.inspector = Some(HostInspector::new(id));
        }
    }

    fn table(&mut self, ui: &mut Ui, sh: &mut Shared, hosts: &[Host]) {
        if sh.hosts.data.is_none() {
            w::panel_frame().show(ui, |ui| {
                ui.set_min_width(ui.available_width());
                match sh.hosts.error.clone() {
                    Some(err) => {
                        if w::error_box(ui, &err) {
                            sh.hosts.invalidate();
                        }
                    }
                    None => w::skeleton(ui, 5),
                }
            });
            return;
        }
        let q = self.search.trim().to_lowercase();
        let list: Vec<&Host> = hosts
            .iter()
            .filter(|h| q.is_empty() || format!("{} {}", h.name, h.url).to_lowercase().contains(&q))
            .collect();
        if list.is_empty() {
            w::panel_frame().show(ui, |ui| {
                ui.set_min_width(ui.available_width());
                if q.is_empty() {
                    w::empty_state(ui, ph::DESKTOP_TOWER, "Noch keine Hosts", "Verbinde Proxora mit einem Proxmox-VE-Server über API-Token oder Passwort.");
                } else {
                    w::empty_state(ui, ph::FUNNEL, "Keine Treffer", "Suche anpassen.");
                }
            });
            return;
        }
        let mut clicked: Option<String> = None;
        let width = ui.available_width();
        let wide = width > 760.0;
        w::panel_frame().inner_margin(egui::Margin::symmetric(10, 8)).show(ui, |ui| {
            ui.set_min_width(ui.available_width());
            let top = ui.cursor().top();
            ui.painter().hline(ui.max_rect().x_range(), top + 32.0, Stroke::new(1.0_f32, c::BORDER));
            let mut tb = TableBuilder::new(ui)
                .id_salt("hosts_table")
                .striped(true)
                .sense(Sense::click())
                .auto_shrink([false, false])
                .cell_layout(Layout::left_to_right(Align::Center))
                .column(Column::remainder().at_least(180.0).clip(true))
                .column(Column::exact(104.0))
                .column(Column::exact(110.0));
            if wide {
                tb = tb.column(Column::exact(150.0).clip(true));
            }
            tb = tb.column(Column::exact(80.0));
            tb.header(32.0, |mut r| {
                r.col(|ui| w::th(ui, "Host"));
                r.col(|ui| w::th(ui, "Status"));
                r.col(|ui| w::th(ui, "Proxmox VE"));
                if wide {
                    r.col(|ui| w::th(ui, "Cluster"));
                }
                r.col(|ui| w::th(ui, "Updates"));
            })
            .body(|body| {
                body.rows(ROW_H + 10.0, list.len(), |mut row| {
                    let h = list[row.index()];
                    row.set_selected(self.selected.as_deref() == Some(h.id.as_str()));
                    row.col(|ui| {
                        ui.vertical(|ui| {
                            ui.spacing_mut().item_spacing.y = 1.0;
                            ui.horizontal(|ui| {
                                ui.add(egui::Label::new(w::strong(h.name.clone())).truncate());
                                if h.is_peer() {
                                    w::badge(ui, &format!("von {}", h.peer_name.clone().unwrap_or_else(|| "Peer".into())), c::CYAN);
                                }
                            });
                            let sub = if h.is_peer() { format!("Freigabe: {}", h.share_level.clone().unwrap_or_default()) } else { h.url.clone() };
                            ui.add(egui::Label::new(w::small(sub)).truncate());
                        });
                    });
                    row.col(|ui| {
                        w::state_badge(ui, &h.connection_state);
                    });
                    row.col(|ui| {
                        ui.label(w::mono(h.proxmox_version.clone().unwrap_or_else(|| "—".into())));
                    });
                    if wide {
                        row.col(|ui| {
                            let text = if h.is_cluster_member { h.cluster_name.clone().unwrap_or_else(|| "Cluster".into()) } else { "Standalone".into() };
                            ui.label(w::secondary(text));
                        });
                    }
                    row.col(|ui| {
                        if h.apt_update_count > 0 {
                            w::badge(ui, &h.apt_update_count.to_string(), c::WARN);
                        } else {
                            ui.label(w::small("—"));
                        }
                    });
                    if row.response().clicked() {
                        clicked = Some(h.id.clone());
                    }
                });
            });
        });
        if let Some(id) = clicked {
            self.select(&id);
        }
    }
}

// ---------------------------------------------------------------- inspector

#[derive(Clone, Copy, PartialEq, Eq)]
enum HostTab {
    Nodes,
    Cluster,
    Guests,
    Storage,
    Info,
}

pub struct HostInspector {
    id: String,
    tab: HostTab,
    status: Resource<HostStatus>,
    cluster: Resource<ClusterInfo>,
    test: Option<Pending<ApiResult<ConnectionTest>>>,
}

impl HostInspector {
    fn new(id: &str) -> Self {
        Self {
            id: id.to_owned(),
            tab: HostTab::Nodes,
            status: Resource::new(),
            cluster: Resource::new(),
            test: None,
        }
    }

    /// Returns (close, edit request).
    fn ui(&mut self, ui: &mut Ui, sh: &mut Shared) -> (bool, Option<Host>) {
        let mut close = false;
        let mut edit = None;
        let Some(host) = sh.host(&self.id).cloned() else {
            ui.label(w::muted("Host nicht mehr vorhanden."));
            return (true, None);
        };
        let client = sh.client.clone();
        let id = self.id.clone();
        self.status.ensure(&sh.ctx, Duration::from_secs(45), sh.epoch(Tag::Hosts), || {
            move || client.get::<HostStatus>(&format!("/api/hosts/{}/status", seg(&id)))
        });
        if host.is_cluster_member {
            let client = sh.client.clone();
            let id = self.id.clone();
            self.cluster.ensure(&sh.ctx, Duration::from_secs(60), sh.epoch(Tag::Hosts), || {
                move || client.get::<ClusterInfo>(&format!("/api/hosts/{}/cluster", seg(&id)))
            });
        }
        if let Some(res) = self.test.as_ref().and_then(Pending::poll) {
            self.test = None;
            sh.bump(Tag::Hosts);
            match res {
                Ok(t) if t.ok => sh.toasts.success(format!("{}: Verbindung OK", host.name)),
                Ok(t) => sh.toasts.error(format!("{}: Test fehlgeschlagen", host.name), t.error.unwrap_or_default()),
                Err(e) => sh.toasts.error(format!("{}: Test fehlgeschlagen", host.name), e.message),
            }
        }

        w::panel_frame().show(ui, |ui| {
            ui.set_min_width(ui.available_width());
            ui.horizontal(|ui| {
                ui.label(w::icon_text(ph::DESKTOP_TOWER, 20.0, c::PINK));
                ui.label(RichText::new(&host.name).font(theme::semibold(17.0)).color(c::TEXT));
                ui.with_layout(Layout::right_to_left(Align::Center), |ui| {
                    if ui.add(Btn::icon_only(ph::X, "Schließen").small()).clicked() {
                        close = true;
                    }
                });
            });
            ui.horizontal(|ui| {
                w::state_badge(ui, &host.connection_state);
                if let Some(v) = &host.proxmox_version {
                    ui.label(w::muted(format!("Proxmox VE {v}")));
                }
                if host.is_peer() {
                    ui.label(w::muted(format!("· geteilt von {}", host.peer_name.clone().unwrap_or_default())));
                }
            });
            if let Some(err) = host.last_error.as_ref().filter(|e| !e.is_empty() && !host.online()) {
                ui.add_space(6.0);
                w::callout(ui, ph::WARNING_CIRCLE, c::DANGER, err);
            }
            ui.add_space(10.0);
            let peer = host.is_peer();
            ui.horizontal_wrapped(|ui| {
                let console_ok = sh.user.can_host(&host, "hosts.console");
                let first_node = self
                    .status
                    .data
                    .as_ref()
                    .and_then(|s| s.nodes.iter().find(|n| n.is_online()).map(|n| n.node.clone()));
                if ui.add(Btn::secondary("Terminal").icon(ph::TERMINAL_WINDOW).enabled(console_ok && host.online() && first_node.is_some())).on_hover_text("Root-Shell auf dem Node").clicked() {
                    if let Some(node) = first_node {
                        sh.open_terminal(TermRequest { title: format!("{node} · Shell"), host_id: host.id.clone(), node, kind: "node".into(), vmid: None, cmd: None, initial_input: None });
                    }
                }
                if ui.add(Btn::secondary("Verbindung testen").icon(ph::PLUGS_CONNECTED).loading(self.test.is_some())).clicked() {
                    let client = sh.client.clone();
                    let id = host.id.clone();
                    self.test = Some(Pending::spawn(&sh.ctx, move || client.post::<ConnectionTest>(&format!("/api/hosts/{}/test", seg(&id)), &json!({}))));
                }
                let can_update = sh.user.can_host(&host, "hosts.update") && !peer;
                let maint = host.connection_state.eq_ignore_ascii_case("maintenance");
                let label = if maint { "Wartung beenden" } else { "Wartung" };
                if ui.add(Btn::secondary(label).icon(ph::BROOM).enabled(can_update)).clicked() {
                    let id = host.id.clone();
                    let name = host.name.clone();
                    let state = if maint { "ONLINE" } else { "MAINTENANCE" };
                    let run = move |sh: &mut Shared| {
                        let path = format!("/api/hosts/{}/state", seg(&id));
                        let label = if state == "ONLINE" { format!("{name}: Wartung beendet") } else { format!("{name}: Wartungsmodus") };
                        sh.run(format!("host:{id}:state"), label, &[Tag::Hosts], move |c| c.post::<Value>(&path, &json!({ "state": state })));
                    };
                    if maint {
                        run(sh);
                    } else {
                        sh.confirm(format!("{} in Wartung setzen?", host.name), "Proxora fragt den Host nicht mehr ab und blendet Fehler aus, bis die Wartung beendet ist.", "Wartung starten", false, run);
                    }
                }
                let can_edit = (sh.user.can_host(&host, "hosts.update") || sh.user.can_host(&host, "hosts.credentials")) && !peer;
                if ui.add(Btn::secondary("Bearbeiten").icon(ph::PENCIL_SIMPLE).enabled(can_edit)).clicked() {
                    edit = Some(host.clone());
                }
                let can_delete = sh.user.can_host(&host, "hosts.delete") && !peer;
                if ui.add(Btn::ghost("Entfernen").icon(ph::TRASH).enabled(can_delete)).clicked() {
                    let id = host.id.clone();
                    let name = host.name.clone();
                    sh.confirm(
                        format!("{name} entfernen?"),
                        "Zugangsdaten und Metadaten werden in Proxora gelöscht. Gäste auf dem Host bleiben unberührt.",
                        "Entfernen",
                        true,
                        move |sh| {
                            let path = format!("/api/hosts/{}", seg(&id));
                            sh.run(format!("host:{id}:delete"), format!("{name} entfernt"), &[Tag::Hosts, Tag::Guests], move |c| c.delete::<Value>(&path));
                        },
                    );
                }
            });
            ui.add_space(12.0);
            let mut tabs = vec![(HostTab::Nodes, "Nodes")];
            if host.is_cluster_member {
                tabs.push((HostTab::Cluster, "Cluster"));
            }
            tabs.extend([(HostTab::Guests, "Gäste"), (HostTab::Storage, "Storage"), (HostTab::Info, "Details")]);
            w::tabs(ui, &mut self.tab, &tabs);
            egui::ScrollArea::vertical().id_salt("host_insp").auto_shrink([false, false]).show(ui, |ui| match self.tab {
                HostTab::Nodes => self.nodes(ui, sh, &host),
                HostTab::Cluster => self.cluster_tab(ui),
                HostTab::Guests => self.guests(ui, sh, &host),
                HostTab::Storage => self.storage(ui),
                HostTab::Info => info(ui, &host),
            });
        });
        (close, edit)
    }

    fn nodes(&mut self, ui: &mut Ui, sh: &mut Shared, host: &Host) {
        let Some(status) = self.status.data.clone() else {
            match self.status.error.clone() {
                Some(err) => {
                    if w::error_box(ui, &err) {
                        self.status.invalidate();
                    }
                }
                None => w::skeleton(ui, 5),
            }
            return;
        };
        let alert = if status.cpu_temp_alert_c > 0.0 { status.cpu_temp_alert_c } else { 85.0 };
        for n in &status.nodes {
            w::section(ui, &n.node, |ui| {
                let online = n.is_online();
                let can_power = !host.is_peer();
                w::menu_button(ui, ("node_menu", &n.node), Btn::icon_only(ph::DOTS_THREE, "Node-Aktionen").small(), |ui| {
                    let console_ok = sh.user.can_host(host, "hosts.console") && online;
                    if w::menu_item(ui, ph::TERMINAL_WINDOW, "Terminal", console_ok, false) {
                        sh.open_terminal(TermRequest { title: format!("{} · Shell", n.node), host_id: host.id.clone(), node: n.node.clone(), kind: "node".into(), vmid: None, cmd: None, initial_input: None });
                    }
                    if w::menu_item(ui, ph::BROWSERS, "Terminal im Browser", console_ok, false) {
                        sh.open_web(&format!("/hosts/{}/console?node={}", seg(&host.id), seg(&n.node)));
                    }
                    w::menu_separator(ui);
                    for (action, label, perm, icon) in [("reboot", "Neustarten", "hosts.reboot", ph::ARROW_COUNTER_CLOCKWISE), ("shutdown", "Herunterfahren", "hosts.shutdown", ph::POWER)] {
                        if w::menu_item(ui, icon, label, can_power && online && sh.user.can_host(host, perm), true) {
                            let id = host.id.clone();
                            let node = n.node.clone();
                            sh.confirm(
                                format!("Node {node} {}?", label.to_lowercase()),
                                "Alle laufenden Gäste auf diesem Node sind betroffen.",
                                label,
                                true,
                                move |sh| {
                                    let path = format!("/api/hosts/{}/status", seg(&id));
                                    sh.run(format!("node:{id}:{node}"), format!("{label} · {node}"), &[Tag::Hosts], move |c| {
                                        c.post::<Value>(&path, &json!({ "action": action, "node": node, "confirm": true }))
                                    });
                                },
                            );
                        }
                    }
                });
                w::state_badge(ui, &n.online);
            }, |ui| {
                if !n.is_online() {
                    ui.label(w::muted("Node nicht erreichbar."));
                    return;
                }
                let m = &n.status;
                w::meter_block(ui, "CPU", m.cpu as f32, &format::percent(m.cpu));
                w::meter_block(ui, "Arbeitsspeicher", format::ratio(m.memory.used, m.memory.total), &format::used_of(m.memory.used, m.memory.total));
                w::meter_block(ui, "Root-FS", format::ratio(m.rootfs.used, m.rootfs.total), &format::used_of(m.rootfs.used, m.rootfs.total));
                let temp = match (m.cpu_temp_c, m.cpu_temp_state.as_deref()) {
                    (Some(t), _) => format!("{t:.0} °C{}", if t >= alert { " — zu heiß" } else { "" }),
                    (None, Some("reading")) => "wird gelesen …".into(),
                    (None, Some("failed")) => "nicht lesbar".into(),
                    _ => "—".into(),
                };
                w::kv_grid(ui, &format!("node_{}", n.node), &[("Uptime", format::uptime(m.uptime)), ("CPU-Temperatur", temp)]);
            });
            ui.add_space(12.0);
        }
    }

    fn cluster_tab(&mut self, ui: &mut Ui) {
        let Some(cl) = self.cluster.data.clone() else {
            w::skeleton(ui, 4);
            return;
        };
        w::section(ui, &cl.name.clone().unwrap_or_else(|| "Cluster".into()), |ui| {
            match cl.quorate {
                Some(true) => { w::badge(ui, "Quorum", c::OK); }
                Some(false) => { w::badge(ui, "kein Quorum", c::DANGER); }
                None => {}
            }
        }, |ui| {
            for n in &cl.nodes {
                ui.horizontal(|ui| {
                    w::dot(ui, if n.online { c::OK } else { c::DANGER });
                    ui.label(w::strong(n.name.clone()));
                    ui.label(w::mono(n.ip.clone().unwrap_or_default()));
                });
            }
            if !cl.replications.is_empty() {
                ui.add_space(10.0);
                ui.label(w::label("Replikationen"));
                for r in &cl.replications {
                    ui.label(w::mono(format!("{} → {}", crate::net::vstr(r, "id"), crate::net::vstr(r, "target"))));
                }
            }
        });
    }

    fn guests(&mut self, ui: &mut Ui, sh: &mut Shared, host: &Host) {
        let Some(status) = self.status.data.clone() else {
            w::skeleton(ui, 4);
            return;
        };
        let mut open: Option<(String, u64, Kind)> = None;
        for (kind, list) in [(Kind::Vm, &status.vms), (Kind::Lxc, &status.containers)] {
            w::section(ui, kind.plural(), |ui| { ui.label(w::small(list.len().to_string())); }, |ui| {
                if list.is_empty() {
                    ui.label(w::muted("Keine."));
                }
                for g in list {
                    let (rect, resp) = ui.allocate_exact_size(egui::vec2(ui.available_width(), 30.0), Sense::click());
                    if resp.hovered() {
                        ui.painter().rect_filled(rect, 3.0, c::HOVER);
                    }
                    let (color, label) = theme::state_tone(&g.status);
                    ui.painter().circle_filled(rect.left_center() + egui::vec2(10.0, 0.0), 3.5, color);
                    ui.painter().text(rect.left_center() + egui::vec2(22.0, 0.0), egui::Align2::LEFT_CENTER, format!("{}  {}", g.vmid, g.display_name()), theme::medium(13.0), c::TEXT);
                    ui.painter().text(rect.right_center() - egui::vec2(8.0, 0.0), egui::Align2::RIGHT_CENTER, format!("{label} · {}", g.node), theme::regular(12.0), c::MUTED);
                    if resp.clicked() {
                        open = Some((g.node.clone(), g.vmid, kind));
                    }
                }
            });
            ui.add_space(12.0);
        }
        if let Some((node, vmid, kind)) = open {
            sh.open_guest(&host.id, &node, vmid, kind);
        }
    }

    fn storage(&mut self, ui: &mut Ui) {
        let Some(status) = self.status.data.clone() else {
            w::skeleton(ui, 4);
            return;
        };
        w::section(ui, "Storage", |_| {}, |ui| {
            for s in &status.storage {
                ui.horizontal(|ui| {
                    ui.label(w::icon_text(ph::HARD_DRIVES, 15.0, c::MUTED));
                    ui.label(w::strong(s.storage.clone()));
                    ui.label(w::small(format!("{} {}", s.kind, s.node.clone().map(|n| format!("· {n}")).unwrap_or_default())));
                });
            }
        });
    }
}

fn info(ui: &mut Ui, host: &Host) {
    w::section(ui, "Details", |_| {}, |ui| {
        w::kv_grid(ui, "host_info", &[
            ("Adresse", host.url.clone()),
            ("Anmeldung", format!("{} · {}", if host.auth_type == "API_TOKEN" { "API-Token" } else { "Passwort" }, host.username)),
            ("Token-ID", host.token_id.clone().unwrap_or_default()),
            ("TLS", if host.allow_insecure_tls { "selbstsigniert erlaubt".into() } else { "geprüft".into() }),
            ("Zuletzt gesehen", host.last_seen_at.as_deref().map(format::relative).unwrap_or_default()),
            ("APT geprüft", host.apt_checked_at.as_deref().map(format::relative).unwrap_or_default()),
        ]);
        if let Some(notes) = host.notes.as_ref().filter(|n| !n.trim().is_empty()) {
            ui.add_space(10.0);
            ui.label(w::label("Notizen"));
            ui.add(egui::Label::new(w::secondary(notes.clone())).wrap());
        }
    });
}

// ---------------------------------------------------------------- editor

struct HostEditor {
    id: Option<String>,
    name: String,
    url: String,
    notes: String,
    token: bool,
    username: String,
    token_id: String,
    secret: String,
    insecure: bool,
    test: Option<Pending<ApiResult<ConnectionTest>>>,
    test_result: Option<Result<String, String>>,
    save: Option<Pending<ApiResult<Value>>>,
    error: Option<String>,
}

impl HostEditor {
    fn new(host: Option<&Host>) -> Self {
        match host {
            Some(h) => Self {
                id: Some(h.id.clone()),
                name: h.name.clone(),
                url: h.url.clone(),
                notes: h.notes.clone().unwrap_or_default(),
                token: h.auth_type == "API_TOKEN",
                username: h.username.clone(),
                token_id: h.token_id.clone().unwrap_or_default(),
                secret: String::new(),
                insecure: h.allow_insecure_tls,
                test: None,
                test_result: None,
                save: None,
                error: None,
            },
            None => Self {
                id: None,
                name: String::new(),
                url: "https://192.168.1.10:8006".into(),
                notes: String::new(),
                token: true,
                username: "root@pam".into(),
                token_id: "manager".into(),
                secret: String::new(),
                insecure: true,
                test: None,
                test_result: None,
                save: None,
                error: None,
            },
        }
    }

    fn payload(&self) -> Value {
        let mut b = json!({
            "name": self.name.trim(),
            "url": self.url.trim(),
            "allowInsecureTls": self.insecure,
            "notes": if self.notes.trim().is_empty() { Value::Null } else { json!(self.notes.trim()) },
            "authType": if self.token { "API_TOKEN" } else { "PASSWORD" },
            "username": self.username.trim(),
            "tokenId": if self.token { json!(self.token_id.trim()) } else { Value::Null },
        });
        if !self.secret.is_empty() {
            b["secret"] = json!(self.secret);
        }
        b
    }

    /// Returns true when the dialog should close.
    fn ui(&mut self, ctx: &egui::Context, sh: &mut Shared) -> bool {
        if let Some(res) = self.test.as_ref().and_then(Pending::poll) {
            self.test = None;
            self.test_result = Some(match res {
                Ok(t) if t.ok => {
                    let v = t.version.as_ref().map(|v| crate::net::vstr(v, "version")).unwrap_or_default();
                    Ok(format!("Verbunden · Proxmox VE {v}"))
                }
                Ok(t) => Err(t.error.unwrap_or_else(|| "Verbindung fehlgeschlagen".into())),
                Err(e) => Err(e.message),
            });
        }
        if let Some(res) = self.save.as_ref().and_then(Pending::poll) {
            self.save = None;
            match res {
                Ok(_) => {
                    sh.bump(Tag::Hosts);
                    sh.toasts.success(if self.id.is_some() { "Host gespeichert" } else { "Host hinzugefügt" });
                    return true;
                }
                Err(e) => self.error = Some(e.message),
            }
        }
        let editing = self.id.is_some();
        let title = if editing { "Host bearbeiten" } else { "Host hinzufügen" };
        let mut close = false;
        let mut test = false;
        let mut save = false;
        let busy = self.save.is_some();
        let closed = form_modal(ctx, "host_editor", title, 460.0, |ui| {
            w::field(ui, "Name", None, |ui| w::text_input(ui, &mut self.name, "pve-01", ui.available_width()));
            w::field(ui, "Adresse", Some("https://host:8006 — Port 8006 wird ergänzt, wenn er fehlt"), |ui| w::text_input(ui, &mut self.url, "", ui.available_width()));
            ui.label(w::label("Anmeldung"));
            ui.horizontal(|ui| {
                if ui.add(Btn::secondary("API-Token").small().selected(self.token)).clicked() {
                    self.token = true;
                }
                if ui.add(Btn::secondary("Passwort").small().selected(!self.token)).clicked() {
                    self.token = false;
                }
            });
            ui.add_space(8.0);
            w::field(ui, "Benutzer", None, |ui| w::text_input(ui, &mut self.username, "root@pam", ui.available_width()));
            if self.token {
                w::field(ui, "Token-ID", None, |ui| w::text_input(ui, &mut self.token_id, "manager", ui.available_width()));
            }
            let secret_label = if self.token { "Token-Secret" } else { "Passwort" };
            let hint = editing.then_some("Leer lassen, um es nicht zu ändern");
            w::field(ui, secret_label, hint, |ui| w::password_input(ui, &mut self.secret, "", ui.available_width()));
            ui.checkbox(&mut self.insecure, "Selbstsignierte Zertifikate akzeptieren");
            ui.add_space(6.0);
            w::field(ui, "Notizen", None, |ui| ui.add(egui::TextEdit::multiline(&mut self.notes).desired_rows(2).desired_width(f32::INFINITY)));
            match &self.test_result {
                Some(Ok(msg)) => w::callout(ui, ph::CHECK_CIRCLE, c::OK, msg),
                Some(Err(msg)) => w::callout(ui, ph::WARNING_CIRCLE, c::DANGER, msg),
                None => {}
            }
            if let Some(err) = &self.error {
                ui.add_space(6.0);
                w::callout(ui, ph::WARNING_CIRCLE, c::DANGER, err);
            }
            ui.add_space(12.0);
            ui.horizontal(|ui| {
                let ready = !self.name.trim().is_empty() && !self.url.trim().is_empty() && (editing || !self.secret.is_empty());
                save = ui.add(Btn::primary("Speichern").icon(ph::FLOPPY_DISK).enabled(ready).loading(busy)).clicked();
                test = ui.add(Btn::secondary("Verbindung testen").icon(ph::PLUGS_CONNECTED).loading(self.test.is_some())).clicked();
                close = ui.add(Btn::ghost("Abbrechen")).clicked();
            });
        });
        if test {
            let client = sh.client.clone();
            self.test_result = None;
            let job: Box<dyn FnOnce() -> ApiResult<ConnectionTest> + Send> = match (&self.id, self.secret.is_empty()) {
                (Some(id), true) => {
                    let path = format!("/api/hosts/{}/test", seg(id));
                    Box::new(move || client.post::<ConnectionTest>(&path, &json!({})))
                }
                _ => {
                    let body = self.payload();
                    Box::new(move || client.post::<ConnectionTest>("/api/hosts/test", &body))
                }
            };
            self.test = Some(Pending::spawn(&sh.ctx, job));
        }
        if save {
            let client = sh.client.clone();
            let body = self.payload();
            self.error = None;
            let job: Box<dyn FnOnce() -> ApiResult<Value> + Send> = match &self.id {
                Some(id) => {
                    let path = format!("/api/hosts/{}", seg(id));
                    Box::new(move || client.patch::<Value>(&path, &body))
                }
                None => Box::new(move || client.post::<Value>("/api/hosts", &body)),
            };
            self.save = Some(Pending::spawn(&sh.ctx, job));
        }
        (close || closed) && self.save.is_none()
    }
}
