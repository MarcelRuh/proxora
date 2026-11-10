use crate::app::shared::{Shared, Tag};
use crate::net::{ApiError, ApiResult, Health, Pending};
use crate::theme::{self, c};
use crate::ui::widgets::{self as w, Btn};
use eframe::egui::{self, RichText, Ui};
use egui_phosphor::regular as ph;
use serde_json::{json, Value};
use std::time::{Duration, Instant};

#[derive(Default)]
pub struct ProxoraPage {
    restart_wait: Option<(Instant, Option<Pending<ApiResult<Health>>>)>,
}

impl ProxoraPage {
    pub fn ui(&mut self, ui: &mut Ui, sh: &mut Shared) {
        sh.ensure_self_update();
        self.poll(sh);
        let status = sh.self_update.data.clone();
        let can_update = sh.user.can("proxora.update");
        w::page_header(ui, "Proxora", Some("Server-Version, Self-Update und Datenbank-Backup"), |ui| {
            if ui.add(Btn::secondary("Prüfen").icon(ph::ARROW_CLOCKWISE).loading(sh.self_update.loading())).clicked() {
                sh.bump(Tag::SelfUpdate);
            }
            if ui.add(Btn::secondary("DB-Backup").icon(ph::DOWNLOAD_SIMPLE).enabled(can_update)).on_hover_text("SQL-Dump der Proxora-Datenbank herunterladen").clicked() {
                download_backup(sh);
            }
        });
        let Some(s) = status else {
            match sh.self_update.error.clone() {
                Some(e) => {
                    if w::error_box(ui, &e) {
                        sh.self_update.invalidate();
                    }
                }
                None => w::skeleton(ui, 5),
            }
            return;
        };
        egui::ScrollArea::vertical().auto_shrink([false, false]).show(ui, |ui| {
            ui.set_max_width(900.0);
            w::section(ui, "Server-Update", |ui| {
                if s.updating {
                    w::badge(ui, "läuft", c::CYAN);
                } else if s.update_available {
                    w::badge(ui, "Update verfügbar", c::WARN);
                } else {
                    w::badge(ui, "aktuell", c::OK);
                }
            }, |ui| {
                ui.horizontal(|ui| {
                    ui.label(RichText::new(format!("v{}", s.current_version)).font(theme::semibold(24.0)).color(c::TEXT));
                    if let Some(t) = s.target_version.as_ref().filter(|_| s.update_available) {
                        ui.label(w::icon_text(ph::ARROW_RIGHT, 18.0, c::MUTED));
                        ui.label(RichText::new(format!("v{t}")).font(theme::semibold(24.0)).color(c::PINK));
                    }
                });
                if !s.message.is_empty() {
                    ui.label(w::muted(s.message.clone()));
                }
                if let Some(p) = &s.progress {
                    ui.add_space(10.0);
                    ui.horizontal(|ui| {
                        if s.updating {
                            ui.spinner();
                        }
                        ui.label(w::strong(step_label(&p.step)));
                        ui.label(w::small(format!("{} %", p.percent)));
                    });
                    w::meter(ui, p.percent as f32 / 100.0, ui.available_width(), 6.0);
                    if let Some(d) = &p.detail {
                        ui.label(w::small(d.clone()));
                    }
                }
                if let Some((since, _)) = &self.restart_wait {
                    ui.add_space(8.0);
                    w::callout(ui, ph::CIRCLE_NOTCH, c::CYAN, &format!("Server startet neu … ({} s)", since.elapsed().as_secs()));
                }
                ui.add_space(12.0);
                let image_missing = s.image_ready == Some(false);
                let sidecar_missing = s.sidecar == "missing";
                let applying = sh.op_running("selfupdate");
                let ready = can_update && s.update_available && !s.updating && !image_missing && !sidecar_missing && !applying;
                ui.horizontal(|ui| {
                    if ui.add(Btn::primary("Update installieren").icon(ph::ROCKET_LAUNCH).enabled(ready).loading(applying)).clicked() {
                        let from = s.current_version.clone();
                        let to = s.target_version.clone().unwrap_or_default();
                        let client = sh.client.clone();
                        sh.confirm(
                            format!("Proxora von {from} auf {to} aktualisieren?"),
                            "Der Server lädt das neue Image und startet neu. Die Oberfläche ist dabei kurz nicht erreichbar.",
                            "Aktualisieren",
                            false,
                            move |sh| {
                                sh.run_then("selfupdate", "Self-Update gestartet", &[Tag::SelfUpdate], move |_c| {
                                    client.post::<Value>("/api/system/self-update", &json!({}))
                                }, |sh, _| {
                                    sh.toasts.info("Self-Update läuft — Fortschritt erscheint hier.");
                                    sh.bump(Tag::SelfUpdate);
                                });
                            },
                        );
                    }
                    if image_missing {
                        ui.label(w::small("Warte auf das Image in der Registry …"));
                    }
                    if sidecar_missing {
                        ui.label(w::small("Update-Sidecar fehlt — Self-Update nicht möglich."));
                    }
                });
            });
            ui.add_space(12.0);
            w::section(ui, "Details", |_| {}, |ui| {
                w::kv_grid(ui, "su_details", &[
                    ("Repository", format!("{}{}", s.repo.clone().unwrap_or_default(), s.target_tag.as_ref().map(|t| format!(" @ {t}")).unwrap_or_default())),
                    ("Branch", s.branch.clone().unwrap_or_default()),
                    ("Installation", s.install_dir.clone().unwrap_or_default()),
                    ("Revision", format!("{} → {}", short(s.local_revision.as_deref()), short(s.remote_revision.as_deref()))),
                    ("Modus / Sidecar", format!("{} · {}", s.mode, s.sidecar)),
                ]);
            });
            if let Some(log) = s.changelog.as_ref().filter(|c| !c.trim().is_empty()) {
                ui.add_space(12.0);
                w::section(ui, "Änderungen", |_| {}, |ui| {
                    for line in log.lines().take(60) {
                        ui.label(w::secondary(line.to_owned()));
                    }
                });
            }
        });
    }

    fn poll(&mut self, sh: &mut Shared) {
        let updating = sh.self_update.data.as_ref().is_some_and(|s| s.updating);
        if updating && self.restart_wait.is_none() {
            self.restart_wait = Some((Instant::now(), None));
        }
        if let Some((since, pending)) = &mut self.restart_wait {
            if let Some(res) = pending.as_ref().and_then(Pending::poll) {
                *pending = None;
                if let Ok(h) = res {
                    if !updating && h.status == "ok" {
                        sh.server_version = h.version.clone();
                        sh.toasts.success(format!("Proxora läuft wieder{}", h.version.map(|v| format!(" · {v}")).unwrap_or_default()));
                        sh.bump_all();
                        self.restart_wait = None;
                        return;
                    }
                }
            }
            if pending.is_none() && since.elapsed() > Duration::from_secs(4) {
                let client = sh.client.clone();
                *pending = Some(Pending::spawn(&sh.ctx, move || {
                    std::thread::sleep(Duration::from_secs(2));
                    client.get::<Health>("/api/health")
                }));
            }
            if since.elapsed() > Duration::from_secs(300) {
                sh.toasts.warning("Server meldet sich nicht zurück", "Status in der Web-Oberfläche oder per SSH prüfen.");
                self.restart_wait = None;
            }
        }
    }
}

fn short(r: Option<&str>) -> String {
    r.map(|s| s.chars().take(8).collect()).unwrap_or_else(|| "—".into())
}

fn step_label(step: &str) -> String {
    match step {
        "cleanup" => "Aufräumen".into(),
        "start" => "Start".into(),
        "resolve" => "Version auflösen".into(),
        "sync" => "Quellen synchronisieren".into(),
        "build" | "buildWeb" => "Image bauen".into(),
        "pull" => "Image laden".into(),
        "export" => "Export".into(),
        "startWeb" => "Dienst starten".into(),
        "finalize" => "Abschluss".into(),
        "done" => "Fertig".into(),
        "error" => "Fehler".into(),
        other => other.to_owned(),
    }
}

fn download_backup(sh: &mut Shared) {
    let name = format!("proxora-{}.sql", chrono::Utc::now().format("%Y-%m-%d-%H-%M-%S"));
    let Some(dest) = rfd::FileDialog::new().set_file_name(&name).add_filter("SQL", &["sql"]).save_file() else {
        return;
    };
    sh.run("proxora:backup", "Datenbank-Backup gespeichert", &[], move |c| {
        let bytes = c.download("/api/proxora/backup", &dest)?;
        if bytes == 0 {
            return Err(ApiError::msg("Leere Antwort vom Server"));
        }
        Ok(Value::Null)
    });
}
