use crate::app::shared::{Shared, Tag};
use crate::net::{seg, Resource, RoleDto, RolesResponse};
use crate::theme::{self, c};
use crate::ui::widgets::{self as w, Btn};
use eframe::egui::{self, Align, Layout, RichText, Ui};
use egui_phosphor::regular as ph;
use serde_json::{json, Value};
use std::collections::BTreeSet;
use std::time::Duration;

struct RoleDraft {
    id: Option<String>,
    system: bool,
    name: String,
    slug: String,
    description: String,
    perms: BTreeSet<String>,
}

#[derive(Default)]
pub struct RolesPage {
    roles: Resource<RolesResponse>,
    draft: Option<RoleDraft>,
    filter: String,
}

fn slugify(s: &str) -> String {
    let mut out = String::new();
    for ch in s.to_lowercase().chars() {
        match ch {
            'a'..='z' | '0'..='9' => out.push(ch),
            'ä' => out.push_str("ae"),
            'ö' => out.push_str("oe"),
            'ü' => out.push_str("ue"),
            'ß' => out.push_str("ss"),
            _ if !out.ends_with('-') && !out.is_empty() => out.push('-'),
            _ => {}
        }
    }
    out.trim_end_matches('-').to_owned()
}

impl RolesPage {
    pub fn ui(&mut self, ui: &mut Ui, sh: &mut Shared) {
        let client = sh.client.clone();
        self.roles.ensure(&sh.ctx, Duration::from_secs(120), sh.epoch(Tag::Roles), || move || client.get::<RolesResponse>("/api/roles"));
        let can_create = sh.user.can("roles.create");
        let can_update = sh.user.can("roles.update");
        let can_delete = sh.user.can("roles.delete");
        let mut create = false;
        w::page_header(ui, "Rollen", Some("Rechte-Bündel für Benutzer"), |ui| {
            if ui.add(Btn::primary("Rolle anlegen").icon(ph::PLUS).enabled(can_create)).clicked() {
                create = true;
            }
        });
        if create {
            self.draft = Some(RoleDraft { id: None, system: false, name: String::new(), slug: String::new(), description: String::new(), perms: BTreeSet::new() });
        }
        let Some(data) = self.roles.data.clone() else {
            match self.roles.error.clone() {
                Some(e) => {
                    if w::error_box(ui, &e) {
                        self.roles.invalidate();
                    }
                }
                None => w::skeleton(ui, 6),
            }
            return;
        };
        if self.draft.is_some() {
            let mut close = false;
            egui::SidePanel::right("role_editor")
                .resizable(true)
                .default_width(560.0)
                .show_separator_line(false)
                .frame(egui::Frame::new().fill(c::BG).inner_margin(egui::Margin { left: 16, right: 0, top: 0, bottom: 0 }))
                .show_inside(ui, |ui| {
                    close = self.editor(ui, sh, &data, can_update || can_create);
                });
            if close {
                self.draft = None;
            }
        }
        let mut edit: Option<RoleDto> = None;
        let mut delete: Option<RoleDto> = None;
        egui::CentralPanel::default().frame(egui::Frame::new()).show_inside(ui, |ui| {
            egui::ScrollArea::vertical().auto_shrink([false, false]).show(ui, |ui| {
                for r in &data.roles {
                    let selected = self.draft.as_ref().and_then(|d| d.id.as_ref()) == Some(&r.id);
                    w::panel_frame()
                        .stroke(egui::Stroke::new(1.0_f32, if selected { theme::tint(c::PINK, 140) } else { c::BORDER }))
                        .show(ui, |ui| {
                            ui.set_min_width(ui.available_width());
                            ui.horizontal(|ui| {
                                ui.label(w::icon_text(ph::SHIELD_CHECK, 20.0, if r.is_system { c::PURPLE } else { c::PINK }));
                                ui.vertical(|ui| {
                                    ui.spacing_mut().item_spacing.y = 2.0;
                                    ui.horizontal(|ui| {
                                        ui.label(w::title(r.name.clone()));
                                        if r.is_system {
                                            w::badge(ui, "System", c::PURPLE);
                                        }
                                    });
                                    ui.label(w::muted(r.description.clone()));
                                    ui.label(w::small(format!("{} Benutzer · {} Rechte", r.count.users, r.permissions.len())));
                                });
                                ui.with_layout(Layout::right_to_left(Align::Center), |ui| {
                                    if !r.is_system && ui.add(Btn::icon_only(ph::TRASH, "Löschen").small().enabled(can_delete && r.count.users == 0)).on_disabled_hover_text("Nur ohne zugewiesene Benutzer").clicked() {
                                        delete = Some(r.clone());
                                    }
                                    let label = if r.is_system || !can_update { "Ansehen" } else { "Bearbeiten" };
                                    if ui.add(Btn::secondary(label).small()).clicked() {
                                        edit = Some(r.clone());
                                    }
                                });
                            });
                        });
                    ui.add_space(10.0);
                }
            });
        });
        if let Some(r) = edit {
            self.draft = Some(RoleDraft { id: Some(r.id.clone()), system: r.is_system, name: r.name.clone(), slug: r.slug.clone(), description: r.description.clone(), perms: r.permissions.iter().cloned().collect() });
        }
        if let Some(r) = delete {
            sh.confirm(format!("Rolle „{}“ löschen?", r.name), "Die Rolle wird entfernt.", "Löschen", true, move |sh| {
                let path = format!("/api/roles/{}", seg(&r.id));
                sh.run("role:delete", format!("{} gelöscht", r.name), &[Tag::Roles], move |c| c.delete::<Value>(&path));
            });
        }
    }

    fn editor(&mut self, ui: &mut Ui, sh: &mut Shared, data: &RolesResponse, can_write: bool) -> bool {
        let Some(d) = &mut self.draft else { return true };
        let editable = can_write && !d.system;
        let mut close = false;
        let mut save = false;
        w::panel_frame().show(ui, |ui| {
            ui.set_min_width(ui.available_width());
            ui.horizontal(|ui| {
                ui.label(RichText::new(if d.id.is_some() { d.name.clone() } else { "Neue Rolle".into() }).font(theme::semibold(17.0)).color(c::TEXT));
                ui.with_layout(Layout::right_to_left(Align::Center), |ui| {
                    if ui.add(Btn::icon_only(ph::X, "Schließen").small()).clicked() {
                        close = true;
                    }
                });
            });
            if d.system {
                ui.add_space(6.0);
                w::callout(ui, ph::LOCK, c::MUTED, "Systemrollen werden beim Serverstart auf ihre Vorgaben zurückgesetzt und sind hier schreibgeschützt.");
            }
            ui.add_space(10.0);
            ui.add_enabled_ui(editable, |ui| {
                w::field(ui, "Name", None, |ui| {
                    if w::text_input(ui, &mut d.name, "Backup-Team", ui.available_width()).changed() && d.id.is_none() {
                        d.slug = slugify(&d.name);
                    }
                });
                if d.id.is_none() {
                    w::field(ui, "Slug", None, |ui| w::text_input(ui, &mut d.slug, "backup-team", ui.available_width()));
                }
                w::field(ui, "Beschreibung", None, |ui| w::text_input(ui, &mut d.description, "", ui.available_width()));
            });
            ui.horizontal(|ui| {
                ui.label(w::label(format!("Rechte ({})", d.perms.len())));
                ui.with_layout(Layout::right_to_left(Align::Center), |ui| {
                    w::search_input(ui, &mut self.filter, "Recht suchen …", 180.0);
                });
            });
            ui.add_space(6.0);
            egui::ScrollArea::vertical().id_salt("perm_scroll").max_height(ui.available_height() - 60.0).auto_shrink([false, false]).show(ui, |ui| {
                let q = self.filter.to_lowercase();
                for g in &data.groups {
                    let items: Vec<_> = data.catalog.iter().filter(|p| p.group == g.id).filter(|p| q.is_empty() || format!("{} {}", p.id, p.de).to_lowercase().contains(&q)).collect();
                    if items.is_empty() {
                        continue;
                    }
                    let granted = items.iter().filter(|p| d.perms.contains(&p.id)).count();
                    ui.add_space(6.0);
                    ui.horizontal(|ui| {
                        ui.label(RichText::new(&g.de).font(theme::semibold(13.0)).color(c::TEXT));
                        ui.label(w::small(format!("{granted}/{}", items.len())));
                        if editable {
                            ui.with_layout(Layout::right_to_left(Align::Center), |ui| {
                                if ui.add(Btn::ghost("keine").small()).clicked() {
                                    for p in &items {
                                        d.perms.remove(&p.id);
                                    }
                                }
                                if ui.add(Btn::ghost("alle").small()).clicked() {
                                    for p in &items {
                                        d.perms.insert(p.id.clone());
                                    }
                                }
                            });
                        }
                    });
                    for p in items {
                        let mut on = d.perms.contains(&p.id);
                        let r = ui.add_enabled(editable, egui::Checkbox::new(&mut on, RichText::new(if p.de.is_empty() { &p.id } else { &p.de }).color(c::TEXT_2)));
                        let r = r.on_hover_text(&p.id);
                        if r.changed() {
                            if on {
                                d.perms.insert(p.id.clone());
                            } else {
                                d.perms.remove(&p.id);
                            }
                        }
                    }
                }
            });
            ui.add_space(10.0);
            if editable {
                ui.horizontal(|ui| {
                    let ok = d.name.trim().len() >= 2 && !d.perms.is_empty() && (d.id.is_some() || d.slug.len() >= 2);
                    save = ui.add(Btn::primary("Speichern").icon(ph::FLOPPY_DISK).enabled(ok)).clicked();
                });
            }
        });
        if save {
            let perms: Vec<String> = d.perms.iter().cloned().collect();
            match &d.id {
                Some(id) => {
                    let path = format!("/api/roles/{}", seg(id));
                    let body = json!({ "name": d.name.trim(), "description": d.description.trim(), "permissions": perms });
                    sh.run("role:save", format!("Rolle {} gespeichert", d.name.trim()), &[Tag::Roles], move |c| c.patch::<Value>(&path, &body));
                }
                None => {
                    let body = json!({ "name": d.name.trim(), "slug": d.slug.trim(), "description": d.description.trim(), "permissions": perms });
                    sh.run("role:create", format!("Rolle {} angelegt", d.name.trim()), &[Tag::Roles], move |c| c.post::<Value>("/api/roles", &body));
                    close = true;
                }
            }
        }
        close
    }
}

#[cfg(test)]
mod tests {
    #[test]
    fn slugify_handles_umlauts() {
        assert_eq!(super::slugify("Büro Team"), "buero-team");
        assert_eq!(super::slugify("  Ops!!"), "ops");
    }
}
