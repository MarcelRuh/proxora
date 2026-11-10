use super::host_picker;
use crate::app::shared::{Shared, Tag};
use crate::net::{query, seg, DiskAlerts, Resource, StorageContent, StorageItem, StorageResponse, ZfsPoolDetail, ZfsResponse};
use crate::theme::{self, c, ROW_H};
use crate::ui::format;
use crate::ui::widgets::{self as w, Btn};
use eframe::egui::{self, Align, Layout, RichText, Sense, Stroke, Ui};
use egui_extras::{Column, TableBuilder};
use egui_phosphor::regular as ph;
use serde_json::{json, Value};
use std::time::Duration;

#[derive(Clone, PartialEq)]
struct Selected {
    node: String,
    storage: String,
}

pub struct StoragePage {
    host: Option<String>,
    storage: Resource<StorageResponse>,
    zfs: Resource<ZfsResponse>,
    alerts: Resource<DiskAlerts>,
    selected: Option<Selected>,
    content: Resource<StorageContent>,
    content_search: String,
    content_type: String,
    pool: Option<(String, String)>,
    pool_detail: Resource<ZfsPoolDetail>,
}

impl Default for StoragePage {
    fn default() -> Self {
        Self {
            host: None,
            storage: Resource::new(),
            zfs: Resource::new(),
            alerts: Resource::new(),
            selected: None,
            content: Resource::new(),
            content_search: String::new(),
            content_type: String::new(),
            pool: None,
            pool_detail: Resource::new(),
        }
    }
}

impl StoragePage {
    pub fn ui(&mut self, ui: &mut Ui, sh: &mut Shared) {
        sh.ensure_hosts();
        let user = sh.user.clone();
        w::page_header(ui, "Storage", Some("Speicher, Inhalte und ZFS-Pools je Host"), |ui| {
            if ui.add(Btn::secondary("Aktualisieren").icon(ph::ARROW_CLOCKWISE).loading(self.storage.loading())).clicked() {
                sh.bump(Tag::Storage);
            }
        });
        ui.horizontal(|ui| {
            host_picker(ui, sh, &mut self.host, |h| h.online() && (user.can_host(h, "storage.view") || user.can_host(h, "zfs.view")));
        });
        ui.add_space(10.0);
        let Some(host) = self.host.clone() else {
            w::empty_state(ui, ph::HARD_DRIVES, "Kein Host", "Kein erreichbarer Host mit Storage-Rechten.");
            return;
        };
        if self.storage.set_key(&host) {
            self.zfs.set_key(&host);
            self.selected = None;
            self.pool = None;
        }
        let epoch = sh.epoch(Tag::Storage);
        let (c1, c2, c3) = (sh.client.clone(), sh.client.clone(), sh.client.clone());
        let (h1, h2) = (host.clone(), host.clone());
        let can_storage = sh.host(&host).is_some_and(|h| sh.user.can_host(h, "storage.view"));
        let can_zfs = sh.host(&host).is_some_and(|h| sh.user.can_host(h, "zfs.view"));
        if can_storage {
            self.storage.ensure(&sh.ctx, Duration::from_secs(90), epoch, || move || c1.get::<StorageResponse>(&format!("/api/hosts/{}/storage", seg(&h1))));
        }
        if can_zfs {
            self.zfs.ensure(&sh.ctx, Duration::from_secs(90), epoch, || move || c2.get::<ZfsResponse>(&format!("/api/hosts/{}/zfs", seg(&h2))));
        }
        self.alerts.ensure(&sh.ctx, Duration::from_secs(120), epoch, || move || c3.get::<DiskAlerts>("/api/disk-alerts"));
        let alert = self.alerts.data.as_ref().map(|a| a.alert_percent).filter(|a| *a > 0.0).unwrap_or(90.0) / 100.0;

        if let Some(sel) = self.selected.clone() {
            let mut close = false;
            egui::SidePanel::right("storage_content")
                .resizable(true)
                .default_width(560.0)
                .show_separator_line(false)
                .frame(egui::Frame::new().fill(c::BG).inner_margin(egui::Margin { left: 16, right: 0, top: 0, bottom: 0 }))
                .show_inside(ui, |ui| {
                    close = self.content_panel(ui, sh, &host, &sel);
                });
            if close {
                self.selected = None;
            }
        }
        egui::CentralPanel::default().frame(egui::Frame::new()).show_inside(ui, |ui| {
            egui::ScrollArea::vertical().auto_shrink([false, false]).show(ui, |ui| {
                if can_storage {
                    self.storage_table(ui, alert);
                    ui.add_space(16.0);
                }
                if can_zfs {
                    self.zfs_section(ui, sh, &host);
                }
            });
        });
    }

    fn storage_table(&mut self, ui: &mut Ui, alert: f64) {
        let Some(data) = self.storage.data.clone() else {
            w::panel_frame().show(ui, |ui| {
                ui.set_min_width(ui.available_width());
                match self.storage.error.clone() {
                    Some(e) => {
                        if w::error_box(ui, &e) {
                            self.storage.invalidate();
                        }
                    }
                    None => w::skeleton(ui, 5),
                }
            });
            return;
        };
        let rows: Vec<(String, StorageItem)> = data
            .storage
            .iter()
            .flat_map(|n| n.storage.iter().map(move |s| (n.node.clone(), s.clone())))
            .collect();
        let multi_node = data.storage.len() > 1;
        let mut open: Option<Selected> = None;
        let selected = self.selected.clone();
        w::section(ui, "Speicher", |ui| { ui.label(w::small(format!("{}", rows.len()))); }, |ui| {
            let top = ui.cursor().top();
            ui.painter().hline(ui.max_rect().x_range(), top + 30.0, Stroke::new(1.0_f32, c::BORDER));
            TableBuilder::new(ui)
                .id_salt("storage_table")
                .striped(true)
                .sense(Sense::click())
                .cell_layout(Layout::left_to_right(Align::Center))
                .column(Column::remainder().at_least(150.0).clip(true))
                .column(Column::exact(90.0))
                .column(Column::exact(160.0).clip(true))
                .column(Column::exact(90.0))
                .column(Column::exact(200.0))
                .header(30.0, |mut r| {
                    for t in ["Storage", "Typ", "Inhalt", "Status", "Belegung"] {
                        r.col(|ui| w::th(ui, t));
                    }
                })
                .body(|body| {
                    body.rows(ROW_H + 6.0, rows.len(), |mut row| {
                        let (node, s) = &rows[row.index()];
                        let sel = Selected { node: node.clone(), storage: s.storage.clone() };
                        row.set_selected(selected.as_ref() == Some(&sel));
                        row.col(|ui| {
                            ui.vertical(|ui| {
                                ui.spacing_mut().item_spacing.y = 1.0;
                                ui.horizontal(|ui| {
                                    ui.label(w::strong(s.storage.clone()));
                                    if s.shared {
                                        w::badge(ui, "geteilt", c::CYAN);
                                    }
                                });
                                if multi_node {
                                    ui.label(w::small(node.clone()));
                                }
                            });
                        });
                        row.col(|ui| { ui.label(w::mono(s.kind.clone())); });
                        row.col(|ui| { ui.add(egui::Label::new(w::small(s.content.clone().unwrap_or_default().replace(',', ", "))).truncate()); });
                        let frac = format::ratio(s.used, s.total);
                        row.col(|ui| {
                            if !s.active {
                                w::badge(ui, "inaktiv", c::MUTED);
                            } else if frac as f64 >= alert {
                                w::badge(ui, "fast voll", c::DANGER);
                            } else {
                                w::badge(ui, "aktiv", c::OK);
                            }
                        });
                        row.col(|ui| {
                            ui.vertical(|ui| {
                                ui.spacing_mut().item_spacing.y = 3.0;
                                ui.label(RichText::new(format!("{} · {} frei", format::used_of(s.used, s.total), format::bytes(s.avail))).font(theme::mono(11.0)).color(c::TEXT_2));
                                w::meter(ui, frac, 180.0, 4.0);
                            });
                        });
                        if row.response().clicked() {
                            open = Some(sel);
                        }
                    });
                });
        });
        if let Some(sel) = open {
            self.content.set_key(&format!("{}:{}", sel.node, sel.storage));
            self.selected = Some(sel);
        }
    }

    fn content_panel(&mut self, ui: &mut Ui, sh: &mut Shared, host: &str, sel: &Selected) -> bool {
        let client = sh.client.clone();
        let path = format!("/api/hosts/{}/storage/content{}", seg(host), query(&[("node", sel.node.clone()), ("storage", sel.storage.clone())]));
        self.content.ensure(&sh.ctx, Duration::from_secs(60), sh.epoch(Tag::Storage), || move || client.get::<StorageContent>(&path));
        let mut close = false;
        let mut delete: Option<(String, String, bool)> = None;
        let h = sh.host(host).cloned();
        let can_del_storage = h.as_ref().is_some_and(|h| sh.user.can_host(h, "storage.delete"));
        let can_del_backup = h.as_ref().is_some_and(|h| sh.user.can_host(h, "backup.delete"));
        w::panel_frame().show(ui, |ui| {
            ui.set_min_width(ui.available_width());
            ui.horizontal(|ui| {
                ui.label(w::icon_text(ph::HARD_DRIVES, 18.0, c::PINK));
                ui.label(RichText::new(&sel.storage).font(theme::semibold(16.0)).color(c::TEXT));
                ui.label(w::muted(format!("· {}", sel.node)));
                ui.with_layout(Layout::right_to_left(Align::Center), |ui| {
                    if ui.add(Btn::icon_only(ph::X, "Schließen").small()).clicked() {
                        close = true;
                    }
                });
            });
            ui.add_space(8.0);
            ui.horizontal(|ui| {
                w::search_input(ui, &mut self.content_search, "Datei, Gast …", 200.0);
                let types: Vec<(String, String)> = [("", "Alle"), ("images", "Disks"), ("rootdir", "CT-Volumes"), ("iso", "ISO"), ("vztmpl", "Vorlagen"), ("backup", "Backups"), ("unused", "Ungenutzt")]
                    .iter()
                    .map(|(a, b)| (a.to_string(), b.to_string()))
                    .collect();
                w::combo(ui, "content_type", &mut self.content_type, &types, 130.0);
            });
            ui.add_space(8.0);
            let Some(data) = self.content.data.clone() else {
                match self.content.error.clone() {
                    Some(e) => {
                        w::error_box(ui, &e);
                    }
                    None => w::skeleton(ui, 6),
                }
                return;
            };
            let q = self.content_search.to_lowercase();
            let items: Vec<_> = data
                .items
                .iter()
                .filter(|i| match self.content_type.as_str() {
                    "" => true,
                    "unused" => i.usage == "unused",
                    t => i.content == t,
                })
                .filter(|i| q.is_empty() || format!("{} {}", i.filename, i.guest_name.as_deref().unwrap_or("")).to_lowercase().contains(&q))
                .take(300)
                .collect();
            if items.is_empty() {
                ui.label(w::muted("Keine Einträge."));
            }
            egui::ScrollArea::vertical().id_salt("content_scroll").auto_shrink([false, false]).show(ui, |ui| {
                for (i, item) in items.iter().enumerate() {
                    if i > 0 {
                        w::separator(ui);
                    }
                    ui.horizontal(|ui| {
                        let icon = match item.content.as_str() {
                            "iso" => ph::DISC,
                            "vztmpl" => ph::STACK,
                            "backup" => ph::ARCHIVE,
                            _ => ph::HARD_DRIVE,
                        };
                        ui.label(w::icon_text(icon, 16.0, c::MUTED));
                        ui.vertical(|ui| {
                            ui.spacing_mut().item_spacing.y = 1.0;
                            ui.add(egui::Label::new(w::body(item.filename.clone())).truncate());
                            let mut meta = vec![format::bytes(item.size)];
                            if let (Some(vmid), Some(name)) = (item.vmid, &item.guest_name) {
                                meta.push(format!("{vmid} · {name}"));
                            }
                            if item.ctime > 0 {
                                meta.push(format::unix_time((item.ctime / 1000) as i64));
                            }
                            ui.label(w::small(meta.join(" · ")));
                        });
                        ui.with_layout(Layout::right_to_left(Align::Center), |ui| {
                            let is_backup = item.content == "backup" || item.volid.contains("vzdump-");
                            let allowed = if is_backup { can_del_backup } else { can_del_storage };
                            if ui.add(Btn::icon_only(ph::TRASH, "Löschen").small().enabled(allowed)).clicked() {
                                delete = Some((item.volid.clone(), item.filename.clone(), item.usage == "attached"));
                            }
                            let (label, color) = match item.usage.as_str() {
                                "attached" => ("in Benutzung", c::OK),
                                "unused" => ("ungenutzt", c::WARN),
                                _ => ("", c::MUTED),
                            };
                            if !label.is_empty() {
                                w::badge(ui, label, color);
                            }
                        });
                    });
                }
            });
        });
        if let Some((volid, name, attached)) = delete {
            let node = sel.node.clone();
            let path = format!("/api/hosts/{}/storage/content", seg(host));
            let body_text = if attached {
                format!("{name} ist noch an einen Gast angehängt. Trotzdem endgültig löschen?")
            } else {
                format!("{name} wird endgültig gelöscht.")
            };
            sh.confirm("Volume löschen?", body_text, "Löschen", true, move |sh| {
                sh.run("storage:delete", "Volume gelöscht", &[Tag::Storage, Tag::Backups], move |c| {
                    c.post::<Value>(&path, &json!({ "action": "delete", "node": node, "volid": volid }))
                });
            });
        }
        close
    }

    fn zfs_section(&mut self, ui: &mut Ui, sh: &mut Shared, host: &str) {
        let Some(data) = self.zfs.data.clone() else {
            if self.zfs.loading() {
                w::panel_frame().show(ui, |ui| {
                    ui.set_min_width(ui.available_width());
                    w::skeleton(ui, 3);
                });
            }
            return;
        };
        let pools: Vec<_> = data.zfs.iter().flat_map(|n| n.pools.iter().map(move |p| (n.node.clone(), p.clone()))).collect();
        if pools.is_empty() {
            return;
        }
        w::section(ui, "ZFS-Pools", |_| {}, |ui| {
            for (i, (node, pool)) in pools.iter().enumerate() {
                if i > 0 {
                    w::separator(ui);
                }
                ui.horizontal(|ui| {
                    let healthy = pool.health.eq_ignore_ascii_case("online");
                    ui.label(w::icon_text(ph::DATABASE, 18.0, if healthy { c::OK } else { c::DANGER }));
                    ui.vertical(|ui| {
                        ui.spacing_mut().item_spacing.y = 2.0;
                        ui.horizontal(|ui| {
                            ui.label(w::strong(pool.name.clone()));
                            w::badge(ui, &pool.health, if healthy { c::OK } else { c::DANGER });
                            ui.label(w::small(node.clone()));
                        });
                        let frag = pool.frag.map(|f| format!(" · Fragmentierung {f:.0} %")).unwrap_or_default();
                        ui.label(w::small(format!("{} · {} frei{frag}", format::used_of(pool.alloc, pool.size), format::bytes(pool.free))));
                        w::meter(ui, format::ratio(pool.alloc, pool.size), 260.0, 4.0);
                    });
                    ui.with_layout(Layout::right_to_left(Align::Center), |ui| {
                        if ui.add(Btn::ghost("Disks").icon(ph::HARD_DRIVE).small()).clicked() {
                            let key = (node.clone(), pool.name.clone());
                            if self.pool.as_ref() == Some(&key) {
                                self.pool = None;
                            } else {
                                self.pool_detail.set_key(&format!("{}:{}", key.0, key.1));
                                self.pool = Some(key);
                            }
                        }
                    });
                });
                if self.pool.as_ref().is_some_and(|(n, p)| n == node && p == &pool.name) {
                    let client = sh.client.clone();
                    let path = format!("/api/hosts/{}/zfs{}", seg(host), query(&[("node", node.clone()), ("pool", pool.name.clone())]));
                    self.pool_detail.ensure(&sh.ctx, Duration::from_secs(120), 0, || move || client.get::<ZfsPoolDetail>(&path));
                    ui.indent("pool_devs", |ui| match &self.pool_detail.data {
                        Some(d) => {
                            for dev in &d.pool.health_summary.devices {
                                ui.horizontal(|ui| {
                                    w::dot(ui, if dev.healthy { c::OK } else { c::DANGER });
                                    ui.label(w::mono(dev.name.clone()));
                                    ui.label(w::small(format!("{} · {} · Fehler L/S/P {}/{}/{}", dev.role, dev.state, dev.read, dev.write, dev.cksum)));
                                });
                            }
                        }
                        None => w::skeleton(ui, 2),
                    });
                }
            }
        });
    }
}
