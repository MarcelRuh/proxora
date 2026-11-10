use crate::app::dialog::form_modal;
use crate::app::shared::{Shared, Tag};
use crate::net::{seg, HostGrant, Resource, RolesResponse, UserDto, UsersResponse};
use crate::theme::{c, ROW_H};
use crate::ui::format;
use crate::ui::widgets::{self as w, Btn};
use eframe::egui::{self, Align, Layout, Stroke, Ui};
use egui_extras::{Column, TableBuilder};
use egui_phosphor::regular as ph;
use serde_json::{json, Value};
use std::collections::BTreeSet;
use std::time::Duration;

struct UserDraft {
    id: Option<String>,
    username: String,
    email: String,
    password: String,
    role_id: String,
    active: bool,
    all_hosts: bool,
    hosts: BTreeSet<String>,
    original_hosts: Vec<HostGrant>,
}

#[derive(Default)]
pub struct UsersPage {
    users: Resource<UsersResponse>,
    roles: Resource<RolesResponse>,
    search: String,
    draft: Option<UserDraft>,
}

impl UsersPage {
    pub fn ui(&mut self, ui: &mut Ui, sh: &mut Shared) {
        sh.ensure_hosts();
        let (c1, c2) = (sh.client.clone(), sh.client.clone());
        self.users.ensure(&sh.ctx, Duration::from_secs(60), sh.epoch(Tag::Users), || move || c1.get::<UsersResponse>("/api/users"));
        if sh.user.can("roles.view") || sh.user.can("users.create") || sh.user.can("users.update") {
            self.roles.ensure(&sh.ctx, Duration::from_secs(120), sh.epoch(Tag::Roles), || move || c2.get::<RolesResponse>("/api/roles"));
        }
        let can_create = sh.user.can("users.create");
        let can_update = sh.user.can("users.update");
        let can_delete = sh.user.can("users.delete");
        let n = self.users.data.as_ref().map(|u| u.users.len()).unwrap_or(0);
        let mut create = false;
        w::page_header(ui, "Benutzer", Some(&format!("{n} Konten")), |ui| {
            if ui.add(Btn::primary("Benutzer anlegen").icon(ph::PLUS).enabled(can_create)).clicked() {
                create = true;
            }
        });
        if create {
            let role_id = self.roles.data.as_ref().and_then(|r| r.roles.iter().find(|r| r.slug == "operator").or(r.roles.first()).map(|r| r.id.clone())).unwrap_or_default();
            self.draft = Some(UserDraft { id: None, username: String::new(), email: String::new(), password: String::new(), role_id, active: true, all_hosts: true, hosts: BTreeSet::new(), original_hosts: Vec::new() });
        }
        ui.horizontal(|ui| {
            w::search_input(ui, &mut self.search, "Name oder E-Mail …", 260.0);
        });
        ui.add_space(10.0);
        let Some(data) = self.users.data.clone() else {
            w::panel_frame().show(ui, |ui| {
                ui.set_min_width(ui.available_width());
                match self.users.error.clone() {
                    Some(e) => {
                        if w::error_box(ui, &e) {
                            self.users.invalidate();
                        }
                    }
                    None => w::skeleton(ui, 6),
                }
            });
            return;
        };
        let q = self.search.to_lowercase();
        let list: Vec<&UserDto> = data.users.iter().filter(|u| q.is_empty() || format!("{} {}", u.username, u.email).to_lowercase().contains(&q)).collect();
        let mut edit: Option<UserDto> = None;
        let mut delete: Option<UserDto> = None;
        let me = sh.user.id.clone();
        w::panel_frame().inner_margin(egui::Margin::symmetric(10, 8)).show(ui, |ui| {
            ui.set_min_width(ui.available_width());
            let top = ui.cursor().top();
            ui.painter().hline(ui.max_rect().x_range(), top + 30.0, Stroke::new(1.0_f32, c::BORDER));
            TableBuilder::new(ui)
                .id_salt("users_table")
                .striped(true)
                .auto_shrink([false, false])
                .cell_layout(Layout::left_to_right(Align::Center))
                .column(Column::remainder().at_least(200.0).clip(true))
                .column(Column::exact(130.0).clip(true))
                .column(Column::exact(90.0))
                .column(Column::exact(60.0))
                .column(Column::exact(150.0).clip(true))
                .column(Column::exact(110.0))
                .column(Column::exact(72.0))
                .header(30.0, |mut r| {
                    for t in ["Benutzer", "Rolle", "Status", "2FA", "Zugriff", "Letzte Anmeldung", ""] {
                        r.col(|ui| w::th(ui, t));
                    }
                })
                .body(|body| {
                    body.rows(ROW_H + 6.0, list.len(), |mut row| {
                        let u = list[row.index()];
                        row.col(|ui| {
                            ui.vertical(|ui| {
                                ui.spacing_mut().item_spacing.y = 1.0;
                                ui.horizontal(|ui| {
                                    ui.label(w::strong(u.username.clone()));
                                    if u.id == me {
                                        w::badge(ui, "du", c::PURPLE);
                                    }
                                });
                                ui.label(w::small(u.email.clone()));
                            });
                        });
                        row.col(|ui| { ui.label(w::secondary(u.role.name.clone())); });
                        row.col(|ui| {
                            if u.status == "ACTIVE" {
                                w::badge(ui, "aktiv", c::OK);
                            } else {
                                w::badge(ui, "gesperrt", c::MUTED);
                            }
                        });
                        row.col(|ui| {
                            ui.label(w::icon_text(if u.totp_enabled { ph::SHIELD_CHECK } else { ph::SHIELD }, 16.0, if u.totp_enabled { c::OK } else { c::FAINT }));
                        });
                        row.col(|ui| {
                            let text = if u.hosts.is_empty() && u.guests.is_empty() {
                                "alle Hosts".to_owned()
                            } else {
                                format!("{} Hosts · {} Gäste", u.hosts.len(), u.guests.len())
                            };
                            ui.label(w::small(text));
                        });
                        row.col(|ui| { ui.label(w::small(u.last_login_at.as_deref().map(format::relative).unwrap_or_else(|| "nie".into()))); });
                        row.col(|ui| {
                            ui.with_layout(Layout::right_to_left(Align::Center), |ui| {
                                if ui.add(Btn::icon_only(ph::TRASH, "Löschen").small().enabled(can_delete && u.id != me)).clicked() {
                                    delete = Some(u.clone());
                                }
                                if ui.add(Btn::icon_only(ph::PENCIL_SIMPLE, "Bearbeiten").small().enabled(can_update)).clicked() {
                                    edit = Some(u.clone());
                                }
                            });
                        });
                    });
                });
        });
        if let Some(u) = edit {
            self.draft = Some(UserDraft {
                id: Some(u.id.clone()),
                username: u.username.clone(),
                email: u.email.clone(),
                password: String::new(),
                role_id: u.role_id.clone(),
                active: u.status == "ACTIVE",
                all_hosts: u.hosts.is_empty(),
                hosts: u.hosts.iter().map(|h| h.host_id.clone()).collect(),
                original_hosts: u.hosts.clone(),
            });
        }
        if let Some(u) = delete {
            sh.confirm(format!("{} löschen?", u.username), "Das Konto und alle Sitzungen werden entfernt.", "Löschen", true, move |sh| {
                let path = format!("/api/users/{}", seg(&u.id));
                sh.run("user:delete", format!("{} gelöscht", u.username), &[Tag::Users], move |c| c.delete::<Value>(&path));
            });
        }
        self.dialog(ui.ctx(), sh);
    }

    fn dialog(&mut self, ctx: &egui::Context, sh: &mut Shared) {
        let Some(d) = &mut self.draft else { return };
        let roles: Vec<(String, String)> = self.roles.data.as_ref().map(|r| r.roles.iter().map(|r| (r.id.clone(), r.name.clone())).collect()).unwrap_or_default();
        let hosts: Vec<(String, String)> = sh.hosts.data.iter().flatten().filter(|h| !h.is_peer()).map(|h| (h.id.clone(), h.name.clone())).collect();
        let editing = d.id.is_some();
        let mut save = false;
        let mut cancel = false;
        let closed = form_modal(ctx, "user_dialog", if editing { "Benutzer bearbeiten" } else { "Benutzer anlegen" }, 460.0, |ui| {
            w::field(ui, "Benutzername", None, |ui| ui.add_enabled(!editing, egui::TextEdit::singleline(&mut d.username).desired_width(f32::INFINITY)));
            w::field(ui, "E-Mail", None, |ui| w::text_input(ui, &mut d.email, "name@firma.de", ui.available_width()));
            let hint = if editing { "Leer lassen, um es nicht zu ändern (beendet alle Sitzungen)" } else { "Mindestens 10 Zeichen" };
            w::field(ui, "Passwort", Some(hint), |ui| w::password_input(ui, &mut d.password, "", ui.available_width()));
            w::field(ui, "Rolle", None, |ui| w::combo(ui, "user_role", &mut d.role_id, &roles, 240.0));
            if editing {
                ui.checkbox(&mut d.active, "Konto aktiv");
                ui.add_space(6.0);
            }
            ui.label(w::label("Zugriff"));
            ui.checkbox(&mut d.all_hosts, "Alle Hosts (gemäß Rolle)");
            if !d.all_hosts {
                ui.horizontal_wrapped(|ui| {
                    for (id, name) in &hosts {
                        let on = d.hosts.contains(id);
                        if ui.add(Btn::secondary(name).small().selected(on)).clicked() {
                            if on {
                                d.hosts.remove(id);
                            } else {
                                d.hosts.insert(id.clone());
                            }
                        }
                    }
                });
                ui.label(w::small("Feinere Rechte pro Host oder Gast bleiben erhalten und lassen sich in der Web-Oberfläche anpassen."));
            }
            ui.add_space(14.0);
            ui.horizontal(|ui| {
                let pw_ok = if editing { d.password.is_empty() || d.password.len() >= 10 } else { d.password.len() >= 10 };
                let ok = d.username.trim().len() >= 2 && d.email.contains('@') && !d.role_id.is_empty() && pw_ok;
                save = ui.add(Btn::primary("Speichern").icon(ph::FLOPPY_DISK).enabled(ok)).clicked();
                cancel = ui.add(Btn::secondary("Abbrechen")).clicked();
            });
        });
        if save {
            let grants: Vec<Value> = if d.all_hosts {
                Vec::new()
            } else {
                d.hosts
                    .iter()
                    .map(|id| {
                        let perms = d.original_hosts.iter().find(|g| &g.host_id == id).and_then(|g| g.permissions.clone());
                        json!({ "hostId": id, "permissions": perms })
                    })
                    .collect()
            };
            let mut body = json!({ "email": d.email.trim(), "roleId": d.role_id, "hosts": grants });
            if !d.password.is_empty() {
                body["password"] = json!(d.password);
            }
            match &d.id {
                Some(id) => {
                    body["status"] = json!(if d.active { "ACTIVE" } else { "DISABLED" });
                    let path = format!("/api/users/{}", seg(id));
                    sh.run("user:save", format!("{} gespeichert", d.username), &[Tag::Users], move |c| c.patch::<Value>(&path, &body));
                }
                None => {
                    body["username"] = json!(d.username.trim());
                    sh.run("user:create", format!("{} angelegt", d.username.trim()), &[Tag::Users], move |c| c.post::<Value>("/api/users", &body));
                }
            }
            cancel = true;
        }
        if cancel || closed {
            self.draft = None;
        }
    }
}
