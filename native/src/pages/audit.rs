use crate::app::shared::{Shared, Tag};
use crate::net::{query, AuditLog, AuditResponse, Pending, ApiResult, Resource};
use crate::theme::{c, ROW_H};
use crate::ui::format;
use crate::ui::widgets::{self as w, Btn};
use eframe::egui::{self, Align, Layout, Stroke, Ui};
use egui_extras::{Column, TableBuilder};
use egui_phosphor::regular as ph;
use std::time::Duration;

#[derive(Clone, Copy, PartialEq, Eq)]
enum ResultFilter {
    All,
    Success,
    Failure,
}

pub struct AuditPage {
    first: Resource<AuditResponse>,
    more: Vec<AuditLog>,
    loading_more: Option<Pending<ApiResult<AuditResponse>>>,
    exhausted: bool,
    search: String,
    result: ResultFilter,
}

impl Default for AuditPage {
    fn default() -> Self {
        Self { first: Resource::new(), more: Vec::new(), loading_more: None, exhausted: false, search: String::new(), result: ResultFilter::All }
    }
}

pub fn action_label(action: &str) -> String {
    let known = [
        ("LOGIN_SUCCESS", "Anmeldung"), ("LOGIN_FAILED", "Anmeldung fehlgeschlagen"), ("LOGOUT", "Abmeldung"),
        ("TOTP_ENABLED", "2FA aktiviert"), ("TOTP_DISABLED", "2FA deaktiviert"), ("SESSION_REVOKED", "Sitzung beendet"),
        ("HOST_ADDED", "Host hinzugefügt"), ("HOST_UPDATED", "Host geändert"), ("HOST_DELETED", "Host entfernt"),
        ("HOST_REBOOT", "Host-Neustart"), ("HOST_SHUTDOWN", "Host heruntergefahren"), ("PROXORA_BACKUP", "DB-Backup"),
        ("BACKUP_STARTED", "Backup gestartet"), ("BACKUP_RESTORED", "Backup wiederhergestellt"), ("BACKUP_FILE_DELETED", "Backup gelöscht"),
        ("USER_CREATED", "Benutzer angelegt"), ("USER_UPDATED", "Benutzer geändert"), ("USER_DELETED", "Benutzer gelöscht"),
        ("ROLE_CREATED", "Rolle angelegt"), ("ROLE_UPDATED", "Rolle geändert"), ("ROLE_DELETED", "Rolle gelöscht"),
        ("CONSOLE_OPENED", "Konsole geöffnet"), ("TASK_STOPPED", "Task abgebrochen"), ("SELF_UPDATE_STARTED", "Self-Update gestartet"),
        ("COMMUNITY_SCRIPT_STARTED", "Community-Skript gestartet"), ("STORAGE_CONTENT_DELETED", "Volume gelöscht"),
    ];
    if let Some((_, l)) = known.iter().find(|(k, _)| *k == action) {
        return (*l).to_owned();
    }
    let (subject, rest) = action.split_once('_').unwrap_or((action, ""));
    let subject = match subject {
        "VM" => "VM",
        "LXC" => "Container",
        "GUEST" => "Gast",
        "ISO" => "ISO",
        "UPDATE" => "Update",
        "BACKUP" => "Backup",
        _ => subject,
    };
    let verb = match rest {
        "CREATED" => "erstellt",
        "DELETED" => "gelöscht",
        "STARTED" => "gestartet",
        "STOPPED" => "gestoppt",
        "SHUTDOWN" => "heruntergefahren",
        "REBOOT" => "neu gestartet",
        "RESET" => "zurückgesetzt",
        "PAUSED" => "pausiert",
        "RESUMED" => "fortgesetzt",
        "CLONED" => "geklont",
        "MIGRATED" => "migriert",
        "CONFIG_UPDATED" => "konfiguriert",
        "DISK_RESIZED" => "Disk vergrößert",
        "SNAPSHOT_CREATED" => "Snapshot erstellt",
        "SNAPSHOT_DELETED" => "Snapshot gelöscht",
        "SNAPSHOT_RESTORED" => "Snapshot zurückgerollt",
        "TEMPLATE_DOWNLOADED" => "Vorlage geladen",
        "TEMPLATE_DELETED" => "Vorlage gelöscht",
        "DOWNLOADED" => "geladen",
        "FINISHED" => "beendet",
        "FAILED" => "fehlgeschlagen",
        "FILES_LIST" => "Dateien gelistet",
        "FILES_READ" => "Datei gelesen",
        "FILES_WRITE" => "Datei geschrieben",
        "FILES_MKDIR" => "Ordner angelegt",
        "FILES_DELETE" => "Datei gelöscht",
        "FILES_RENAME" => "Datei umbenannt",
        "FILES_DOWNLOAD" => "Datei heruntergeladen",
        "JOB_CREATED" => "Job angelegt",
        "JOB_UPDATED" => "Job geändert",
        "JOB_DELETED" => "Job gelöscht",
        other => return format!("{subject} {}", other.replace('_', " ").to_lowercase()).trim().to_owned(),
    };
    format!("{subject} {verb}")
}

impl AuditPage {
    pub fn ui(&mut self, ui: &mut Ui, sh: &mut Shared) {
        let client = sh.client.clone();
        if self.first.poll() {
            self.more.clear();
            self.exhausted = false;
        }
        self.first.ensure(&sh.ctx, Duration::from_secs(30), sh.epoch(Tag::Audit), || move || client.get::<AuditResponse>("/api/audit?take=100"));
        if let Some(res) = self.loading_more.as_ref().and_then(Pending::poll) {
            self.loading_more = None;
            match res {
                Ok(r) => {
                    self.exhausted = r.logs.len() < 100;
                    self.more.extend(r.logs);
                }
                Err(e) => sh.toasts.error("Ältere Einträge nicht geladen", e.message),
            }
        }
        w::page_header(ui, "Audit-Log", Some("Wer hat wann was getan"), |ui| {
            if ui.add(Btn::secondary("Aktualisieren").icon(ph::ARROW_CLOCKWISE).loading(self.first.loading())).clicked() {
                sh.bump(Tag::Audit);
            }
        });
        ui.horizontal(|ui| {
            w::search_input(ui, &mut self.search, "Benutzer, Aktion, Ziel, IP …", 280.0);
            w::segmented(ui, &mut self.result, &[(ResultFilter::All, "Alle"), (ResultFilter::Success, "Erfolg"), (ResultFilter::Failure, "Fehler")]);
        });
        ui.add_space(10.0);
        let Some(first) = self.first.data.clone() else {
            w::panel_frame().show(ui, |ui| {
                ui.set_min_width(ui.available_width());
                match self.first.error.clone() {
                    Some(e) => {
                        if w::error_box(ui, &e) {
                            self.first.invalidate();
                        }
                    }
                    None => w::skeleton(ui, 8),
                }
            });
            return;
        };
        let q = self.search.to_lowercase();
        let all: Vec<&AuditLog> = first.logs.iter().chain(self.more.iter()).collect();
        let list: Vec<&AuditLog> = all
            .iter()
            .copied()
            .filter(|l| match self.result {
                ResultFilter::All => true,
                ResultFilter::Success => l.result == "SUCCESS",
                ResultFilter::Failure => l.result != "SUCCESS",
            })
            .filter(|l| {
                q.is_empty()
                    || format!(
                        "{} {} {} {} {} {}",
                        l.user.as_ref().map(|u| u.name.as_str()).unwrap_or(""),
                        l.action,
                        action_label(&l.action),
                        l.target.as_deref().unwrap_or(""),
                        l.ip.as_deref().unwrap_or(""),
                        l.host.as_ref().map(|h| h.name.as_str()).unwrap_or("")
                    )
                    .to_lowercase()
                    .contains(&q)
            })
            .collect();
        let last_id = all.last().map(|l| l.id.clone());
        let mut load_more = false;
        w::panel_frame().inner_margin(egui::Margin::symmetric(10, 8)).show(ui, |ui| {
            ui.set_min_width(ui.available_width());
            if list.is_empty() {
                w::empty_state(ui, ph::CLIPBOARD_TEXT, "Keine Einträge", "Filter anpassen.");
                return;
            }
            let top = ui.cursor().top();
            ui.painter().hline(ui.max_rect().x_range(), top + 30.0, Stroke::new(1.0_f32, c::BORDER));
            let max_h = ui.available_height() - 50.0;
            TableBuilder::new(ui)
                .id_salt("audit_table")
                .striped(true)
                .auto_shrink([false, false])
                .max_scroll_height(max_h)
                .cell_layout(Layout::left_to_right(Align::Center))
                .column(Column::exact(130.0))
                .column(Column::exact(120.0).clip(true))
                .column(Column::remainder().at_least(180.0).clip(true))
                .column(Column::exact(130.0).clip(true))
                .column(Column::exact(90.0))
                .column(Column::exact(120.0).clip(true))
                .header(30.0, |mut r| {
                    for t in ["Zeit", "Benutzer", "Aktion", "Host", "Ergebnis", "IP"] {
                        r.col(|ui| w::th(ui, t));
                    }
                })
                .body(|body| {
                    body.rows(ROW_H, list.len(), |mut row| {
                        let l = list[row.index()];
                        row.col(|ui| { ui.label(w::mono(format::timestamp(&l.created_at))); });
                        row.col(|ui| { ui.label(w::secondary(l.user.as_ref().map(|u| u.name.clone()).unwrap_or_else(|| "—".into()))); });
                        row.col(|ui| {
                            ui.vertical(|ui| {
                                ui.spacing_mut().item_spacing.y = 1.0;
                                ui.label(w::strong(action_label(&l.action)));
                                let mut sub = l.target.clone().unwrap_or_default();
                                if let Some(e) = l.error.as_ref().filter(|e| !e.is_empty()) {
                                    sub = format!("{sub} · {e}");
                                }
                                ui.label(w::small(sub));
                            });
                        });
                        row.col(|ui| { ui.label(w::small(l.host.as_ref().map(|h| h.name.clone()).unwrap_or_default())); });
                        row.col(|ui| {
                            if l.result == "SUCCESS" {
                                w::badge(ui, "Erfolg", c::OK);
                            } else {
                                w::badge(ui, "Fehler", c::DANGER);
                            }
                        });
                        row.col(|ui| { ui.label(w::mono(l.ip.clone().unwrap_or_default())); });
                    });
                });
            ui.add_space(8.0);
            if !self.exhausted && first.logs.len() >= 100 {
                ui.vertical_centered(|ui| {
                    if ui.add(Btn::secondary("Ältere laden").loading(self.loading_more.is_some())).clicked() {
                        load_more = true;
                    }
                });
            }
        });
        if load_more {
            if let Some(cursor) = last_id {
                let client = sh.client.clone();
                self.loading_more = Some(Pending::spawn(&sh.ctx, move || {
                    client.get::<AuditResponse>(&format!("/api/audit{}", query(&[("take", "100".into()), ("cursor", cursor)])))
                }));
            }
        }
    }
}
