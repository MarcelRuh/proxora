use super::host_picker;
use crate::app::dialog::form_modal;
use crate::app::shared::Shared;
use crate::net::{query, seg, ApiResult, ConsoleLaunch, Pending, Resource, Script, ScriptDetail, ScriptsResponse};
use crate::term::TermRequest;
use crate::theme::{self, c};
use crate::ui::widgets::{self as w, Btn};
use eframe::egui::{self, Align, Layout, RichText, Ui, Vec2};
use egui_phosphor::regular as ph;
use serde_json::{json, Value};
use std::time::Duration;

#[derive(Clone, Copy, PartialEq, Eq)]
enum KindFilter {
    All,
    Lxc,
    Vm,
    Addon,
    Pve,
}

impl KindFilter {
    fn api(self) -> &'static str {
        match self {
            KindFilter::All => "all",
            KindFilter::Lxc => "lxc",
            KindFilter::Vm => "vm",
            KindFilter::Addon => "addon",
            KindFilter::Pve => "pve",
        }
    }
}

pub struct ScriptsPage {
    host: Option<String>,
    search: String,
    kind: KindFilter,
    category: String,
    list: Resource<ScriptsResponse>,
    shown: usize,
    detail: Option<(Script, Option<Pending<ApiResult<ScriptDetail>>>, Option<ScriptDetail>)>,
    refresh: bool,
}

impl Default for ScriptsPage {
    fn default() -> Self {
        Self {
            host: None,
            search: String::new(),
            kind: KindFilter::All,
            category: String::new(),
            list: Resource::new(),
            shown: 48,
            detail: None,
            refresh: false,
        }
    }
}

impl ScriptsPage {
    pub fn ui(&mut self, ui: &mut Ui, sh: &mut Shared) {
        sh.ensure_hosts();
        let key = format!("{}|{}|{}", self.search.trim(), self.kind.api(), self.category);
        if self.list.set_key(&key) {
            self.shown = 48;
        }
        let client = sh.client.clone();
        let (q, kind, cat, refresh) = (self.search.trim().to_owned(), self.kind.api().to_owned(), self.category.clone(), std::mem::take(&mut self.refresh));
        if refresh {
            self.list.invalidate();
        }
        self.list.ensure(&sh.ctx, Duration::from_secs(300), 0, || {
            move || {
                let mut pairs = vec![("q", q), ("kind", kind), ("category", cat)];
                if refresh {
                    pairs.push(("refresh", "1".into()));
                }
                client.get::<ScriptsResponse>(&format!("/api/community-scripts{}", query(&pairs)))
            }
        });

        let total = self.list.data.as_ref().map(|d| d.total).unwrap_or(0);
        w::page_header(ui, "Community-Skripte", Some(&format!("{total} Skripte aus community-scripts.org")), |ui| {
            if ui.add(Btn::secondary("Katalog aktualisieren").icon(ph::ARROW_CLOCKWISE).loading(self.list.loading())).clicked() {
                self.refresh = true;
            }
        });
        let user = sh.user.clone();
        ui.horizontal(|ui| {
            w::search_input(ui, &mut self.search, "Pi-hole, Jellyfin, Home Assistant …", 280.0);
            w::segmented(ui, &mut self.kind, &[(KindFilter::All, "Alle"), (KindFilter::Lxc, "LXC"), (KindFilter::Vm, "VM"), (KindFilter::Addon, "Add-on"), (KindFilter::Pve, "PVE")]);
            if let Some(data) = &self.list.data {
                let mut cats: Vec<(String, String)> = vec![(String::new(), "Alle Kategorien".into())];
                cats.extend(data.categories.iter().map(|c| (c.id.clone(), c.name.clone())));
                w::combo(ui, "script_cat", &mut self.category, &cats, 180.0);
            }
            ui.with_layout(Layout::right_to_left(Align::Center), |ui| {
                host_picker(ui, sh, &mut self.host, |h| user.can_host(h, "hosts.console"));
                ui.label(w::small("Installieren auf"));
            });
        });
        ui.add_space(12.0);

        let Some(data) = self.list.data.clone() else {
            w::panel_frame().show(ui, |ui| {
                ui.set_min_width(ui.available_width());
                match self.list.error.clone() {
                    Some(e) => {
                        if w::error_box(ui, &e) {
                            self.list.invalidate();
                        }
                    }
                    None => w::skeleton(ui, 8),
                }
            });
            return;
        };
        if data.stale {
            w::callout(ui, ph::WARNING, c::WARN, "Katalog-Cache ist veraltet — „Katalog aktualisieren“ lädt die aktuelle Liste.");
            ui.add_space(8.0);
        }
        let host_ok = self.host.as_ref().and_then(|id| sh.host(id)).is_some_and(|h| h.online() && sh.user.can_host(h, "hosts.console"));
        let mut open: Option<Script> = None;
        let mut install: Option<Script> = None;
        egui::ScrollArea::vertical().auto_shrink([false, false]).show(ui, |ui| {
            let width = ui.available_width();
            let cols = ((width + 12.0) / 330.0).floor().max(1.0) as usize;
            let card_w = (width - 12.0 * (cols as f32 - 1.0)) / cols as f32;
            for chunk in data.scripts.iter().take(self.shown).collect::<Vec<_>>().chunks(cols) {
                ui.horizontal(|ui| {
                    ui.spacing_mut().item_spacing.x = 12.0;
                    for s in chunk {
                        ui.allocate_ui_with_layout(Vec2::new(card_w, 150.0), Layout::top_down(Align::Min), |ui| {
                            w::panel_frame().inner_margin(egui::Margin::same(14)).show(ui, |ui| {
                                ui.set_width(card_w - 30.0);
                                ui.set_height(118.0);
                                ui.horizontal(|ui| {
                                    let icon = match s.kind.as_str() {
                                        "vm" => ph::MONITOR,
                                        "lxc" => ph::CUBE,
                                        "pve" => ph::DESKTOP_TOWER,
                                        _ => ph::PUZZLE_PIECE,
                                    };
                                    ui.label(w::icon_text(icon, 18.0, c::PURPLE));
                                    ui.add(egui::Label::new(w::strong(s.name.clone())).truncate());
                                    ui.with_layout(Layout::right_to_left(Align::Center), |ui| {
                                        w::badge(ui, &s.kind.to_uppercase(), c::CYAN);
                                    });
                                });
                                ui.add_space(4.0);
                                ui.add(egui::Label::new(w::muted(s.description.clone())).truncate());
                                ui.add_space(4.0);
                                let mut meta = Vec::new();
                                if let Some(cpu) = s.default_cpu {
                                    meta.push(format!("{cpu} vCPU"));
                                }
                                if let Some(ram) = s.default_ram_mb {
                                    meta.push(format!("{ram} MiB"));
                                }
                                if let Some(disk) = s.default_disk_gb {
                                    meta.push(format!("{disk} GiB"));
                                }
                                if let Some(port) = s.port {
                                    meta.push(format!("Port {port}"));
                                }
                                ui.label(RichText::new(meta.join(" · ")).font(theme::mono(11.0)).color(c::FAINT));
                                ui.with_layout(Layout::bottom_up(Align::Min), |ui| {
                                    ui.horizontal(|ui| {
                                        if ui.add(Btn::primary("Installieren").icon(ph::DOWNLOAD_SIMPLE).small().enabled(host_ok)).on_disabled_hover_text("Online-Host mit Konsolen-Recht wählen").clicked() {
                                            install = Some((*s).clone());
                                        }
                                        if ui.add(Btn::ghost("Details").small()).clicked() {
                                            open = Some((*s).clone());
                                        }
                                    });
                                });
                            });
                        });
                    }
                });
                ui.add_space(12.0);
            }
            if data.scripts.len() > self.shown {
                ui.vertical_centered(|ui| {
                    if ui.add(Btn::secondary(&format!("Mehr laden ({} von {})", self.shown, data.scripts.len()))).clicked() {
                        self.shown += 48;
                    }
                });
            }
            if data.scripts.is_empty() {
                w::empty_state(ui, ph::SCROLL, "Keine Skripte", "Suche oder Filter anpassen.");
            }
        });
        if let Some(s) = open {
            let client = sh.client.clone();
            let slug = s.slug.clone();
            let p = Pending::spawn(&sh.ctx, move || client.get::<ScriptDetail>(&format!("/api/community-scripts/{}", seg(&slug))));
            self.detail = Some((s, Some(p), None));
        }
        if let Some(s) = install {
            self.confirm_install(sh, s);
        }
        self.detail_modal(ui.ctx(), sh, host_ok);
    }

    fn confirm_install(&mut self, sh: &mut Shared, script: Script) {
        let Some(host) = self.host.clone() else { return };
        let host_name = sh.host(&host).map(|h| h.name.clone()).unwrap_or_default();
        let name = script.name.clone();
        sh.confirm(
            format!("{name} auf {host_name} installieren?"),
            "Das Skript läuft als root in der Shell des Nodes und stellt dort Fragen. Ein Terminal öffnet sich unten.",
            "Installieren",
            false,
            move |sh| {
                let slug = script.slug.clone();
                let path = format!("/api/hosts/{}/community-scripts/run", seg(&host));
                sh.run_then(
                    format!("script:{slug}"),
                    format!("{name} vorbereiten"),
                    &[],
                    move |c| c.post::<Value>(&path, &json!({ "slug": slug, "confirm": true })),
                    move |sh, v| {
                        let launch: ConsoleLaunch = serde_json::from_value(v).unwrap_or_default();
                        sh.open_terminal(TermRequest {
                            title: format!("{name} · {}", launch.node),
                            host_id: host,
                            node: launch.node.clone(),
                            kind: "node".into(),
                            vmid: None,
                            cmd: None,
                            initial_input: launch.command.clone(),
                        });
                    },
                );
            },
        );
    }

    fn detail_modal(&mut self, ctx: &egui::Context, sh: &mut Shared, host_ok: bool) {
        let Some((script, pending, detail)) = &mut self.detail else { return };
        if let Some(res) = pending.as_ref().and_then(Pending::poll) {
            *pending = None;
            match res {
                Ok(d) => *detail = Some(d),
                Err(e) => sh.toasts.error("Details nicht geladen", e.message),
            }
        }
        let mut close = false;
        let mut install = false;
        let closed = form_modal(ctx, "script_detail", &script.name, 520.0, |ui| {
            ui.add(egui::Label::new(w::secondary(script.description.clone())).wrap());
            ui.add_space(10.0);
            w::kv_grid(ui, "script_kv", &[
                ("Art", script.kind.to_uppercase()),
                ("Port", script.port.map(|p| p.to_string()).unwrap_or_default()),
                ("Privilegiert", if script.privileged { "ja".into() } else { "nein".into() }),
                ("Update-Skript", if script.updateable { "ja".into() } else { "nein".into() }),
                ("Standard", format!("{} vCPU · {} MiB · {} GiB", script.default_cpu.unwrap_or(0), script.default_ram_mb.unwrap_or(0), script.default_disk_gb.unwrap_or(0))),
            ]);
            ui.add_space(10.0);
            match detail {
                Some(d) => {
                    ui.label(w::label("Installationsbefehl"));
                    ui.horizontal(|ui| {
                        egui::Frame::new().fill(c::INPUT).corner_radius(4).inner_margin(egui::Margin::same(8)).show(ui, |ui| {
                            ui.add(egui::Label::new(RichText::new(&d.command).font(theme::mono(11.5)).color(c::TEXT_2)).wrap());
                        });
                    });
                    ui.horizontal(|ui| {
                        w::copy_button(ui, &d.command);
                        if ui.add(Btn::ghost("Script-Seite").icon(ph::ARROW_SQUARE_OUT).small()).clicked() {
                            let _ = open::that_detached(&d.page_url);
                        }
                        if ui.add(Btn::ghost("Quelle").icon(ph::GIT_BRANCH).small()).clicked() {
                            let _ = open::that_detached(&d.source_url);
                        }
                        if let Some(doc) = &script.documentation {
                            if ui.add(Btn::ghost("Doku").icon(ph::INFO).small()).clicked() {
                                let _ = open::that_detached(doc);
                            }
                        }
                    });
                }
                None => w::skeleton(ui, 2),
            }
            ui.add_space(14.0);
            ui.horizontal(|ui| {
                install = ui.add(Btn::primary("Installieren").icon(ph::DOWNLOAD_SIMPLE).enabled(host_ok)).clicked();
                close = ui.add(Btn::secondary("Schließen")).clicked();
            });
        });
        let chosen = install.then(|| script.clone());
        if close || closed || install {
            self.detail = None;
        }
        if let Some(s) = chosen {
            self.confirm_install(sh, s);
        }
    }
}

