use super::chrome;
use super::dialog;
use super::nav::{self, NAV};
use super::palette::{Palette, PaletteAction};
use super::shared::{Page, Shared};
use crate::net::{Client, SessionUser};
use crate::pages;
use crate::prefs::Prefs;
use crate::term::{TermSession, TermState};
use crate::theme::{self, c, tint, SIDEBAR_RAIL_W, SIDEBAR_W, STATUSBAR_H};
use crate::ui::widgets::{self as w, Btn};
use crate::updater::{UpdateCmd, UpdateState, APP_VERSION};
use eframe::egui::{
    self, Align, Align2, Frame, Key, Layout, Margin, Modifiers, Pos2, Rect, RichText, Sense,
    Stroke, Ui, Vec2,
};
use egui_phosphor::regular as ph;
use std::sync::mpsc::Sender;

pub struct Workspace {
    pub sh: Shared,
    page: Page,
    back: Vec<Page>,
    fwd: Vec<Page>,
    palette: Palette,
    tasks_open: bool,
    user_menu: bool,
    p: pages::Pages,
    terms: Vec<TermSession>,
    active_term: usize,
    dock_open: bool,
    next_term_id: u64,
}

impl Workspace {
    pub fn new(
        ctx: &egui::Context,
        client: Client,
        user: SessionUser,
        prefs: Prefs,
        updater: Sender<UpdateCmd>,
        server_version: Option<String>,
    ) -> Self {
        let page = nav::start_page(&user);
        let mut sh = Shared::new(ctx, client, user, prefs, updater);
        sh.server_version = server_version;
        Self {
            sh,
            page,
            back: Vec::new(),
            fwd: Vec::new(),
            palette: Palette::default(),
            tasks_open: false,
            user_menu: false,
            p: pages::Pages::default(),
            terms: Vec::new(),
            active_term: 0,
            dock_open: false,
            next_term_id: 1,
        }
    }

    pub fn set_page(&mut self, page: Page) {
        self.page = page;
    }

    #[cfg(feature = "demo")]
    pub fn open_palette_demo(&mut self, query: &str) {
        self.palette.demo_open(query);
    }

    #[cfg(feature = "demo")]
    pub fn demo_guest_tab_config(&mut self) {
        self.p.demo_config_tab();
    }

    fn navigate(&mut self, page: Page) {
        if page != self.page {
            self.back.push(self.page);
            if self.back.len() > 50 {
                self.back.remove(0);
            }
            self.fwd.clear();
            self.page = page;
        }
    }

    fn go_back(&mut self) {
        if let Some(prev) = self.back.pop() {
            self.fwd.push(self.page);
            self.page = prev;
        }
    }

    fn go_forward(&mut self) {
        if let Some(next) = self.fwd.pop() {
            self.back.push(self.page);
            self.page = next;
        }
    }

    fn shortcuts(&mut self, ctx: &egui::Context) {
        let (palette, refresh, sidebar, back, fwd) = ctx.input_mut(|i| {
            (
                i.consume_key(Modifiers::COMMAND, Key::K),
                i.consume_key(Modifiers::NONE, Key::F5) || i.consume_key(Modifiers::COMMAND, Key::R),
                i.consume_key(Modifiers::COMMAND, Key::B),
                i.consume_key(Modifiers::ALT, Key::ArrowLeft) || i.pointer.button_pressed(egui::PointerButton::Extra1),
                i.consume_key(Modifiers::ALT, Key::ArrowRight) || i.pointer.button_pressed(egui::PointerButton::Extra2),
            )
        });
        if palette {
            self.palette.toggle();
        }
        if refresh {
            self.sh.bump_all();
            self.sh.toasts.info("Aktualisiere alle Daten");
        }
        if sidebar {
            self.sh.prefs.sidebar_collapsed = !self.sh.prefs.sidebar_collapsed;
            self.sh.save_prefs();
        }
        if back {
            self.go_back();
        }
        if fwd {
            self.go_forward();
        }
    }

    pub fn ui(&mut self, ctx: &egui::Context, native_update: &UpdateState) {
        self.sh.native_update = native_update.clone();
        self.sh.poll();
        self.sh.ensure_hosts();
        self.sh.ensure_update_summary();
        self.sh.ensure_self_update();
        let term_focused = self.dock_open && self.terms.iter().any(|t| t.has_focus(ctx));
        if !self.palette.open && self.sh.confirm.is_none() && !term_focused {
            self.shortcuts(ctx);
        }

        for req in std::mem::take(&mut self.sh.term_requests) {
            let session = TermSession::open(ctx, &self.sh.client, self.sh.prefs.allow_insecure_tls, req, self.next_term_id);
            self.next_term_id += 1;
            self.terms.push(session);
            self.active_term = self.terms.len() - 1;
            self.dock_open = true;
        }

        self.title_bar(ctx);
        self.status_bar(ctx);
        if self.dock_open && !self.terms.is_empty() {
            self.terminal_dock(ctx);
        }
        self.sidebar(ctx);

        egui::CentralPanel::default()
            .frame(Frame::new().fill(c::BG).inner_margin(Margin::symmetric(26, 22)))
            .show(ctx, |ui| {
                let page = self.page;
                self.p.show(page, ui, &mut self.sh);
            });

        if let Some(page) = self.sh.nav.take() {
            self.navigate(page);
        }

        if let Some(action) = self.palette.show(ctx, &mut self.sh) {
            match action {
                PaletteAction::Go(p) => self.navigate(p),
                PaletteAction::RefreshAll => self.sh.bump_all(),
                PaletteAction::ToggleSidebar => {
                    self.sh.prefs.sidebar_collapsed = !self.sh.prefs.sidebar_collapsed;
                    self.sh.save_prefs();
                }
                PaletteAction::CheckAppUpdate => {
                    let _ = self.sh.updater.send(UpdateCmd::Check);
                }
                PaletteAction::Logout => self.sh.logout = true,
                PaletteAction::None => {}
            }
            if let Some(page) = self.sh.nav.take() {
                self.navigate(page);
            }
        }
        if self.tasks_open {
            self.tasks_popup(ctx);
        }
        dialog::show_confirm(ctx, &mut self.sh);
        self.sh.toasts.show(ctx);
    }

    // ------------------------------------------------------------ title bar

    fn title_bar(&mut self, ctx: &egui::Context) {
        let mut toggle_sidebar = false;
        let mut back = false;
        let mut fwd = false;
        let mut open_palette = false;
        let mut refresh = false;
        let mut go: Option<Page> = None;
        let can_back = !self.back.is_empty();
        let can_fwd = !self.fwd.is_empty();
        let page = self.page;
        let sh = &self.sh;
        chrome::title_bar(ctx, |ui| {
            ui.add_space(6.0);
            if ui.add(Btn::icon_only(ph::SIDEBAR_SIMPLE, "Seitenleiste (Strg+B)").small()).clicked() {
                toggle_sidebar = true;
            }
            if ui.add(Btn::icon_only(ph::CARET_LEFT, "Zurück (Alt+←)").small().enabled(can_back)).clicked() {
                back = true;
            }
            if ui.add(Btn::icon_only(ph::CARET_RIGHT, "Vor (Alt+→)").small().enabled(can_fwd)).clicked() {
                fwd = true;
            }
            ui.add_space(4.0);
            ui.label(w::icon_text(nav::icon(page), 15.0, c::PINK));
            ui.label(RichText::new(nav::title(page)).font(theme::semibold(13.5)).color(c::TEXT));

            ui.with_layout(Layout::right_to_left(Align::Center), |ui| {
                let busy = sh.hosts.loading() || sh.guests.loading();
                if ui
                    .add(Btn::icon_only(ph::ARROW_CLOCKWISE, "Alles aktualisieren (F5)").small().loading(busy))
                    .clicked()
                {
                    refresh = true;
                }
                if let UpdateState::Available(info) = &sh.native_update {
                    let label = format!("Desktop {}", info.version);
                    if ui
                        .add(Btn::secondary(&label).icon(ph::CLOUD_ARROW_DOWN).small().selected(true))
                        .on_hover_text("Neue Desktop-Version verfügbar — Einstellungen › App")
                        .clicked()
                    {
                        go = Some(Page::Settings);
                    }
                }
                if let Some(su) = &sh.self_update.data {
                    if su.updating {
                        let pct = su.progress.as_ref().map(|p| p.percent).unwrap_or(0);
                        let label = format!("Server-Update {pct} %");
                        if ui.add(Btn::secondary(&label).icon(ph::ROCKET_LAUNCH).small()).clicked() {
                            go = Some(Page::Proxora);
                        }
                    } else if su.update_available {
                        let label = format!(
                            "Proxora {}",
                            su.target_version.clone().unwrap_or_else(|| "Update".into())
                        );
                        if ui
                            .add(Btn::secondary(&label).icon(ph::ROCKET_LAUNCH).small())
                            .on_hover_text("Server-Update verfügbar")
                            .clicked()
                        {
                            go = Some(Page::Proxora);
                        }
                    }
                }
                ui.add_space(6.0);
                // Centered-ish search trigger.
                let width = (ui.available_width() - 40.0).clamp(180.0, 360.0);
                let (rect, resp) = ui.allocate_exact_size(Vec2::new(width, 28.0), Sense::click());
                let hovered = resp.hovered();
                ui.painter().rect(
                    rect,
                    4.0,
                    if hovered { c::HOVER } else { c::INPUT },
                    Stroke::new(1.0_f32, if hovered { c::BORDER_STRONG } else { c::BORDER }),
                    egui::StrokeKind::Inside,
                );
                ui.painter().text(
                    rect.left_center() + Vec2::new(12.0, 0.0),
                    Align2::LEFT_CENTER,
                    ph::MAGNIFYING_GLASS,
                    theme::icon_font(14.0),
                    c::MUTED,
                );
                ui.painter().text(
                    rect.left_center() + Vec2::new(32.0, 0.0),
                    Align2::LEFT_CENTER,
                    "Suchen oder springen …",
                    theme::regular(12.5),
                    c::MUTED,
                );
                let kbd = Rect::from_min_size(rect.right_center() - Vec2::new(52.0, 9.0), Vec2::new(44.0, 18.0));
                ui.painter().rect_filled(kbd, 3.0, c::RAISED);
                ui.painter().text(
                    kbd.center(),
                    Align2::CENTER_CENTER,
                    "Strg K",
                    theme::medium(10.5),
                    c::TEXT_2,
                );
                if resp.clicked() {
                    open_palette = true;
                }
            });
        });
        if toggle_sidebar {
            self.sh.prefs.sidebar_collapsed = !self.sh.prefs.sidebar_collapsed;
            self.sh.save_prefs();
        }
        if back {
            self.go_back();
        }
        if fwd {
            self.go_forward();
        }
        if open_palette {
            self.palette.toggle();
        }
        if refresh {
            self.sh.bump_all();
        }
        if let Some(p) = go {
            self.navigate(p);
        }
    }

    // ------------------------------------------------------------ sidebar

    fn sidebar(&mut self, ctx: &egui::Context) {
        let collapsed = self.sh.prefs.sidebar_collapsed;
        let width = if collapsed { SIDEBAR_RAIL_W } else { SIDEBAR_W };
        let mut go: Option<Page> = None;
        let mut logout = false;
        let mut toggle_menu = false;
        let current = self.page;
        let updates = self
            .sh
            .update_summary
            .data
            .as_ref()
            .map(|s| s.total)
            .unwrap_or(0);
        let running_guests = self.sh.guests.data.as_ref().map(|g| {
            (
                g.vms.iter().filter(|x| x.running()).count(),
                g.containers.iter().filter(|x| x.running()).count(),
            )
        });
        let running_tasks = self.sh.running_tasks();
        let user = &self.sh.user;

        egui::SidePanel::left("proxora_sidebar")
            .exact_width(width)
            .resizable(false)
            .show_separator_line(false)
            .frame(Frame::new().fill(c::CHROME).inner_margin(Margin::symmetric(10, 14)))
            .show(ctx, |ui| {
                let full = ui.max_rect().expand2(Vec2::new(10.0, 14.0));
                ui.painter()
                    .vline(full.right() - 0.5, full.y_range(), Stroke::new(1.0_f32, c::BORDER));

                ui.horizontal(|ui| {
                    ui.add_space(if collapsed { 6.0 } else { 4.0 });
                    if collapsed {
                        ui.add(
                            egui::Image::new(egui::include_image!("../../assets/proxora-icon.png"))
                                .fit_to_exact_size(Vec2::splat(28.0))
                                .corner_radius(4.0),
                        );
                    } else {
                        chrome::brand(ui, 28.0);
                    }
                });
                ui.add_space(16.0);

                egui::ScrollArea::vertical()
                    .auto_shrink([false, false])
                    .max_height(ui.available_height() - 64.0)
                    .show(ui, |ui| {
                        let mut group = "";
                        for item in NAV.iter().filter(|i| nav::visible(i, user)) {
                            if item.group != group {
                                if !group.is_empty() {
                                    ui.add_space(10.0);
                                }
                                group = item.group;
                                if !collapsed {
                                    ui.horizontal(|ui| {
                                        ui.add_space(10.0);
                                        ui.label(
                                            RichText::new(item.group)
                                                .font(theme::medium(11.0))
                                                .color(c::FAINT),
                                        );
                                    });
                                    ui.add_space(2.0);
                                }
                            }
                            let badge = match item.page {
                                Page::Updates if updates > 0 => Some((updates.to_string(), c::WARN)),
                                Page::Vms => running_guests.map(|(v, _)| (v.to_string(), c::MUTED)),
                                Page::Containers => running_guests.map(|(_, l)| (l.to_string(), c::MUTED)),
                                Page::Tasks if running_tasks > 0 => Some((running_tasks.to_string(), c::CYAN)),
                                _ => None,
                            };
                            let active = current == item.page
                                || (item.page == Page::Vms && current == Page::CreateVm)
                                || (item.page == Page::Containers && current == Page::CreateLxc);
                            if nav_button(ui, item.icon, item.label, active, collapsed, badge).clicked() {
                                go = Some(item.page);
                            }
                        }
                    });

                // Footer: user chip
                ui.with_layout(Layout::bottom_up(Align::Min), |ui| {
                    let initials: String = user
                        .username
                        .chars()
                        .filter(|c| c.is_alphanumeric())
                        .take(2)
                        .collect::<String>()
                        .to_uppercase();
                    let (rect, resp) = ui.allocate_exact_size(Vec2::new(ui.available_width(), 48.0), Sense::click());
                    if resp.hovered() || self.user_menu {
                        ui.painter().rect_filled(rect, 4.0, c::HOVER);
                    }
                    let avatar = Pos2::new(rect.left() + 22.0, rect.center().y);
                    ui.painter().circle_filled(avatar, 15.0, tint(c::PURPLE, 70));
                    ui.painter().text(avatar, Align2::CENTER_CENTER, &initials, theme::semibold(12.0), c::TEXT);
                    if !collapsed {
                        ui.painter().text(
                            Pos2::new(rect.left() + 46.0, rect.center().y - 8.0),
                            Align2::LEFT_CENTER,
                            &user.username,
                            theme::medium(13.0),
                            c::TEXT,
                        );
                        ui.painter().text(
                            Pos2::new(rect.left() + 46.0, rect.center().y + 9.0),
                            Align2::LEFT_CENTER,
                            &user.role.name,
                            theme::regular(11.5),
                            c::MUTED,
                        );
                        ui.painter().text(
                            Pos2::new(rect.right() - 12.0, rect.center().y),
                            Align2::RIGHT_CENTER,
                            ph::DOTS_THREE_VERTICAL,
                            theme::icon_font(16.0),
                            c::MUTED,
                        );
                    }
                    if resp.clicked() {
                        toggle_menu = true;
                    }
                    let resp = resp.on_hover_text(format!("{} · {}", user.username, user.role.name));
                    if self.user_menu {
                        let menu_pos = Pos2::new(rect.left(), rect.top() - 6.0);
                        egui::Area::new(egui::Id::new("user_menu"))
                            .fixed_pos(menu_pos)
                            .pivot(Align2::LEFT_BOTTOM)
                            .order(egui::Order::Foreground)
                            .show(ctx, |ui| {
                                Frame::popup(ui.style()).show(ui, |ui| {
                                    ui.set_width(200.0);
                                    if ui.add(Btn::ghost("Konto & Sicherheit").icon(ph::USER_CIRCLE).fill_width()).clicked() {
                                        go = Some(Page::Settings);
                                        toggle_menu = true;
                                    }
                                    if ui.add(Btn::ghost("Abmelden").icon(ph::SIGN_OUT).fill_width()).clicked() {
                                        logout = true;
                                    }
                                });
                            });
                        if ctx.input(|i| i.pointer.any_pressed()) && !resp.hovered() {
                            let over_menu = ctx
                                .layer_id_at(ctx.input(|i| i.pointer.interact_pos().unwrap_or_default()))
                                .is_some_and(|l| l.id == egui::Id::new("user_menu"));
                            if !over_menu {
                                self.user_menu = false;
                            }
                        }
                    }
                });
            });
        if toggle_menu {
            self.user_menu = !self.user_menu;
        }
        if logout {
            self.sh.logout = true;
        }
        if let Some(p) = go {
            self.navigate(p);
        }
    }

    // ------------------------------------------------------------ status bar

    fn status_bar(&mut self, ctx: &egui::Context) {
        let sh = &self.sh;
        let mut toggle_tasks = false;
        let mut toggle_dock = false;
        let terms_empty = self.terms.is_empty();
        let term_live = self.terms.iter().filter(|t| t.state == TermState::Connected).count();
        chrome::status_bar(ctx, |ui| {
            let offline = sh
                .hosts
                .error
                .as_ref()
                .is_some_and(|e| e.status.is_none());
            let (dot, text) = if offline {
                (c::DANGER, format!("Getrennt · {}", sh.client.host_label()))
            } else {
                (c::OK, format!("Verbunden · {}", sh.client.host_label()))
            };
            chrome::status_item(ui, ph::CIRCLE, &text, dot);
            let running = sh.running_tasks();
            let label = if running > 0 {
                format!("{running} Aufgabe{} läuft", if running == 1 { "" } else { "n" })
            } else if !sh.tasks.is_empty() {
                format!("{} Aufgaben fertig", sh.tasks.len())
            } else {
                "Keine laufenden Aufgaben".into()
            };
            let icon = if running > 0 { ph::CIRCLE_NOTCH } else { ph::LIST_CHECKS };
            let color = if running > 0 { c::CYAN } else { c::MUTED };
            if chrome::status_item(ui, icon, &label, color).clicked() {
                toggle_tasks = true;
            }
            if !terms_empty {
                let live = term_live;
                let text = format!("Terminal ({live})");
                if chrome::status_item(ui, ph::TERMINAL_WINDOW, &text, if live > 0 { c::OK } else { c::MUTED }).clicked() {
                    toggle_dock = true;
                }
            }
            ui.with_layout(Layout::right_to_left(Align::Center), |ui| {
                ui.label(RichText::new(format!("Desktop {APP_VERSION}")).font(theme::regular(11.5)).color(c::MUTED));
                if let Some(v) = &sh.server_version {
                    ui.label(RichText::new(format!("Proxora {v}")).font(theme::regular(11.5)).color(c::MUTED));
                }
                if let Some(age) = sh.hosts.age() {
                    let secs = age.as_secs();
                    let text = if secs < 5 { "gerade aktualisiert".to_owned() } else { format!("vor {secs} s aktualisiert") };
                    ui.label(RichText::new(text).font(theme::regular(11.5)).color(c::FAINT));
                }
            });
        });
        if toggle_tasks {
            self.tasks_open = !self.tasks_open;
        }
        if toggle_dock {
            self.dock_open = !self.dock_open;
        }
    }

    fn terminal_dock(&mut self, ctx: &egui::Context) {
        let mut close: Option<usize> = None;
        let mut hide = false;
        egui::TopBottomPanel::bottom("terminal_dock")
            .resizable(true)
            .default_height(340.0)
            .height_range(180.0..=900.0)
            .show_separator_line(false)
            .frame(Frame::new().fill(c::CHROME).inner_margin(Margin::symmetric(10, 8)))
            .show(ctx, |ui| {
                let full = ui.max_rect().expand2(Vec2::new(10.0, 8.0));
                ui.painter().hline(full.x_range(), full.top() + 0.5, Stroke::new(1.0_f32, c::BORDER));
                ui.horizontal(|ui| {
                    ui.spacing_mut().item_spacing.x = 4.0;
                    for (i, t) in self.terms.iter().enumerate() {
                        let active = i == self.active_term;
                        let dot = match &t.state {
                            TermState::Connected => c::OK,
                            TermState::Connecting => c::WARN,
                            TermState::Closed(_) => c::FAINT,
                        };
                        let g = ui.fonts(|f| f.layout_no_wrap(t.req.title.clone(), theme::medium(12.5), c::TEXT));
                        let size = Vec2::new(g.size().x + 54.0, 28.0);
                        let (rect, resp) = ui.allocate_exact_size(size, Sense::click());
                        let bg = if active { c::PANEL } else if resp.hovered() { c::HOVER } else { egui::Color32::TRANSPARENT };
                        ui.painter().rect_filled(rect, 4.0, bg);
                        ui.painter().circle_filled(Pos2::new(rect.left() + 12.0, rect.center().y), 3.5, dot);
                        ui.painter().galley(Pos2::new(rect.left() + 22.0, rect.center().y - g.size().y / 2.0), g, if active { c::TEXT } else { c::TEXT_2 });
                        let x_rect = Rect::from_center_size(Pos2::new(rect.right() - 14.0, rect.center().y), Vec2::splat(18.0));
                        let x_resp = ui.interact(x_rect, resp.id.with("close"), Sense::click());
                        ui.painter().text(x_rect.center(), Align2::CENTER_CENTER, ph::X, theme::icon_font(12.0), if x_resp.hovered() { c::TEXT } else { c::MUTED });
                        if x_resp.clicked() {
                            close = Some(i);
                        } else if resp.clicked() {
                            self.active_term = i;
                        }
                    }
                    ui.with_layout(Layout::right_to_left(Align::Center), |ui| {
                        if ui.add(Btn::icon_only(ph::CARET_DOWN, "Terminal ausblenden").small()).clicked() {
                            hide = true;
                        }
                        if let Some(t) = self.terms.get_mut(self.active_term) {
                            if ui.add(Btn::icon_only(ph::PLUS, "Schrift größer").small()).clicked() {
                                t.zoom(1.0);
                            }
                            if ui.add(Btn::icon_only(ph::MINUS, "Schrift kleiner").small()).clicked() {
                                t.zoom(-1.0);
                            }
                            if ui.add(Btn::icon_only(ph::COPY, "Bildschirminhalt kopieren").small()).clicked() {
                                ctx.copy_text(t.screen_text());
                            }
                            if matches!(t.state, TermState::Closed(_)) && ui.add(Btn::secondary("Neu verbinden").icon(ph::ARROW_CLOCKWISE).small()).clicked() {
                                let mut req = t.req.clone();
                                req.initial_input = None;
                                self.sh.term_requests.push(req);
                                close = Some(self.active_term);
                            }
                        }
                    });
                });
                ui.add_space(6.0);
                if let Some(t) = self.terms.get_mut(self.active_term) {
                    t.ui(ui);
                }
            });
        if let Some(i) = close {
            let mut t = self.terms.remove(i);
            t.close();
            if self.active_term >= self.terms.len() {
                self.active_term = self.terms.len().saturating_sub(1);
            }
            if self.terms.is_empty() {
                self.dock_open = false;
            }
        }
        if hide {
            self.dock_open = false;
        }
    }

    fn tasks_popup(&mut self, ctx: &egui::Context) {
        let mut close = false;
        let mut open_tasks = false;
        let left = if self.sh.prefs.sidebar_collapsed { SIDEBAR_RAIL_W } else { SIDEBAR_W };
        egui::Area::new(egui::Id::new("tasks_popup"))
            .anchor(Align2::LEFT_BOTTOM, Vec2::new(left + 12.0, -(STATUSBAR_H + 8.0)))
            .order(egui::Order::Foreground)
            .show(ctx, |ui| {
                Frame::popup(ui.style()).inner_margin(Margin::same(12)).show(ui, |ui| {
                    ui.set_width(380.0);
                    ui.horizontal(|ui| {
                        ui.label(w::title("Aufgaben dieser Sitzung"));
                        ui.with_layout(Layout::right_to_left(Align::Center), |ui| {
                            if ui.add(Btn::icon_only(ph::X, "Schließen").small()).clicked() {
                                close = true;
                            }
                        });
                    });
                    ui.add_space(6.0);
                    let busy = self.sh.busy_labels();
                    if busy.is_empty() && self.sh.tasks.is_empty() {
                        ui.label(w::muted("Noch nichts gestartet. Aktionen wie Start, Backup oder Klonen erscheinen hier mit Fortschritt."));
                    }
                    for label in busy {
                        ui.horizontal(|ui| {
                            ui.spinner();
                            ui.label(w::secondary(label));
                        });
                    }
                    for t in self.sh.tasks.iter().rev() {
                        ui.add_space(4.0);
                        ui.horizontal(|ui| {
                            let (icon, color) = if t.running() {
                                (ph::CIRCLE_NOTCH, c::CYAN)
                            } else if t.ok {
                                (ph::CHECK_CIRCLE, c::OK)
                            } else {
                                (ph::WARNING_CIRCLE, c::DANGER)
                            };
                            ui.label(w::icon_text(icon, 15.0, color));
                            ui.label(w::strong(t.label.clone()));
                            ui.with_layout(Layout::right_to_left(Align::Center), |ui| {
                                ui.label(w::small(format!("{} s", t.started.elapsed().as_secs())));
                            });
                        });
                        if t.running() {
                            let frac = t.progress().unwrap_or(0.08);
                            w::meter(ui, frac, ui.available_width(), 4.0);
                        }
                        if let Some(line) = t.error.as_deref().or(t.last_line()) {
                            ui.add(egui::Label::new(w::small(line.to_owned())).truncate());
                        }
                    }
                    ui.add_space(8.0);
                    if self.sh.user.can("tasks.view") && ui.add(Btn::ghost("Alle Proxmox-Aufgaben").icon(ph::LIST_CHECKS).small()).clicked() {
                        open_tasks = true;
                    }
                });
            });
        if close || ctx.input(|i| i.key_pressed(Key::Escape)) {
            self.tasks_open = false;
        }
        if open_tasks {
            self.tasks_open = false;
            self.navigate(Page::Tasks);
        }
    }
}

fn nav_button(
    ui: &mut Ui,
    icon: &str,
    label: &str,
    active: bool,
    collapsed: bool,
    badge: Option<(String, egui::Color32)>,
) -> egui::Response {
    let (rect, resp) = ui.allocate_exact_size(Vec2::new(ui.available_width(), 32.0), Sense::click());
    let hovered = resp.hovered();
    let t = ui.ctx().animate_bool_with_time(resp.id.with("h"), hovered || active, 0.12);
    let bg = if active {
        tint(c::PINK, 26)
    } else {
        egui::Color32::TRANSPARENT.lerp_to_gamma(c::HOVER, t)
    };
    ui.painter().rect_filled(rect, 4.0, bg);
    if active {
        ui.painter().rect_filled(
            Rect::from_min_size(rect.left_top() + Vec2::new(0.0, 7.0), Vec2::new(3.0, rect.height() - 14.0)),
            1.5,
            c::PINK,
        );
    }
    let icon_color = if active { c::PINK } else if hovered { c::TEXT } else { c::MUTED };
    let icon_x = if collapsed { rect.center().x } else { rect.left() + 22.0 };
    ui.painter().text(
        Pos2::new(icon_x, rect.center().y),
        Align2::CENTER_CENTER,
        icon,
        theme::icon_font(17.0),
        icon_color,
    );
    if !collapsed {
        ui.painter().text(
            Pos2::new(rect.left() + 42.0, rect.center().y),
            Align2::LEFT_CENTER,
            label,
            theme::medium(13.0),
            if active { c::TEXT } else { c::TEXT_2 },
        );
        if let Some((text, color)) = &badge {
            let g = ui.fonts(|f| f.layout_no_wrap(text.clone(), theme::medium(11.0), *color));
            let pill = Rect::from_min_size(
                Pos2::new(rect.right() - g.size().x - 18.0, rect.center().y - 9.0),
                Vec2::new(g.size().x + 12.0, 18.0),
            );
            ui.painter().rect_filled(pill, 9.0, tint(*color, 34));
            ui.painter().galley(pill.center() - g.size() / 2.0, g, *color);
        }
    } else if let Some((_, color)) = &badge {
        ui.painter().circle_filled(rect.right_top() + Vec2::new(-12.0, 9.0), 3.0, *color);
    }
    if collapsed {
        resp.on_hover_text(label)
    } else {
        resp
    }
}
