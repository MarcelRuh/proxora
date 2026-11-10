//! Ctrl+K command palette: jump to pages, hosts and guests, run global actions.

use super::nav::{self, NAV};
use super::shared::{Page, Shared};
use crate::net::Kind;
use crate::theme::{self, c, tint};
use crate::ui::widgets::{self as w};
use eframe::egui::{self, Align2, Frame, Key, Margin, RichText, Sense, Stroke, Vec2};
use egui_phosphor::regular as ph;

#[derive(Clone)]
enum Target {
    Page(Page),
    Host(String),
    Guest {
        host_id: String,
        node: String,
        vmid: u64,
        kind: Kind,
    },
    RefreshAll,
    ToggleSidebar,
    CheckAppUpdate,
    Logout,
}

struct Entry {
    icon: &'static str,
    title: String,
    subtitle: String,
    group: &'static str,
    target: Target,
}

#[derive(Default)]
pub struct Palette {
    pub open: bool,
    query: String,
    selected: usize,
    just_opened: bool,
}

impl Palette {
    pub fn toggle(&mut self) {
        self.open = !self.open;
        self.query.clear();
        self.selected = 0;
        self.just_opened = self.open;
    }

    #[cfg(feature = "demo")]
    pub fn demo_open(&mut self, query: &str) {
        self.open = true;
        self.query = query.to_owned();
        self.just_opened = true;
    }

    fn entries(&self, sh: &Shared) -> Vec<Entry> {
        let q = self.query.trim().to_lowercase();
        let matches = |hay: &str| q.is_empty() || fuzzy(&hay.to_lowercase(), &q);
        let mut out = Vec::new();
        for item in NAV.iter().filter(|i| nav::visible(i, &sh.user)) {
            if matches(item.label) {
                out.push(Entry {
                    icon: item.icon,
                    title: item.label.to_owned(),
                    subtitle: "Seite".into(),
                    group: "Seiten",
                    target: Target::Page(item.page),
                });
            }
        }
        if !q.is_empty() {
            if let Some(hosts) = &sh.hosts.data {
                for h in hosts.iter().filter(|h| matches(&format!("{} {}", h.name, h.url))).take(8) {
                    out.push(Entry {
                        icon: ph::DESKTOP_TOWER,
                        title: h.name.clone(),
                        subtitle: h.proxmox_version.clone().map(|v| format!("PVE {v}")).unwrap_or_default(),
                        group: "Hosts",
                        target: Target::Host(h.id.clone()),
                    });
                }
            }
            if let Some(g) = &sh.guests.data {
                let all = g
                    .vms
                    .iter()
                    .map(|x| (x, Kind::Vm))
                    .chain(g.containers.iter().map(|x| (x, Kind::Lxc)));
                for (guest, kind) in all
                    .filter(|(x, _)| {
                        matches(&format!(
                            "{} {} {} {}",
                            x.name,
                            x.vmid,
                            x.host_name.as_deref().unwrap_or(""),
                            x.ips.as_ref().map(|i| i.join(" ")).unwrap_or_default()
                        ))
                    })
                    .take(12)
                {
                    out.push(Entry {
                        icon: if kind == Kind::Vm { ph::MONITOR } else { ph::CUBE },
                        title: format!("{} · {}", guest.vmid, guest.display_name()),
                        subtitle: format!(
                            "{} · {}",
                            kind.label(),
                            guest.host_name.clone().unwrap_or_else(|| guest.node.clone())
                        ),
                        group: "Gäste",
                        target: Target::Guest {
                            host_id: guest.host_id.clone().unwrap_or_default(),
                            node: guest.node.clone(),
                            vmid: guest.vmid,
                            kind,
                        },
                    });
                }
            }
        }
        let actions = [
            (ph::ARROW_CLOCKWISE, "Alles aktualisieren", Target::RefreshAll),
            (ph::SIDEBAR_SIMPLE, "Seitenleiste ein-/ausklappen", Target::ToggleSidebar),
            (ph::CLOUD_ARROW_DOWN, "Nach Desktop-Updates suchen", Target::CheckAppUpdate),
            (ph::SIGN_OUT, "Abmelden", Target::Logout),
        ];
        for (icon, title, target) in actions {
            if matches(title) {
                out.push(Entry {
                    icon,
                    title: title.into(),
                    subtitle: "Aktion".into(),
                    group: "Aktionen",
                    target,
                });
            }
        }
        out
    }

    /// Returns a target-specific action for the workspace to apply.
    pub fn show(&mut self, ctx: &egui::Context, sh: &mut Shared) -> Option<PaletteAction> {
        if !self.open {
            return None;
        }
        let entries = self.entries(sh);
        if self.selected >= entries.len() {
            self.selected = entries.len().saturating_sub(1);
        }
        let mut chosen: Option<Target> = None;
        let (up, down, enter, esc) = ctx.input(|i| {
            (
                i.key_pressed(Key::ArrowUp),
                i.key_pressed(Key::ArrowDown),
                i.key_pressed(Key::Enter),
                i.key_pressed(Key::Escape),
            )
        });
        if down && !entries.is_empty() {
            self.selected = (self.selected + 1) % entries.len();
        }
        if up && !entries.is_empty() {
            self.selected = (self.selected + entries.len() - 1) % entries.len();
        }
        if enter {
            chosen = entries.get(self.selected).map(|e| e.target.clone());
        }

        let screen = ctx.screen_rect();
        let backdrop = egui::Area::new(egui::Id::new("palette_backdrop"))
            .fixed_pos(screen.min)
            .order(egui::Order::Foreground)
            .show(ctx, |ui| {
                let (rect, resp) = ui.allocate_exact_size(screen.size(), Sense::click());
                ui.painter().rect_filled(rect, 0.0, egui::Color32::from_black_alpha(120));
                resp.clicked()
            });
        let mut close = esc || backdrop.inner;

        egui::Area::new(egui::Id::new("palette"))
            .anchor(Align2::CENTER_TOP, Vec2::new(0.0, 84.0))
            .order(egui::Order::Tooltip)
            .show(ctx, |ui| {
                Frame::new()
                    .fill(c::PANEL)
                    .stroke(Stroke::new(1.0_f32, c::BORDER_STRONG))
                    .corner_radius(6)
                    .shadow(ctx.style().visuals.window_shadow)
                    .inner_margin(Margin::same(8))
                    .show(ui, |ui| {
                        ui.set_width(560.0);
                        let r = w::search_input(ui, &mut self.query, "Seiten, Hosts, VMs, Container …", 544.0);
                        if self.just_opened {
                            r.request_focus();
                            self.just_opened = false;
                        }
                        if r.changed() {
                            self.selected = 0;
                        }
                        ui.add_space(6.0);
                        egui::ScrollArea::vertical().max_height(380.0).show(ui, |ui| {
                            let mut last_group = "";
                            if entries.is_empty() {
                                ui.add_space(12.0);
                                ui.vertical_centered(|ui| ui.label(w::muted("Keine Treffer")));
                                ui.add_space(12.0);
                            }
                            for (i, e) in entries.iter().enumerate() {
                                if e.group != last_group {
                                    ui.add_space(4.0);
                                    ui.label(RichText::new(e.group).font(theme::medium(11.0)).color(c::MUTED));
                                    last_group = e.group;
                                }
                                let selected = i == self.selected;
                                let (rect, resp) = ui.allocate_exact_size(
                                    Vec2::new(ui.available_width(), 34.0),
                                    Sense::click(),
                                );
                                if resp.hovered() {
                                    self.selected = i;
                                }
                                if selected {
                                    ui.painter().rect_filled(rect, 4.0, tint(c::PINK, 28));
                                }
                                let icon_color = if selected { c::PINK } else { c::MUTED };
                                ui.painter().text(
                                    rect.left_center() + Vec2::new(14.0, 0.0),
                                    Align2::CENTER_CENTER,
                                    e.icon,
                                    theme::icon_font(16.0),
                                    icon_color,
                                );
                                ui.painter().text(
                                    rect.left_center() + Vec2::new(32.0, 0.0),
                                    Align2::LEFT_CENTER,
                                    &e.title,
                                    theme::medium(13.5),
                                    c::TEXT,
                                );
                                ui.painter().text(
                                    rect.right_center() - Vec2::new(10.0, 0.0),
                                    Align2::RIGHT_CENTER,
                                    &e.subtitle,
                                    theme::regular(12.0),
                                    c::MUTED,
                                );
                                if resp.clicked() {
                                    chosen = Some(e.target.clone());
                                }
                                if selected && (up || down) {
                                    resp.scroll_to_me(None);
                                }
                            }
                        });
                    });
            });

        let action = chosen.map(|t| {
            close = true;
            match t {
                Target::Page(p) => PaletteAction::Go(p),
                Target::Host(id) => {
                    sh.open_host(&id);
                    PaletteAction::None
                }
                Target::Guest { host_id, node, vmid, kind } => {
                    sh.open_guest(&host_id, &node, vmid, kind);
                    PaletteAction::None
                }
                Target::RefreshAll => PaletteAction::RefreshAll,
                Target::ToggleSidebar => PaletteAction::ToggleSidebar,
                Target::CheckAppUpdate => PaletteAction::CheckAppUpdate,
                Target::Logout => PaletteAction::Logout,
            }
        });
        if close {
            self.open = false;
        }
        action
    }
}

pub enum PaletteAction {
    None,
    Go(Page),
    RefreshAll,
    ToggleSidebar,
    CheckAppUpdate,
    Logout,
}

/// Subsequence match ("vmw" matches "vm web-01").
fn fuzzy(hay: &str, needle: &str) -> bool {
    if hay.contains(needle) {
        return true;
    }
    let mut it = hay.chars();
    needle.chars().filter(|c| !c.is_whitespace()).all(|n| it.any(|h| h == n))
}
