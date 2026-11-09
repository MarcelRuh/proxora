use crate::api::{Dashboard, DashboardGuests, PublicHost, ProxoraClient, SessionUser};
use crate::prefs::{self, Prefs};
use crate::theme::{self, c, SIDEBAR_W, TITLEBAR_H};
use crate::updater::{self, UpdateCmd, UpdateMsg, UpdateState, APP_VERSION};
use eframe::egui::{
    self, Align, Align2, Color32, CornerRadius, FontId, Frame, Layout, Margin, Pos2, Rect,
    RichText, Sense, Shadow, Stroke, Ui, Vec2,
};
use std::sync::mpsc::{self, Receiver, Sender};
use std::thread;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Screen {
    Setup,
    Login,
    Totp,
    Home,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum HomeTab {
    Overview,
    Hosts,
    Guests,
}

enum WorkerMsg {
    HealthOk { version: String },
    HealthErr(String),
    LoginOk(SessionUser),
    LoginTotp { ticket: String },
    LoginErr(String),
    RefreshOk {
        dashboard: Dashboard,
        hosts: Vec<PublicHost>,
        guests: DashboardGuests,
    },
    RefreshErr(String),
    ActionOk(String),
    ActionErr(String),
    LoggedOut,
}

struct Job {
    client: ProxoraClient,
    kind: JobKind,
}

enum JobKind {
    Probe,
    Login { username: String, password: String },
    Totp { ticket: String, code: String },
    Refresh,
    Action {
        guest_kind: String,
        host_id: String,
        node: String,
        vmid: u32,
        action: String,
    },
    Logout,
}

pub struct ProxoraApp {
    prefs: Prefs,
    screen: Screen,
    tab: HomeTab,
    client: Option<ProxoraClient>,
    user: Option<SessionUser>,
    totp_ticket: Option<String>,
    username: String,
    password: String,
    totp_code: String,
    status: String,
    busy: bool,
    dashboard: Option<Dashboard>,
    hosts: Vec<PublicHost>,
    guests: Option<DashboardGuests>,
    guest_filter: String,
    rx: Receiver<WorkerMsg>,
    job_tx: Sender<Job>,
    update_state: UpdateState,
    update_cmd: Sender<UpdateCmd>,
    update_rx: Receiver<UpdateMsg>,
}

impl ProxoraApp {
    pub fn new(cc: &eframe::CreationContext<'_>) -> Self {
        theme::apply(&cc.egui_ctx);
        let prefs = prefs::load();
        let (msg_tx, rx) = mpsc::channel();
        let (job_tx, job_rx) = mpsc::channel::<Job>();
        thread::Builder::new()
            .name("proxora-api".into())
            .spawn(move || worker_loop(job_rx, msg_tx))
            .expect("api worker");

        let (update_cmd, update_rx) = updater::spawn();
        let _ = update_cmd.send(UpdateCmd::Check);

        let mut app = Self {
            username: prefs.last_username.clone(),
            password: String::new(),
            totp_code: String::new(),
            screen: if prefs.server_url.trim().is_empty() {
                Screen::Setup
            } else {
                Screen::Login
            },
            tab: HomeTab::Overview,
            client: None,
            user: None,
            totp_ticket: None,
            status: String::new(),
            busy: false,
            dashboard: None,
            hosts: Vec::new(),
            guests: None,
            guest_filter: String::new(),
            prefs,
            rx,
            job_tx,
            update_state: UpdateState::Checking,
            update_cmd,
            update_rx,
        };
        if !app.prefs.server_url.trim().is_empty() {
            app.rebuild_client();
            app.enqueue(JobKind::Probe);
        }
        app
    }

    fn rebuild_client(&mut self) {
        match ProxoraClient::new(&self.prefs.server_url, self.prefs.allow_insecure_tls) {
            Ok(client) => self.client = Some(client),
            Err(err) => {
                self.client = None;
                self.status = err.to_string();
            }
        }
    }

    fn enqueue(&mut self, kind: JobKind) {
        if self.client.is_none() {
            self.rebuild_client();
        }
        let Some(client) = self.client.clone() else {
            self.status = "Kein gültiger Server".into();
            return;
        };
        self.busy = true;
        let _ = self.job_tx.send(Job { client, kind });
    }

    fn poll_worker(&mut self) {
        while let Ok(msg) = self.rx.try_recv() {
            self.busy = false;
            match msg {
                WorkerMsg::HealthOk { version } => {
                    self.status = format!("Server erreichbar · Proxora {version}");
                }
                WorkerMsg::HealthErr(err) => self.status = err,
                WorkerMsg::LoginOk(user) => {
                    self.prefs.last_username = user.username.clone();
                    let _ = prefs::save(&self.prefs);
                    self.user = Some(user);
                    self.password.clear();
                    self.totp_code.clear();
                    self.totp_ticket = None;
                    self.screen = Screen::Home;
                    self.status = "Angemeldet".into();
                    self.enqueue(JobKind::Refresh);
                }
                WorkerMsg::LoginTotp { ticket } => {
                    self.totp_ticket = Some(ticket);
                    self.screen = Screen::Totp;
                    self.status = "2FA-Code erforderlich".into();
                }
                WorkerMsg::LoginErr(err) => self.status = err,
                WorkerMsg::RefreshOk {
                    dashboard,
                    hosts,
                    guests,
                } => {
                    self.dashboard = Some(dashboard);
                    self.hosts = hosts;
                    self.guests = Some(guests);
                    self.status = format!("Aktualisiert · {}", chrono_now());
                }
                WorkerMsg::RefreshErr(err) => self.status = err,
                WorkerMsg::ActionOk(msg) => {
                    self.status = msg;
                    self.enqueue(JobKind::Refresh);
                }
                WorkerMsg::ActionErr(err) => self.status = err,
                WorkerMsg::LoggedOut => {
                    self.user = None;
                    self.dashboard = None;
                    self.hosts.clear();
                    self.guests = None;
                    self.screen = Screen::Login;
                    self.status = "Abgemeldet".into();
                }
            }
        }

        while let Ok(UpdateMsg::State(state)) = self.update_rx.try_recv() {
            self.update_state = state;
        }
    }

    fn title_bar(&mut self, ui: &mut Ui, ctx: &egui::Context) {
        let full = ui.max_rect();
        let bar = Rect::from_min_size(full.min, Vec2::new(full.width(), TITLEBAR_H));
        ui.painter()
            .rect_filled(bar, CornerRadius::ZERO, c::TITLEBAR);
        ui.painter().hline(
            bar.x_range(),
            bar.bottom() - 0.5,
            Stroke::new(1.0_f32, c::BORDER_SOFT),
        );

        // Accent stripe
        ui.painter().rect_filled(
            Rect::from_min_max(
                Pos2::new(bar.left(), bar.bottom() - 2.0),
                Pos2::new(bar.left() + 72.0, bar.bottom()),
            ),
            CornerRadius::ZERO,
            c::ACCENT,
        );

        let response = ui.interact(
            bar.with_max_x(bar.right() - 120.0),
            ui.id().with("title_drag"),
            Sense::click_and_drag(),
        );
        if response.double_clicked() {
            let maximized = ctx.input(|i| {
                i.viewport().maximized.unwrap_or(false)
            });
            ctx.send_viewport_cmd(egui::ViewportCommand::Maximized(!maximized));
        } else if response.drag_started_by(egui::PointerButton::Primary) {
            ctx.send_viewport_cmd(egui::ViewportCommand::StartDrag);
        }

        ui.scope_builder(
            egui::UiBuilder::new().max_rect(bar).layout(Layout::left_to_right(Align::Center)),
            |ui| {
                ui.add_space(14.0);
                ui.label(
                    RichText::new("PROXORA")
                        .font(FontId::proportional(15.0))
                        .color(c::ACCENT)
                        .strong(),
                );
                ui.label(
                    RichText::new("NATIVE")
                        .font(FontId::proportional(11.0))
                        .color(c::FAINT),
                );
                ui.add_space(8.0);
                ui.label(
                    RichText::new(format!("v{APP_VERSION}"))
                        .font(FontId::monospace(11.0))
                        .color(c::FAINT),
                );

                ui.with_layout(Layout::right_to_left(Align::Center), |ui| {
                    ui.add_space(6.0);
                    title_btn(ui, ctx, "✕", TitleAction::Close, c::DANGER);
                    title_btn(ui, ctx, "□", TitleAction::Maximize, c::MUTED);
                    title_btn(ui, ctx, "—", TitleAction::Minimize, c::MUTED);
                    ui.add_space(8.0);
                    if self.busy {
                        ui.spinner();
                        ui.add_space(6.0);
                    }
                    if !self.status.is_empty() {
                        ui.label(
                            RichText::new(&self.status)
                                .font(FontId::proportional(11.5))
                                .color(c::MUTED),
                        );
                    }
                });
            },
        );

        ui.allocate_rect(bar, Sense::hover());
    }

    fn sidebar(&mut self, ui: &mut Ui) {
        let height = ui.available_height();
        Frame::new()
            .fill(c::BG_ELEV)
            .stroke(Stroke::new(1.0_f32, c::BORDER_SOFT))
            .inner_margin(Margin::symmetric(12, 16))
            .show(ui, |ui| {
                ui.set_min_width(SIDEBAR_W - 1.0);
                ui.set_min_height(height);

                ui.label(
                    RichText::new("NAVIGATION")
                        .font(FontId::proportional(10.5))
                        .color(c::FAINT),
                );
                ui.add_space(8.0);

                if self.screen == Screen::Home {
                    nav_item(ui, &mut self.tab, HomeTab::Overview, "Übersicht", "Cluster & Ressourcen");
                    nav_item(ui, &mut self.tab, HomeTab::Hosts, "Hosts", "Proxmox-Knoten");
                    nav_item(ui, &mut self.tab, HomeTab::Guests, "Gäste", "VMs & Container");
                    ui.add_space(16.0);
                    ui.separator();
                    ui.add_space(10.0);
                    if ui.add(ghost_btn("Aktualisieren")).clicked() {
                        self.enqueue(JobKind::Refresh);
                    }
                    ui.add_space(4.0);
                    if ui.add(ghost_btn("Abmelden")).clicked() {
                        self.enqueue(JobKind::Logout);
                    }
                } else {
                    ui.label(
                        RichText::new("Anmeldung")
                            .color(c::MUTED)
                            .size(13.0),
                    );
                    ui.add_space(6.0);
                    if !self.prefs.server_url.is_empty() {
                        ui.label(
                            RichText::new(&self.prefs.server_url)
                                .font(FontId::monospace(11.0))
                                .color(c::FAINT),
                        );
                    }
                }

                ui.with_layout(Layout::bottom_up(Align::LEFT), |ui| {
                    ui.add_space(8.0);
                    if let Some(user) = &self.user {
                        Frame::new()
                            .fill(c::PANEL)
                            .stroke(Stroke::new(1.0_f32, c::BORDER))
                            .corner_radius(CornerRadius::same(6))
                            .inner_margin(10.0)
                            .show(ui, |ui| {
                                ui.label(
                                    RichText::new(&user.username)
                                        .strong()
                                        .size(13.0)
                                        .color(c::TEXT),
                                );
                                ui.label(
                                    RichText::new(&user.role.name)
                                        .size(11.5)
                                        .color(c::ACCENT),
                                );
                            });
                    } else {
                        ui.label(
                            RichText::new("Nicht angemeldet")
                                .size(12.0)
                                .color(c::FAINT),
                        );
                    }
                    ui.add_space(8.0);
                    if ui
                        .add(
                            egui::Button::new(
                                RichText::new("Nach Updates suchen")
                                    .size(12.0)
                                    .color(c::MUTED),
                            )
                            .fill(Color32::TRANSPARENT)
                            .stroke(Stroke::NONE),
                        )
                        .clicked()
                    {
                        let _ = self.update_cmd.send(UpdateCmd::Check);
                        self.update_state = UpdateState::Checking;
                    }
                });
            });
    }
}

enum TitleAction {
    Minimize,
    Maximize,
    Close,
}

fn title_btn(ui: &mut Ui, ctx: &egui::Context, label: &str, action: TitleAction, hover: Color32) {
    let size = Vec2::new(36.0, TITLEBAR_H);
    let (rect, resp) = ui.allocate_exact_size(size, Sense::click());
    let bg = if resp.hovered() {
        match action {
            TitleAction::Close => Color32::from_rgb(180, 40, 40),
            _ => Color32::from_rgb(28, 34, 44),
        }
    } else {
        Color32::TRANSPARENT
    };
    ui.painter().rect_filled(rect, CornerRadius::ZERO, bg);
    let color = if resp.hovered() {
        Color32::WHITE
    } else {
        hover
    };
    ui.painter().text(
        rect.center(),
        Align2::CENTER_CENTER,
        label,
        FontId::proportional(13.0),
        color,
    );
    if resp.clicked() {
        match action {
            TitleAction::Minimize => {
                ctx.send_viewport_cmd(egui::ViewportCommand::Minimized(true));
            }
            TitleAction::Maximize => {
                let maximized = ctx.input(|i| i.viewport().maximized.unwrap_or(false));
                ctx.send_viewport_cmd(egui::ViewportCommand::Maximized(!maximized));
            }
            TitleAction::Close => {
                ctx.send_viewport_cmd(egui::ViewportCommand::Close);
            }
        }
    }
}

fn nav_item(ui: &mut Ui, current: &mut HomeTab, tab: HomeTab, title: &str, subtitle: &str) {
    let selected = *current == tab;
    let fill = if selected {
        Color32::from_rgba_unmultiplied(46, 230, 166, 22)
    } else {
        Color32::TRANSPARENT
    };
    let stroke = if selected {
        Stroke::new(1.0_f32, c::ACCENT_DIM)
    } else {
        Stroke::NONE
    };
    let resp = Frame::new()
        .fill(fill)
        .stroke(stroke)
        .corner_radius(CornerRadius::same(6))
        .inner_margin(Margin::symmetric(10, 8))
        .show(ui, |ui| {
            ui.set_min_width(ui.available_width());
            ui.horizontal(|ui| {
                if selected {
                    let (r, _) = ui.allocate_exact_size(Vec2::new(3.0, 28.0), Sense::hover());
                    ui.painter()
                        .rect_filled(r, CornerRadius::same(2), c::ACCENT);
                    ui.add_space(6.0);
                } else {
                    ui.add_space(9.0);
                }
                ui.vertical(|ui| {
                    ui.label(
                        RichText::new(title)
                            .size(13.5)
                            .color(if selected { c::ACCENT } else { c::TEXT })
                            .strong(),
                    );
                    ui.label(RichText::new(subtitle).size(11.0).color(c::FAINT));
                });
            });
        })
        .response
        .interact(Sense::click());
    if resp.hovered() && !selected {
        ui.painter().rect_filled(
            resp.rect,
            CornerRadius::same(6),
            Color32::from_rgba_unmultiplied(255, 255, 255, 6),
        );
    }
    if resp.clicked() {
        *current = tab;
    }
    ui.add_space(4.0);
}

fn primary_btn(label: &str) -> egui::Button<'static> {
    egui::Button::new(RichText::new(label).color(c::BG).strong())
        .fill(c::ACCENT)
        .stroke(Stroke::NONE)
        .corner_radius(CornerRadius::same(5))
}

fn ghost_btn(label: &str) -> egui::Button<'static> {
    egui::Button::new(RichText::new(label).color(c::TEXT))
        .fill(c::PANEL)
        .stroke(Stroke::new(1.0_f32, c::BORDER))
        .corner_radius(CornerRadius::same(5))
        .min_size(Vec2::new(SIDEBAR_W - 40.0, 28.0))
}

impl eframe::App for ProxoraApp {
    fn update(&mut self, ctx: &egui::Context, _frame: &mut eframe::Frame) {
        self.poll_worker();
        if self.busy
            || matches!(
                self.update_state,
                UpdateState::Checking | UpdateState::Downloading { .. }
            )
        {
            ctx.request_repaint_after(std::time::Duration::from_millis(80));
        }

        egui::CentralPanel::default()
            .frame(Frame::new().fill(c::BG).inner_margin(0.0))
            .show(ctx, |ui| {
                self.title_bar(ui, ctx);

                // Update banner strip
                let mut release_open: Option<String> = None;
                ui.horizontal(|ui| {
                    ui.add_space(0.0);
                });
                {
                    // banner with open-release fix
                    match &self.update_state.clone() {
                        UpdateState::Available(info) => {
                            Frame::new()
                                .fill(Color32::from_rgb(14, 32, 26))
                                .inner_margin(Margin::symmetric(16, 8))
                                .show(ui, |ui| {
                                    ui.horizontal(|ui| {
                                        ui.label(
                                            RichText::new(format!(
                                                "●  Update v{} verfügbar",
                                                info.version
                                            ))
                                            .color(c::ACCENT)
                                            .size(13.0),
                                        );
                                        ui.label(
                                            RichText::new(format!("(aktuell v{APP_VERSION})"))
                                                .color(c::MUTED)
                                                .size(12.0),
                                        );
                                        ui.with_layout(Layout::right_to_left(Align::Center), |ui| {
                                            if ui.add(primary_btn("Aktualisieren")).clicked() {
                                                let _ = self
                                                    .update_cmd
                                                    .send(UpdateCmd::Download(info.clone()));
                                            }
                                            if ui.button("Release").clicked() {
                                                release_open = Some(info.release_url.clone());
                                            }
                                        });
                                    });
                                });
                        }
                        UpdateState::Downloading { info, progress } => {
                            Frame::new()
                                .fill(c::PANEL)
                                .inner_margin(Margin::symmetric(16, 8))
                                .show(ui, |ui| {
                                    ui.horizontal(|ui| {
                                        ui.spinner();
                                        ui.label(format!(
                                            "Download v{} · {:.0}%",
                                            info.version,
                                            progress * 100.0
                                        ));
                                    });
                                    let p = *progress;
                                    ui.add(
                                        egui::ProgressBar::new(p)
                                            .desired_width(ui.available_width())
                                            .fill(c::ACCENT),
                                    );
                                });
                        }
                        UpdateState::ReadyToInstall { info, path } => {
                            let path = path.clone();
                            let ver = info.version.clone();
                            Frame::new()
                                .fill(Color32::from_rgb(32, 28, 14))
                                .inner_margin(Margin::symmetric(16, 8))
                                .show(ui, |ui| {
                                    ui.horizontal(|ui| {
                                        ui.label(
                                            RichText::new(format!("v{ver} bereit zur Installation"))
                                                .color(c::WARN),
                                        );
                                        ui.with_layout(Layout::right_to_left(Align::Center), |ui| {
                                            if ui
                                                .add(primary_btn("Installieren & Neustart"))
                                                .clicked()
                                            {
                                                let _ = self
                                                    .update_cmd
                                                    .send(UpdateCmd::Install { path });
                                            }
                                        });
                                    });
                                });
                        }
                        UpdateState::Error(err) => {
                            Frame::new()
                                .fill(Color32::from_rgb(36, 16, 16))
                                .inner_margin(Margin::symmetric(16, 8))
                                .show(ui, |ui| {
                                    ui.horizontal(|ui| {
                                        ui.label(
                                            RichText::new(format!("Updater: {err}"))
                                                .color(c::DANGER)
                                                .size(12.5),
                                        );
                                        if ui.button("Erneut").clicked() {
                                            let _ = self.update_cmd.send(UpdateCmd::Check);
                                        }
                                    });
                                });
                        }
                        _ => {}
                    }
                }
                if let Some(url) = release_open {
                    updater::open_url(&url);
                }

                ui.horizontal(|ui| {
                    ui.set_min_height(ui.available_height());
                    self.sidebar(ui);

                    Frame::new()
                        .fill(c::BG)
                        .inner_margin(Margin::symmetric(22, 18))
                        .show(ui, |ui| {
                            ui.set_min_width(ui.available_width());
                            ui.set_min_height(ui.available_height());
                            match self.screen {
                                Screen::Setup => self.ui_setup(ui),
                                Screen::Login => self.ui_login(ui),
                                Screen::Totp => self.ui_totp(ui),
                                Screen::Home => self.ui_home(ui),
                            }
                        });
                });
            });
    }
}

impl ProxoraApp {
    fn ui_setup(&mut self, ui: &mut Ui) {
        auth_shell(ui, "Server verbinden", "URL deiner Proxora-Instanz hinterlegen.", |ui| {
            labeled_field(ui, "Server-URL", |ui| {
                ui.add(
                    egui::TextEdit::singleline(&mut self.prefs.server_url)
                        .desired_width(360.0)
                        .hint_text("https://proxora.example.com")
                        .margin(Margin::symmetric(10, 8)),
                );
            });
            ui.add_space(6.0);
            ui.checkbox(
                &mut self.prefs.allow_insecure_tls,
                "Unsicheres TLS erlauben (self-signed)",
            );
            ui.add_space(16.0);
            ui.horizontal(|ui| {
                if ui.add(primary_btn("Weiter")).clicked() {
                    let _ = prefs::save(&self.prefs);
                    self.rebuild_client();
                    self.enqueue(JobKind::Probe);
                    self.screen = Screen::Login;
                }
                if ui.add(ghost_btn("Verbindung prüfen")).clicked() {
                    let _ = prefs::save(&self.prefs);
                    self.rebuild_client();
                    self.enqueue(JobKind::Probe);
                }
            });
        });
    }

    fn ui_login(&mut self, ui: &mut Ui) {
        let server = self.prefs.server_url.clone();
        auth_shell(ui, "Anmelden", &format!("Verbunden mit {server}"), |ui| {
            if ui
                .add(
                    egui::Button::new(RichText::new("← Server ändern").color(c::ACCENT).size(12.5))
                        .fill(Color32::TRANSPARENT)
                        .stroke(Stroke::NONE),
                )
                .clicked()
            {
                self.screen = Screen::Setup;
            }
            ui.add_space(10.0);
            labeled_field(ui, "Benutzer", |ui| {
                ui.add(
                    egui::TextEdit::singleline(&mut self.username)
                        .desired_width(320.0)
                        .margin(Margin::symmetric(10, 8)),
                );
            });
            labeled_field(ui, "Passwort", |ui| {
                ui.add(
                    egui::TextEdit::singleline(&mut self.password)
                        .password(true)
                        .desired_width(320.0)
                        .margin(Margin::symmetric(10, 8)),
                );
            });
            ui.add_space(14.0);
            let enter = ui.input(|i| i.key_pressed(egui::Key::Enter));
            if (ui
                .add_enabled(!self.busy, primary_btn("Login"))
                .clicked()
                || enter)
                && !self.busy
            {
                self.enqueue(JobKind::Login {
                    username: self.username.clone(),
                    password: self.password.clone(),
                });
            }
        });
    }

    fn ui_totp(&mut self, ui: &mut Ui) {
        auth_shell(
            ui,
            "Zwei-Faktor",
            "TOTP- oder Recovery-Code eingeben.",
            |ui| {
                labeled_field(ui, "Code", |ui| {
                    ui.add(
                        egui::TextEdit::singleline(&mut self.totp_code)
                            .desired_width(200.0)
                            .margin(Margin::symmetric(10, 8)),
                    );
                });
                ui.add_space(12.0);
                ui.horizontal(|ui| {
                    if ui
                        .add_enabled(!self.busy, primary_btn("Bestätigen"))
                        .clicked()
                    {
                        if let Some(ticket) = self.totp_ticket.clone() {
                            self.enqueue(JobKind::Totp {
                                ticket,
                                code: self.totp_code.clone(),
                            });
                        }
                    }
                    if ui.add(ghost_btn("Zurück")).clicked() {
                        self.screen = Screen::Login;
                        self.totp_ticket = None;
                    }
                });
            },
        );
    }

    fn ui_home(&mut self, ui: &mut Ui) {
        match self.tab {
            HomeTab::Overview => self.ui_overview(ui),
            HomeTab::Hosts => self.ui_hosts(ui),
            HomeTab::Guests => self.ui_guests(ui),
        }
    }

    fn ui_overview(&mut self, ui: &mut Ui) {
        section_header(ui, "Übersicht", "Cluster-Status auf einen Blick");
        let Some(dash) = self.dashboard.clone() else {
            empty_state(ui, "Noch keine Daten", "Sidebar → Aktualisieren");
            return;
        };

        ui.horizontal_wrapped(|ui| {
            metric_card(ui, "Hosts online", &format!("{}/{}", dash.hosts.online, dash.hosts.total), c::ACCENT);
            metric_card(ui, "VMs", &dash.virtualization.vms.to_string(), c::TEXT);
            metric_card(ui, "LXC", &dash.virtualization.lxc.to_string(), c::TEXT);
            metric_card(ui, "Running", &dash.virtualization.running.to_string(), c::OK);
        });
        ui.add_space(16.0);

        Frame::new()
            .fill(c::PANEL)
            .stroke(Stroke::new(1.0_f32, c::BORDER))
            .corner_radius(CornerRadius::same(8))
            .inner_margin(16.0)
            .show(ui, |ui| {
                ui.label(RichText::new("Ressourcen").strong().size(14.0));
                ui.add_space(10.0);
                resource_bar(ui, "CPU", dash.resources.cpu as f32, &format!("{:.0}%", dash.resources.cpu * 100.0));
                resource_bar(
                    ui,
                    "RAM",
                    ratio(dash.resources.mem_used, dash.resources.mem_total),
                    &format!(
                        "{} / {}",
                        fmt_bytes(dash.resources.mem_used),
                        fmt_bytes(dash.resources.mem_total)
                    ),
                );
                resource_bar(
                    ui,
                    "Disk",
                    ratio(dash.resources.disk_used, dash.resources.disk_total),
                    &format!(
                        "{} / {}",
                        fmt_bytes(dash.resources.disk_used),
                        fmt_bytes(dash.resources.disk_total)
                    ),
                );
            });

        ui.add_space(16.0);
        ui.label(RichText::new("Hosts").strong().size(14.0));
        ui.add_space(8.0);
        egui::ScrollArea::vertical()
            .auto_shrink([false, false])
            .show(ui, |ui| {
                for host in &dash.hosts.items {
                    host_card(ui, &host.name, &host.connection_state, host.proxmox_version.as_deref(), host.mem_used, host.mem_total, None);
                }
            });
    }

    fn ui_hosts(&mut self, ui: &mut Ui) {
        section_header(ui, "Hosts", "Alle verbundenen Proxmox-Knoten");
        if self.hosts.is_empty() {
            empty_state(ui, "Keine Hosts", "Aktualisieren oder Server prüfen");
            return;
        }
        egui::ScrollArea::vertical()
            .auto_shrink([false, false])
            .show(ui, |ui| {
                for host in &self.hosts {
                    host_card(
                        ui,
                        &host.name,
                        &host.connection_state,
                        None,
                        None,
                        None,
                        Some((host.url.as_str(), host.peer_name.as_deref(), host.last_error.as_deref())),
                    );
                }
            });
    }

    fn ui_guests(&mut self, ui: &mut Ui) {
        section_header(ui, "Gäste", "VMs und Container steuern");
        ui.horizontal(|ui| {
            ui.label(RichText::new("Filter").color(c::MUTED).size(12.5));
            ui.add(
                egui::TextEdit::singleline(&mut self.guest_filter)
                    .desired_width(280.0)
                    .hint_text("Name, VMID, Host…")
                    .margin(Margin::symmetric(8, 6)),
            );
        });
        ui.add_space(10.0);

        let filter = self.guest_filter.to_lowercase();
        let Some(guests) = self.guests.clone() else {
            empty_state(ui, "Keine Gäste geladen", "Aktualisieren");
            return;
        };

        egui::ScrollArea::vertical()
            .auto_shrink([false, false])
            .show(ui, |ui| {
                ui.label(RichText::new("VIRTUAL MACHINES").size(11.0).color(c::FAINT));
                ui.add_space(6.0);
                for g in guests.vms.iter().filter(|g| guest_matches(g, &filter)) {
                    self.guest_row(ui, "vm", g);
                }
                ui.add_space(14.0);
                ui.label(RichText::new("CONTAINER").size(11.0).color(c::FAINT));
                ui.add_space(6.0);
                for g in guests.containers.iter().filter(|g| guest_matches(g, &filter)) {
                    self.guest_row(ui, "lxc", g);
                }
            });
    }

    fn guest_row(&mut self, ui: &mut Ui, kind: &str, g: &crate::api::Guest) {
        let host_id = g.host_id.clone().unwrap_or_default();
        Frame::new()
            .fill(c::PANEL)
            .stroke(Stroke::new(1.0_f32, c::BORDER))
            .corner_radius(CornerRadius::same(7))
            .inner_margin(Margin::symmetric(12, 10))
            .show(ui, |ui| {
                ui.horizontal(|ui| {
                    state_dot(ui, &g.status);
                    ui.vertical(|ui| {
                        ui.horizontal(|ui| {
                            ui.label(
                                RichText::new(&g.name)
                                    .strong()
                                    .size(14.0)
                                    .color(c::TEXT),
                            );
                            ui.label(
                                RichText::new(format!("#{}", g.vmid))
                                    .font(FontId::monospace(12.0))
                                    .color(c::MUTED),
                            );
                            ui.label(
                                RichText::new(kind.to_uppercase())
                                    .size(11.0)
                                    .color(c::ACCENT),
                            );
                        });
                        ui.label(
                            RichText::new(format!(
                                "{} · {} · CPU {:.0}% · RAM {} / {}",
                                g.node,
                                g.host_name.as_deref().unwrap_or("?"),
                                g.cpu * 100.0,
                                fmt_bytes(g.mem),
                                fmt_bytes(g.maxmem)
                            ))
                            .size(12.0)
                            .color(c::MUTED),
                        );
                    });
                    ui.with_layout(Layout::right_to_left(Align::Center), |ui| {
                        if host_id.is_empty() {
                            return;
                        }
                        let running = g.status == "running";
                        if running {
                            action_btn(ui, self.busy, "Stop", c::DANGER, || {
                                self.enqueue(JobKind::Action {
                                    guest_kind: kind.into(),
                                    host_id: host_id.clone(),
                                    node: g.node.clone(),
                                    vmid: g.vmid,
                                    action: "stop".into(),
                                });
                            });
                            action_btn(ui, self.busy, "Reboot", c::WARN, || {
                                self.enqueue(JobKind::Action {
                                    guest_kind: kind.into(),
                                    host_id: host_id.clone(),
                                    node: g.node.clone(),
                                    vmid: g.vmid,
                                    action: "reboot".into(),
                                });
                            });
                            action_btn(ui, self.busy, "Shutdown", c::MUTED, || {
                                self.enqueue(JobKind::Action {
                                    guest_kind: kind.into(),
                                    host_id: host_id.clone(),
                                    node: g.node.clone(),
                                    vmid: g.vmid,
                                    action: "shutdown".into(),
                                });
                            });
                        } else {
                            action_btn(ui, self.busy, "Start", c::OK, || {
                                self.enqueue(JobKind::Action {
                                    guest_kind: kind.into(),
                                    host_id: host_id.clone(),
                                    node: g.node.clone(),
                                    vmid: g.vmid,
                                    action: "start".into(),
                                });
                            });
                        }
                    });
                });
            });
        ui.add_space(6.0);
    }
}

fn action_btn(ui: &mut Ui, busy: bool, label: &str, color: Color32, on_click: impl FnOnce()) {
    let btn = egui::Button::new(RichText::new(label).size(12.0).color(color))
        .fill(c::PANEL_2)
        .stroke(Stroke::new(1.0_f32, c::BORDER))
        .corner_radius(CornerRadius::same(4));
    if ui.add_enabled(!busy, btn).clicked() {
        on_click();
    }
}

fn auth_shell(ui: &mut Ui, title: &str, subtitle: &str, add_contents: impl FnOnce(&mut Ui)) {
    ui.vertical_centered(|ui| {
        ui.add_space(ui.available_height() * 0.08);
        Frame::new()
            .fill(c::PANEL)
            .stroke(Stroke::new(1.0_f32, c::BORDER))
            .corner_radius(CornerRadius::same(10))
            .shadow(Shadow {
                offset: [0, 8],
                blur: 24,
                spread: 0,
                color: Color32::from_black_alpha(80),
            })
            .inner_margin(Margin::symmetric(28, 24))
            .show(ui, |ui| {
                ui.set_max_width(440.0);
                ui.label(RichText::new(title).size(22.0).strong().color(c::TEXT));
                ui.label(RichText::new(subtitle).size(13.0).color(c::MUTED));
                ui.add_space(16.0);
                add_contents(ui);
            });
    });
}

fn labeled_field(ui: &mut Ui, label: &str, add_contents: impl FnOnce(&mut Ui)) {
    ui.label(RichText::new(label).size(12.0).color(c::MUTED));
    ui.add_space(4.0);
    add_contents(ui);
    ui.add_space(10.0);
}

fn section_header(ui: &mut Ui, title: &str, subtitle: &str) {
    ui.horizontal(|ui| {
        ui.vertical(|ui| {
            ui.label(RichText::new(title).size(20.0).strong().color(c::TEXT));
            ui.label(RichText::new(subtitle).size(12.5).color(c::MUTED));
        });
    });
    ui.add_space(14.0);
}

fn empty_state(ui: &mut Ui, title: &str, hint: &str) {
    Frame::new()
        .fill(c::PANEL)
        .stroke(Stroke::new(1.0_f32, c::BORDER))
        .corner_radius(CornerRadius::same(8))
        .inner_margin(24.0)
        .show(ui, |ui| {
            ui.label(RichText::new(title).size(15.0).color(c::TEXT));
            ui.label(RichText::new(hint).size(12.5).color(c::MUTED));
        });
}

fn metric_card(ui: &mut Ui, label: &str, value: &str, value_color: Color32) {
    Frame::new()
        .fill(c::PANEL)
        .stroke(Stroke::new(1.0_f32, c::BORDER))
        .corner_radius(CornerRadius::same(8))
        .inner_margin(Margin::symmetric(16, 14))
        .show(ui, |ui| {
            ui.set_min_width(128.0);
            ui.label(RichText::new(label).size(11.5).color(c::MUTED));
            ui.label(
                RichText::new(value)
                    .size(26.0)
                    .strong()
                    .color(value_color),
            );
        });
}

fn resource_bar(ui: &mut Ui, label: &str, frac: f32, detail: &str) {
    ui.horizontal(|ui| {
        ui.set_min_width(ui.available_width());
        ui.label(
            RichText::new(label)
                .size(12.5)
                .color(c::MUTED)
                .strong(),
        );
        ui.with_layout(Layout::right_to_left(Align::Center), |ui| {
            ui.label(RichText::new(detail).size(12.0).color(c::TEXT));
        });
    });
    let frac = frac.clamp(0.0, 1.0);
    let color = if frac > 0.85 {
        c::DANGER
    } else if frac > 0.7 {
        c::WARN
    } else {
        c::ACCENT
    };
    ui.add(
        egui::ProgressBar::new(frac)
            .desired_height(8.0)
            .desired_width(ui.available_width())
            .fill(color),
    );
    ui.add_space(8.0);
}

fn host_card(
    ui: &mut Ui,
    name: &str,
    state: &str,
    version: Option<&str>,
    mem_used: Option<u64>,
    mem_total: Option<u64>,
    extra: Option<(&str, Option<&str>, Option<&str>)>,
) {
    Frame::new()
        .fill(c::PANEL)
        .stroke(Stroke::new(1.0_f32, c::BORDER))
        .corner_radius(CornerRadius::same(7))
        .inner_margin(Margin::symmetric(14, 12))
        .show(ui, |ui| {
            ui.horizontal(|ui| {
                state_dot(ui, state);
                ui.vertical(|ui| {
                    ui.horizontal(|ui| {
                        ui.label(RichText::new(name).strong().size(14.5));
                        ui.label(
                            RichText::new(state)
                                .size(12.0)
                                .color(theme::state_color(state)),
                        );
                        if let Some(v) = version {
                            ui.label(RichText::new(v).size(11.5).color(c::FAINT));
                        }
                    });
                    if let (Some(mu), Some(mt)) = (mem_used, mem_total) {
                        ui.label(
                            RichText::new(format!("RAM {} / {}", fmt_bytes(mu), fmt_bytes(mt)))
                                .size(12.0)
                                .color(c::MUTED),
                        );
                    }
                    if let Some((url, peer, err)) = extra {
                        ui.label(
                            RichText::new(url)
                                .font(FontId::monospace(11.5))
                                .color(c::FAINT),
                        );
                        if let Some(p) = peer {
                            ui.label(RichText::new(format!("Peer: {p}")).size(12.0).color(c::MUTED));
                        }
                        if let Some(e) = err {
                            if !e.is_empty() {
                                ui.label(RichText::new(e).size(12.0).color(c::DANGER));
                            }
                        }
                    }
                });
            });
        });
    ui.add_space(6.0);
}

fn state_dot(ui: &mut Ui, state: &str) {
    let color = theme::state_color(state);
    let (rect, _) = ui.allocate_exact_size(Vec2::splat(12.0), Sense::hover());
    ui.painter().circle_filled(rect.center(), 4.0, color);
    ui.painter()
        .circle_stroke(rect.center(), 5.5, Stroke::new(1.0_f32, color.gamma_multiply(0.4)));
}

fn guest_matches(g: &crate::api::Guest, filter: &str) -> bool {
    if filter.is_empty() {
        return true;
    }
    let hay = format!(
        "{} {} {} {}",
        g.name,
        g.vmid,
        g.node,
        g.host_name.as_deref().unwrap_or("")
    )
    .to_lowercase();
    hay.contains(filter)
}

fn ratio(used: u64, total: u64) -> f32 {
    if total == 0 {
        0.0
    } else {
        used as f32 / total as f32
    }
}

fn fmt_bytes(bytes: u64) -> String {
    const UNITS: [&str; 5] = ["B", "KiB", "MiB", "GiB", "TiB"];
    let mut v = bytes as f64;
    let mut i = 0;
    while v >= 1024.0 && i < UNITS.len() - 1 {
        v /= 1024.0;
        i += 1;
    }
    if i == 0 {
        format!("{bytes} {}", UNITS[i])
    } else {
        format!("{v:.1} {}", UNITS[i])
    }
}

fn chrono_now() -> String {
    chrono::Local::now().format("%H:%M:%S").to_string()
}

fn worker_loop(jobs: Receiver<Job>, out: Sender<WorkerMsg>) {
    while let Ok(job) = jobs.recv() {
        let msg = match job.kind {
            JobKind::Probe => match job.client.health() {
                Ok(h) => WorkerMsg::HealthOk {
                    version: h.version.unwrap_or_else(|| "?".into()),
                },
                Err(e) => WorkerMsg::HealthErr(e.to_string()),
            },
            JobKind::Login { username, password } => match job.client.login(&username, &password) {
                Ok(res) if res.totp_required.unwrap_or(false) => WorkerMsg::LoginTotp {
                    ticket: res.ticket.unwrap_or_default(),
                },
                Ok(res) => match res.user {
                    Some(user) => WorkerMsg::LoginOk(user),
                    None => WorkerMsg::LoginErr("Login ohne User".into()),
                },
                Err(e) => WorkerMsg::LoginErr(e.to_string()),
            },
            JobKind::Totp { ticket, code } => match job.client.login_totp(&ticket, &code) {
                Ok(user) => WorkerMsg::LoginOk(user),
                Err(e) => WorkerMsg::LoginErr(e.to_string()),
            },
            JobKind::Refresh => {
                match (
                    job.client.dashboard(),
                    job.client.hosts(),
                    job.client.guests(),
                ) {
                    (Ok(dashboard), Ok(hosts), Ok(guests)) => WorkerMsg::RefreshOk {
                        dashboard,
                        hosts,
                        guests,
                    },
                    (Err(e), _, _) | (_, Err(e), _) | (_, _, Err(e)) => {
                        WorkerMsg::RefreshErr(e.to_string())
                    }
                }
            }
            JobKind::Action {
                guest_kind,
                host_id,
                node,
                vmid,
                action,
            } => match job
                .client
                .guest_action(&guest_kind, &host_id, &node, vmid, &action)
            {
                Ok(()) => WorkerMsg::ActionOk(format!("{action} · {guest_kind} {vmid}")),
                Err(e) => WorkerMsg::ActionErr(e.to_string()),
            },
            JobKind::Logout => {
                let _ = job.client.logout();
                WorkerMsg::LoggedOut
            }
        };
        let _ = out.send(msg);
    }
}
