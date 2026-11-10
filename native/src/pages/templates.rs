use super::host_picker;
use crate::app::shared::{Shared, Tag};
use crate::net::{query, seg, IsosResponse, Resource, TemplatesResponse};
use crate::theme::{self, c, ROW_H};
use crate::ui::widgets::{self as w, Btn};
use eframe::egui::{self, Align, Layout, RichText, Stroke, Ui};
use egui_extras::{Column, TableBuilder};
use egui_phosphor::regular as ph;
use serde_json::{json, Value};
use std::time::Duration;

#[derive(Clone, Copy, PartialEq, Eq)]
enum Tab {
    Lxc,
    Iso,
}

#[derive(Clone, Copy, PartialEq, Eq)]
enum Filter {
    All,
    Installed,
    Available,
    Updates,
}

pub struct TemplatesPage {
    tab: Tab,
    host: Option<String>,
    node: String,
    storage: String,
    search: String,
    filter: Filter,
    lxc: Resource<TemplatesResponse>,
    iso: Resource<IsosResponse>,
    custom_url: String,
    custom_name: String,
}

impl Default for TemplatesPage {
    fn default() -> Self {
        Self {
            tab: Tab::Lxc,
            host: None,
            node: String::new(),
            storage: String::new(),
            search: String::new(),
            filter: Filter::All,
            lxc: Resource::new(),
            iso: Resource::new(),
            custom_url: String::new(),
            custom_name: String::new(),
        }
    }
}

impl TemplatesPage {
    pub fn ui(&mut self, ui: &mut Ui, sh: &mut Shared) {
        sh.ensure_hosts();
        let can_lxc = sh.user.can("lxc.create");
        let can_iso = sh.user.can("vm.create");
        if !can_lxc && can_iso {
            self.tab = Tab::Iso;
        }
        w::page_header(ui, "Vorlagen & ISOs", Some("Container-Vorlagen und Installations-Images pro Host"), |ui| {
            if ui.add(Btn::secondary("Aktualisieren").icon(ph::ARROW_CLOCKWISE).loading(self.lxc.loading() || self.iso.loading())).clicked() {
                self.lxc.invalidate();
                self.iso.invalidate();
            }
        });
        let user = sh.user.clone();
        let tab = self.tab;
        ui.horizontal(|ui| {
            host_picker(ui, sh, &mut self.host, |h| h.online() && (user.can_host(h, "lxc.create") || user.can_host(h, "vm.create")));
        });
        ui.add_space(8.0);
        if can_lxc && can_iso {
            w::tabs(ui, &mut self.tab, &[(Tab::Lxc, "Container-Vorlagen"), (Tab::Iso, "ISO-Images")]);
        }
        if self.tab != tab {
            self.storage.clear();
        }
        let Some(host) = self.host.clone() else {
            w::empty_state(ui, ph::STACK, "Kein Host", "Es ist kein Host online, auf dem du Gäste anlegen darfst.");
            return;
        };
        let key = format!("{host}:{}", self.node);
        self.lxc.set_key(&key);
        self.iso.set_key(&key);
        let client = sh.client.clone();
        let node = self.node.clone();
        let epoch = sh.epoch(Tag::Templates);
        match self.tab {
            Tab::Lxc => {
                let h = host.clone();
                self.lxc.ensure(&sh.ctx, Duration::from_secs(120), epoch, || {
                    move || client.get::<TemplatesResponse>(&format!("/api/hosts/{}/templates{}", seg(&h), query(&[("node", node)])))
                });
                self.lxc_panel(ui, sh, &host);
            }
            Tab::Iso => {
                let h = host.clone();
                self.iso.ensure(&sh.ctx, Duration::from_secs(120), epoch, || {
                    move || client.get::<IsosResponse>(&format!("/api/hosts/{}/isos{}", seg(&h), query(&[("node", node)])))
                });
                self.iso_panel(ui, sh, &host);
            }
        }
    }

    fn toolbar(&mut self, ui: &mut Ui, nodes: &[String], storages: &[String]) {
        ui.horizontal(|ui| {
            w::search_input(ui, &mut self.search, "Suchen …", 220.0);
            w::segmented(ui, &mut self.filter, &[(Filter::All, "Alle"), (Filter::Installed, "Installiert"), (Filter::Available, "Verfügbar"), (Filter::Updates, "Updates")]);
            if nodes.len() > 1 {
                let opts: Vec<(String, String)> = nodes.iter().map(|n| (n.clone(), n.clone())).collect();
                w::combo(ui, "tpl_node", &mut self.node, &opts, 130.0);
            }
            if self.storage.is_empty() || !storages.contains(&self.storage) {
                self.storage = storages.first().cloned().unwrap_or_default();
            }
            let opts: Vec<(String, String)> = storages.iter().map(|s| (s.clone(), format!("Ziel: {s}"))).collect();
            w::combo(ui, "tpl_storage", &mut self.storage, &opts, 160.0);
        });
        ui.add_space(10.0);
    }

    fn lxc_panel(&mut self, ui: &mut Ui, sh: &mut Shared, host: &str) {
        let Some(data) = self.lxc.data.clone() else {
            loading(ui, &mut self.lxc.error.clone(), || self.lxc.invalidate());
            return;
        };
        if self.node.is_empty() {
            self.node = data.node.clone();
        }
        self.toolbar(ui, &data.nodes, &data.storages);
        let q = self.search.to_lowercase();
        let rows: Vec<_> = data
            .catalog
            .iter()
            .filter(|t| q.is_empty() || format!("{} {} {}", t.headline, t.template, t.section).to_lowercase().contains(&q))
            .filter(|t| {
                let update = !t.installed && data.installed.iter().any(|v| v.contains(&t.package));
                match self.filter {
                    Filter::All => true,
                    Filter::Installed => t.installed,
                    Filter::Available => !t.installed,
                    Filter::Updates => update,
                }
            })
            .collect();
        let can_delete = sh.host(host).is_some_and(|h| sh.user.can_host(h, "storage.delete"));
        let mut download: Option<String> = None;
        let mut delete: Option<String> = None;
        w::panel_frame().inner_margin(egui::Margin::symmetric(10, 8)).show(ui, |ui| {
            ui.set_min_width(ui.available_width());
            if rows.is_empty() {
                w::empty_state(ui, ph::STACK, "Keine Vorlagen", "Filter anpassen oder anderen Node wählen.");
                return;
            }
            let top = ui.cursor().top();
            ui.painter().hline(ui.max_rect().x_range(), top + 30.0, Stroke::new(1.0_f32, c::BORDER));
            TableBuilder::new(ui)
                .id_salt("tpl_table")
                .striped(true)
                .auto_shrink([false, false])
                .cell_layout(Layout::left_to_right(Align::Center))
                .column(Column::remainder().at_least(240.0).clip(true))
                .column(Column::exact(100.0))
                .column(Column::exact(120.0))
                .column(Column::exact(150.0))
                .header(30.0, |mut r| {
                    for t in ["Vorlage", "Bereich", "Status", ""] {
                        r.col(|ui| w::th(ui, t));
                    }
                })
                .body(|body| {
                    body.rows(ROW_H + 6.0, rows.len(), |mut row| {
                        let t = rows[row.index()];
                        let update = !t.installed && data.installed.iter().any(|v| v.contains(&t.package));
                        row.col(|ui| {
                            ui.vertical(|ui| {
                                ui.spacing_mut().item_spacing.y = 1.0;
                                ui.label(w::strong(t.headline.clone()));
                                ui.label(w::small(t.template.clone()));
                            });
                        });
                        row.col(|ui| { ui.label(w::secondary(t.section.clone())); });
                        row.col(|ui| {
                            if t.installed {
                                w::badge(ui, "installiert", c::OK);
                            } else if update {
                                w::badge(ui, "Update", c::WARN);
                            } else {
                                w::badge(ui, "verfügbar", c::MUTED);
                            }
                        });
                        row.col(|ui| {
                            ui.with_layout(Layout::right_to_left(Align::Center), |ui| {
                                if t.installed {
                                    if ui.add(Btn::icon_only(ph::TRASH, "Löschen").small().enabled(can_delete)).clicked() {
                                        delete = t.volid.clone();
                                    }
                                } else {
                                    let label = if update { "Aktualisieren" } else { "Laden" };
                                    if ui.add(Btn::secondary(label).icon(ph::DOWNLOAD_SIMPLE).small()).clicked() {
                                        download = Some(t.template.clone());
                                    }
                                }
                            });
                        });
                    });
                });
        });
        let path = format!("/api/hosts/{}/templates", seg(host));
        if let Some(template) = download {
            let body = json!({ "node": self.node, "storage": self.storage, "template": template });
            let p = path.clone();
            sh.run_task(format!("tpl:{template}"), format!("Vorlage {template} laden"), host, &[Tag::Templates], move |c| c.post::<Value>(&p, &body));
        }
        if let Some(volid) = delete {
            let node = self.node.clone();
            sh.confirm("Vorlage löschen?", format!("{volid} wird vom Storage entfernt."), "Löschen", true, move |sh| {
                let body = json!({ "action": "delete", "node": node, "volid": volid });
                sh.run("tpl:delete", "Vorlage gelöscht", &[Tag::Templates], move |c| c.post::<Value>(&path, &body));
            });
        }
    }

    fn iso_panel(&mut self, ui: &mut Ui, sh: &mut Shared, host: &str) {
        let Some(data) = self.iso.data.clone() else {
            loading(ui, &mut self.iso.error.clone(), || self.iso.invalidate());
            return;
        };
        if self.node.is_empty() {
            self.node = data.node.clone();
        }
        self.toolbar(ui, &data.nodes, &data.storages);
        let can_delete = sh.host(host).is_some_and(|h| sh.user.can_host(h, "storage.delete"));
        let q = self.search.to_lowercase();
        let path = format!("/api/hosts/{}/isos", seg(host));
        let mut download: Option<(String, String)> = None;
        let mut delete: Option<String> = None;
        w::section(ui, "Katalog", |_| {}, |ui| {
            for (i, row) in data
                .catalog
                .iter()
                .filter(|r| q.is_empty() || r.headline.to_lowercase().contains(&q))
                .filter(|r| match self.filter {
                    Filter::All => true,
                    Filter::Installed => !r.installed_volids.is_empty(),
                    Filter::Available => r.installed_volids.is_empty(),
                    Filter::Updates => r.update_available,
                })
                .enumerate()
            {
                if i > 0 {
                    w::separator(ui);
                }
                ui.horizontal(|ui| {
                    ui.label(w::icon_text(ph::DISC, 18.0, c::PURPLE));
                    ui.vertical(|ui| {
                        ui.spacing_mut().item_spacing.y = 1.0;
                        ui.label(w::strong(row.headline.clone()));
                        let ver = if row.installed_version.is_empty() {
                            format!("neueste {}", row.latest_version)
                        } else {
                            format!("installiert {} · neueste {}", row.installed_version, row.latest_version)
                        };
                        ui.label(w::small(format!("{} · {ver}", row.section)));
                    });
                    ui.with_layout(Layout::right_to_left(Align::Center), |ui| {
                        if row.update_available || row.installed_volids.is_empty() {
                            let label = if row.update_available { "Aktualisieren" } else { "Laden" };
                            if ui.add(Btn::secondary(label).icon(ph::DOWNLOAD_SIMPLE).small().enabled(!row.url.is_empty())).clicked() {
                                download = Some((row.url.clone(), row.latest_filename.clone()));
                            }
                        } else {
                            w::badge(ui, "aktuell", c::OK);
                        }
                    });
                });
            }
        });
        ui.add_space(12.0);
        w::section(ui, "Installierte ISOs", |_| {}, |ui| {
            if data.installed.is_empty() {
                ui.label(w::muted("Keine ISOs auf diesem Node."));
            }
            for volid in &data.installed {
                ui.horizontal(|ui| {
                    ui.label(RichText::new(volid.rsplit('/').next().unwrap_or(volid)).font(theme::mono(12.5)).color(c::TEXT));
                    ui.with_layout(Layout::right_to_left(Align::Center), |ui| {
                        if ui.add(Btn::icon_only(ph::TRASH, "Löschen").small().enabled(can_delete)).clicked() {
                            delete = Some(volid.clone());
                        }
                    });
                });
            }
        });
        ui.add_space(12.0);
        w::section(ui, "Von URL laden", |_| {}, |ui| {
            ui.horizontal(|ui| {
                w::text_input(ui, &mut self.custom_url, "https://…/image.iso", 360.0);
                w::text_input(ui, &mut self.custom_name, "Dateiname (optional)", 200.0);
                let ok = self.custom_url.starts_with("http");
                if ui.add(Btn::primary("Laden").icon(ph::DOWNLOAD_SIMPLE).enabled(ok)).clicked() {
                    download = Some((self.custom_url.trim().to_owned(), self.custom_name.trim().to_owned()));
                    self.custom_url.clear();
                    self.custom_name.clear();
                }
            });
        });
        if let Some((url, filename)) = download {
            let mut body = json!({ "node": self.node, "storage": self.storage, "url": url });
            if !filename.is_empty() {
                body["filename"] = json!(filename);
            }
            let p = path.clone();
            sh.run_task(format!("iso:{url}"), "ISO-Download", host, &[Tag::Templates], move |c| c.post::<Value>(&p, &body));
        }
        if let Some(volid) = delete {
            let node = self.node.clone();
            sh.confirm("ISO löschen?", format!("{volid} wird vom Storage entfernt."), "Löschen", true, move |sh| {
                let body = json!({ "action": "delete", "node": node, "volid": volid });
                sh.run("iso:delete", "ISO gelöscht", &[Tag::Templates], move |c| c.post::<Value>(&path, &body));
            });
        }
    }
}

fn loading(ui: &mut Ui, err: &mut Option<crate::net::ApiError>, retry: impl FnOnce()) {
    w::panel_frame().show(ui, |ui| {
        ui.set_min_width(ui.available_width());
        match err {
            Some(e) => {
                if w::error_box(ui, e) {
                    retry();
                }
            }
            None => w::skeleton(ui, 6),
        }
    });
}
