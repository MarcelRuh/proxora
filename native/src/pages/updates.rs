use crate::app::shared::{Shared, Tag};
use crate::net::{seg, Host, HostUpdates, Resource};
use crate::term::TermRequest;
use crate::theme::{self, c};
use crate::ui::format;
use crate::ui::widgets::{self as w, Btn};
use eframe::egui::{self, Align, Layout, RichText, Ui};
use egui_phosphor::regular as ph;
use serde_json::{json, Value};
use std::collections::{HashMap, HashSet};
use std::time::Duration;

#[derive(Default)]
pub struct UpdatesPage {
    per_host: HashMap<String, Resource<HostUpdates>>,
    expanded: HashSet<String>,
}

impl UpdatesPage {
    pub fn ui(&mut self, ui: &mut Ui, sh: &mut Shared) {
        sh.ensure_hosts();
        let hosts: Vec<Host> = sh
            .hosts
            .data
            .clone()
            .unwrap_or_default()
            .into_iter()
            .filter(|h| sh.user.can_host(h, "updates.view"))
            .collect();
        let total: u64 = hosts.iter().map(|h| h.apt_update_count).sum();
        let checkable: Vec<Host> = hosts.iter().filter(|h| h.online() && sh.user.can_host(h, "updates.check")).cloned().collect();
        let mut check_all = false;
        w::page_header(ui, "Updates", Some(&format!("{total} Paket-Updates auf {} Hosts", hosts.len())), |ui| {
            if ui.add(Btn::primary("Alle prüfen").icon(ph::ARROWS_CLOCKWISE).enabled(!checkable.is_empty())).clicked() {
                check_all = true;
            }
        });
        if check_all {
            for h in &checkable {
                check_host(sh, h);
            }
        }
        if hosts.is_empty() {
            w::empty_state(ui, ph::PACKAGE, "Keine Hosts", "Du hast auf keinem Host Update-Rechte.");
            return;
        }
        let epoch = sh.epoch(Tag::Updates);
        egui::ScrollArea::vertical().auto_shrink([false, false]).show(ui, |ui| {
            for h in &hosts {
                let res = self.per_host.entry(h.id.clone()).or_default();
                if h.online() {
                    let client = sh.client.clone();
                    let id = h.id.clone();
                    res.ensure(&sh.ctx, Duration::from_secs(300), epoch, || move || client.get::<HostUpdates>(&format!("/api/hosts/{}/updates", seg(&id))));
                }
                let checking = sh.op_running(&format!("updates:{}", h.id));
                let mut do_check = false;
                let mut upgrade: Option<String> = None;
                let can_check = h.online() && sh.user.can_host(h, "updates.check");
                let can_upgrade = h.online() && sh.user.can_host(h, "updates.upgrade");
                let expanded = self.expanded.contains(&h.id);
                let mut toggle = false;
                w::section(ui, &h.name, |ui| {
                    if ui.add(Btn::secondary("Prüfen").icon(ph::ARROW_CLOCKWISE).small().enabled(can_check).loading(checking)).clicked() {
                        do_check = true;
                    }
                    let checked = h.apt_checked_at.as_deref().map(format::relative).unwrap_or_else(|| "nie geprüft".into());
                    ui.label(w::small(format!("geprüft {checked}")));
                }, |ui| {
                    ui.horizontal(|ui| {
                        if !h.online() {
                            w::state_badge(ui, &h.connection_state);
                        } else if h.apt_update_count > 0 {
                            w::badge(ui, &format!("{} Updates", h.apt_update_count), c::WARN);
                        } else {
                            w::badge(ui, "aktuell", c::OK);
                        }
                        if let Some(v) = res.data.as_ref().and_then(|d| d.version.clone()).or(h.proxmox_version.clone()) {
                            ui.label(w::muted(format!("Proxmox VE {v}")));
                        }
                    });
                    if let Some(err) = res.error.clone() {
                        ui.add_space(6.0);
                        w::error_box(ui, &err);
                    }
                    let Some(data) = &res.data else {
                        if h.online() && res.loading() {
                            w::skeleton(ui, 3);
                        }
                        return;
                    };
                    for n in &data.updates {
                        ui.add_space(10.0);
                        ui.horizontal(|ui| {
                            ui.label(w::icon_text(ph::DESKTOP_TOWER, 15.0, c::MUTED));
                            ui.label(w::strong(n.node.clone()));
                            ui.label(w::small(format!("{} Pakete", n.count)));
                            ui.with_layout(Layout::right_to_left(Align::Center), |ui| {
                                if n.count > 0 && ui.add(Btn::primary("Upgrade").icon(ph::ROCKET_LAUNCH).small().enabled(can_upgrade)).clicked() {
                                    upgrade = Some(n.node.clone());
                                }
                            });
                        });
                        let limit = if expanded { usize::MAX } else { 10 };
                        egui::Grid::new(("pkgs", &h.id, &n.node)).num_columns(2).spacing([24.0, 4.0]).show(ui, |ui| {
                            for p in n.packages.iter().take(limit) {
                                ui.label(RichText::new(&p.package).font(theme::mono(12.0)).color(c::TEXT));
                                ui.label(RichText::new(format!("{} → {}", p.old_version.clone().unwrap_or_default(), p.version.clone().unwrap_or_default())).font(theme::mono(11.5)).color(c::MUTED));
                                ui.end_row();
                            }
                        });
                        if n.packages.len() > 10 {
                            let label = if expanded { "Weniger anzeigen".to_owned() } else { format!("{} weitere anzeigen", n.packages.len() - 10) };
                            if ui.add(Btn::ghost(&label).small()).clicked() {
                                toggle = true;
                            }
                        }
                    }
                });
                ui.add_space(12.0);
                if toggle {
                    if expanded {
                        self.expanded.remove(&h.id);
                    } else {
                        self.expanded.insert(h.id.clone());
                    }
                }
                if do_check {
                    check_host(sh, h);
                }
                if let Some(node) = upgrade {
                    start_upgrade(sh, h, &node);
                }
            }
        });
    }
}

fn check_host(sh: &mut Shared, h: &Host) {
    let path = format!("/api/hosts/{}/updates", seg(&h.id));
    sh.run(format!("updates:{}", h.id), format!("{}: Paketlisten aktualisiert", h.name), &[Tag::Updates, Tag::Hosts], move |c| {
        c.post_long::<Value>(&path, &json!({ "action": "check" }))
    });
}

fn start_upgrade(sh: &mut Shared, h: &Host, node: &str) {
    let id = h.id.clone();
    let node = node.to_owned();
    let name = h.name.clone();
    sh.confirm(
        format!("{node} aktualisieren?"),
        "Startet „apt dist-upgrade“ in einem Terminal auf dem Node. Laufende Gäste bleiben in Betrieb; ein Kernel-Update braucht danach einen Neustart.",
        "Upgrade starten",
        true,
        move |sh| {
            let path = format!("/api/hosts/{}/updates", seg(&id));
            let body = json!({ "action": "upgrade", "node": node, "confirm": true });
            sh.run_then(format!("upgrade:{id}:{node}"), "Upgrade vorbereiten", &[], move |c| c.post::<Value>(&path, &body), move |sh, v| {
                let node = v.get("node").and_then(Value::as_str).map(str::to_owned).unwrap_or(node);
                sh.open_terminal(TermRequest {
                    title: format!("Upgrade · {name}/{node}"),
                    host_id: id,
                    node,
                    kind: "node".into(),
                    vmid: None,
                    cmd: Some("upgrade".into()),
                    initial_input: None,
                });
                sh.bump(Tag::Updates);
            });
        },
    );
}
