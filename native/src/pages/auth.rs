use crate::app::chrome;
use crate::net::{ApiResult, Client, Health, LoginResponse, MeResponse, Pending, SessionUser};
use crate::prefs::{self, Prefs};
use crate::theme::{self, c};
use crate::ui::widgets::{self as w, Btn};
use crate::updater::APP_VERSION;
use eframe::egui::{self, Frame, Margin, RichText, Stroke, Ui};
use egui_phosphor::regular as ph;
use serde_json::json;

#[derive(PartialEq, Eq, Clone, Copy)]
enum Step {
    Server,
    Restoring,
    Login,
    Totp,
}

pub enum AuthOutcome {
    Pending,
    LoggedIn {
        client: Client,
        user: SessionUser,
        server_version: Option<String>,
    },
}

pub struct AuthScreen {
    step: Step,
    url: String,
    insecure: bool,
    client: Option<Client>,
    health: Option<Health>,
    probe: Option<Pending<ApiResult<Health>>>,
    restore: Option<Pending<ApiResult<MeResponse>>>,
    login: Option<Pending<ApiResult<LoginResponse>>>,
    username: String,
    password: String,
    totp: String,
    ticket: Option<String>,
    remember: bool,
    error: Option<String>,
    notice: Option<String>,
    focus_requested: bool,
}

impl AuthScreen {
    pub fn new(ctx: &egui::Context, prefs: &Prefs, notice: Option<String>) -> Self {
        let mut screen = Self {
            step: Step::Server,
            url: prefs.server_url.clone(),
            insecure: prefs.allow_insecure_tls,
            client: None,
            health: None,
            probe: None,
            restore: None,
            login: None,
            username: prefs.last_username.clone(),
            password: String::new(),
            totp: String::new(),
            ticket: None,
            remember: prefs.remember_session,
            error: None,
            notice,
            focus_requested: false,
        };
        if prefs.server_url.trim().is_empty() {
            return screen;
        }
        match Client::new(&prefs.server_url, prefs.allow_insecure_tls) {
            Ok(client) => {
                if let (true, Some(token)) = (prefs.remember_session, prefs.session_token.as_deref()) {
                    client.restore_session(token);
                    let c2 = client.clone();
                    screen.restore = Some(Pending::spawn(ctx, move || c2.get::<MeResponse>("/api/auth/me")));
                    screen.step = Step::Restoring;
                } else {
                    screen.step = Step::Login;
                }
                screen.start_probe(ctx, &client);
                screen.client = Some(client);
            }
            Err(err) => screen.error = Some(err.message),
        }
        screen
    }

    #[cfg(feature = "demo")]
    pub fn demo(ctx: &egui::Context, client: Client, prefs: &Prefs) -> Self {
        let mut screen = Self::new(ctx, &Prefs::default(), None);
        screen.username = "marcel".into();
        screen.url = prefs.server_url.clone();
        screen.step = Step::Login;
        screen.focus_requested = true;
        screen.start_probe(ctx, &client);
        screen.client = Some(client);
        screen
    }

    fn start_probe(&mut self, ctx: &egui::Context, client: &Client) {
        let c2 = client.clone();
        self.probe = Some(Pending::spawn(ctx, move || c2.get::<Health>("/api/health")));
    }

    fn poll(&mut self, prefs: &mut Prefs) -> Option<AuthOutcome> {
        if let Some(res) = self.probe.as_ref().and_then(Pending::poll) {
            self.probe = None;
            match res {
                Ok(h) => {
                    self.health = Some(h);
                    if self.step == Step::Server {
                        prefs.server_url = self
                            .client
                            .as_ref()
                            .map(|c| c.base().to_string().trim_end_matches('/').to_owned())
                            .unwrap_or_else(|| self.url.trim().to_owned());
                        prefs.allow_insecure_tls = self.insecure;
                        let _ = prefs::save(prefs);
                        self.step = Step::Login;
                        self.error = None;
                        self.focus_requested = false;
                    }
                }
                Err(err) => {
                    if self.step == Step::Server {
                        self.error = Some(err.message);
                        self.client = None;
                    }
                }
            }
        }
        if let Some(res) = self.restore.as_ref().and_then(Pending::poll) {
            self.restore = None;
            match res {
                Ok(MeResponse { user: Some(user), .. }) => {
                    return Some(self.finish(user, prefs));
                }
                Ok(_) | Err(_) => {
                    prefs.session_token = None;
                    let _ = prefs::save(prefs);
                    self.step = Step::Login;
                }
            }
        }
        if let Some(res) = self.login.as_ref().and_then(Pending::poll) {
            self.login = None;
            match res {
                Ok(r) if r.totp_required => {
                    self.ticket = r.ticket;
                    self.totp.clear();
                    self.step = Step::Totp;
                    self.error = None;
                    self.focus_requested = false;
                }
                Ok(LoginResponse { user: Some(user), .. }) => {
                    return Some(self.finish(user, prefs));
                }
                Ok(_) => self.error = Some("Unerwartete Antwort vom Server.".into()),
                Err(err) => {
                    self.error = Some(match err.code.as_deref() {
                        Some("INVALID_CREDENTIALS") => "Benutzername oder Passwort falsch.".into(),
                        Some("INVALID_TOTP") => "Code ungültig. Neuen Code eingeben.".into(),
                        Some("RATE_LIMITED") => {
                            "Zu viele Anmeldeversuche. In ein paar Minuten erneut versuchen.".into()
                        }
                        _ => err.message,
                    });
                    if err.status == Some(401) && self.step == Step::Totp && err.code.as_deref() == Some("UNAUTHORIZED") {
                        self.step = Step::Login;
                        self.ticket = None;
                    }
                }
            }
        }
        None
    }

    fn finish(&mut self, user: SessionUser, prefs: &mut Prefs) -> AuthOutcome {
        let client = self.client.clone().expect("client exists after login");
        prefs.last_username = user.username.clone();
        prefs.remember_session = self.remember;
        prefs.session_token = if self.remember { client.session_cookie() } else { None };
        let _ = prefs::save(prefs);
        self.password.clear();
        AuthOutcome::LoggedIn {
            client,
            user,
            server_version: self.health.as_ref().and_then(|h| h.version.clone()),
        }
    }

    fn submit_login(&mut self, ctx: &egui::Context) {
        let Some(client) = self.client.clone() else {
            return;
        };
        self.error = None;
        let body = match (self.step, &self.ticket) {
            (Step::Totp, Some(ticket)) => json!({ "ticket": ticket, "totp": self.totp.trim() }),
            _ => json!({ "username": self.username.trim(), "password": self.password }),
        };
        self.login = Some(Pending::spawn(ctx, move || {
            client.post::<LoginResponse>("/api/auth/login", &body)
        }));
    }

    pub fn ui(&mut self, ctx: &egui::Context, prefs: &mut Prefs) -> AuthOutcome {
        if let Some(outcome) = self.poll(prefs) {
            return outcome;
        }
        chrome::title_bar(ctx, |ui| {
            ui.add_space(6.0);
            chrome::brand(ui, 22.0);
        });
        egui::CentralPanel::default()
            .frame(Frame::new().fill(c::BG))
            .show(ctx, |ui| {
                let avail = ui.available_size();
                ui.add_space((avail.y * 0.14).clamp(24.0, 120.0));
                ui.vertical_centered(|ui| {
                    self.card(ui, ctx, prefs);
                    ui.add_space(14.0);
                    let host = self.client.as_ref().map(Client::host_label).unwrap_or_default();
                    let server = self
                        .health
                        .as_ref()
                        .and_then(|h| h.version.clone())
                        .map(|v| format!(" · Proxora {v}"))
                        .unwrap_or_default();
                    ui.label(w::small(format!("Desktop v{APP_VERSION}  ·  {host}{server}")));
                });
            });
        AuthOutcome::Pending
    }

    fn card(&mut self, ui: &mut Ui, ctx: &egui::Context, prefs: &mut Prefs) {
        let width = 400.0;
        Frame::new()
            .fill(c::PANEL)
            .stroke(Stroke::new(1.0_f32, c::BORDER))
            .corner_radius(6)
            .shadow(egui::Shadow {
                offset: [0, 18],
                blur: 48,
                spread: 0,
                color: egui::Color32::from_black_alpha(140),
            })
            .inner_margin(Margin::symmetric(28, 26))
            .show(ui, |ui| {
                ui.set_width(width - 56.0);
                ui.with_layout(egui::Layout::top_down(egui::Align::Min), |ui| {
                    let accent = ui.cursor();
                    let bar = egui::Rect::from_min_size(
                        egui::pos2(accent.left() - 22.0, accent.top() - 26.0),
                        egui::vec2(width - 12.0, 2.0),
                    );
                    paint_brand_bar(ui, bar);

                    let (heading, sub) = match self.step {
                        Step::Server => ("Mit Proxora verbinden", "Adresse deiner Proxora-Instanz."),
                        Step::Restoring => ("Sitzung wird geprüft", "Gespeicherte Anmeldung wird übernommen."),
                        Step::Login => ("Anmelden", "Mit deinem Proxora-Konto."),
                        Step::Totp => ("Zwei-Faktor-Code", "Code aus der Authenticator-App oder Recovery-Code."),
                    };
                    ui.label(RichText::new(heading).font(theme::semibold(20.0)).color(c::TEXT));
                    ui.add_space(2.0);
                    ui.label(w::muted(sub));
                    ui.add_space(18.0);

                    if let Some(n) = self.notice.clone() {
                        w::callout(ui, ph::INFO, c::CYAN, &n);
                        ui.add_space(12.0);
                    }

                    match self.step {
                        Step::Server => self.server_step(ui, ctx),
                        Step::Restoring => {
                            ui.horizontal(|ui| {
                                ui.spinner();
                                ui.label(w::secondary("Verbinde …"));
                            });
                            ui.add_space(12.0);
                            if ui.add(Btn::ghost("Manuell anmelden").small()).clicked() {
                                self.restore = None;
                                self.step = Step::Login;
                            }
                        }
                        Step::Login => self.login_step(ui, ctx, prefs),
                        Step::Totp => self.totp_step(ui, ctx),
                    }

                    if let Some(err) = self.error.clone() {
                        ui.add_space(12.0);
                        w::callout(ui, ph::WARNING_CIRCLE, c::DANGER, &err);
                    }
                });
            });
    }

    fn server_step(&mut self, ui: &mut Ui, ctx: &egui::Context) {
        let busy = self.probe.is_some();
        let enter = w::field(ui, "Server-Adresse", Some("z. B. https://proxora.example.com oder 192.168.1.20:3000"), |ui| {
            let r = w::text_input(ui, &mut self.url, "https://", ui.available_width());
            if !self.focus_requested {
                r.request_focus();
                self.focus_requested = true;
            }
            r.lost_focus() && ui.input(|i| i.key_pressed(egui::Key::Enter))
        });
        ui.checkbox(&mut self.insecure, "Selbstsignierte Zertifikate akzeptieren");
        ui.add_space(16.0);
        let clicked = ui
            .add(
                Btn::primary("Verbinden")
                    .icon(ph::PLUGS_CONNECTED)
                    .loading(busy)
                    .enabled(!self.url.trim().is_empty())
                    .fill_width(),
            )
            .clicked();
        if (clicked || enter) && !busy && !self.url.trim().is_empty() {
            self.error = None;
            match Client::new(&self.url, self.insecure) {
                Ok(client) => {
                    self.start_probe(ctx, &client);
                    self.client = Some(client);
                }
                Err(err) => self.error = Some(err.message),
            }
        }
    }

    fn login_step(&mut self, ui: &mut Ui, ctx: &egui::Context, prefs: &mut Prefs) {
        let busy = self.login.is_some();
        let mut enter = false;
        w::field(ui, "Benutzername", None, |ui| {
            let r = w::text_input(ui, &mut self.username, "admin", ui.available_width());
            if !self.focus_requested && self.username.is_empty() {
                r.request_focus();
                self.focus_requested = true;
            }
            enter |= r.lost_focus() && ui.input(|i| i.key_pressed(egui::Key::Enter));
        });
        w::field(ui, "Passwort", None, |ui| {
            let r = w::password_input(ui, &mut self.password, "", ui.available_width());
            if !self.focus_requested {
                r.request_focus();
                self.focus_requested = true;
            }
            enter |= r.lost_focus() && ui.input(|i| i.key_pressed(egui::Key::Enter));
        });
        ui.checkbox(&mut self.remember, "Angemeldet bleiben");
        ui.add_space(16.0);
        let ready = !self.username.trim().is_empty() && !self.password.is_empty();
        let clicked = ui
            .add(
                Btn::primary("Anmelden")
                    .icon(ph::SIGN_IN)
                    .loading(busy)
                    .enabled(ready)
                    .fill_width(),
            )
            .clicked();
        if (clicked || enter) && ready && !busy {
            self.submit_login(ctx);
        }
        ui.add_space(10.0);
        ui.horizontal(|ui| {
            if ui.add(Btn::ghost("Anderer Server").icon(ph::ARROW_LEFT).small()).clicked() {
                self.step = Step::Server;
                self.error = None;
                self.health = None;
                prefs.session_token = None;
            }
        });
    }

    fn totp_step(&mut self, ui: &mut Ui, ctx: &egui::Context) {
        let busy = self.login.is_some();
        let mut enter = false;
        w::field(ui, "Code", Some("6 Ziffern oder Recovery-Code (XXXX-XXXX)"), |ui| {
            let r = ui.add(
                egui::TextEdit::singleline(&mut self.totp)
                    .font(theme::mono(18.0))
                    .hint_text(RichText::new("000000").color(c::MUTED))
                    .desired_width(ui.available_width())
                    .margin(Margin::symmetric(12, 10)),
            );
            if !self.focus_requested {
                r.request_focus();
                self.focus_requested = true;
            }
            enter = r.lost_focus() && ui.input(|i| i.key_pressed(egui::Key::Enter));
        });
        ui.add_space(8.0);
        let ready = self.totp.trim().len() >= 6;
        let clicked = ui
            .add(Btn::primary("Bestätigen").icon(ph::SHIELD_CHECK).loading(busy).enabled(ready).fill_width())
            .clicked();
        if (clicked || enter) && ready && !busy {
            self.submit_login(ctx);
        }
        ui.add_space(10.0);
        if ui.add(Btn::ghost("Zurück").icon(ph::ARROW_LEFT).small()).clicked() {
            self.step = Step::Login;
            self.ticket = None;
            self.error = None;
        }
    }
}

fn paint_brand_bar(ui: &Ui, rect: egui::Rect) {
    let mut mesh = egui::Mesh::default();
    mesh.colored_vertex(rect.left_top(), c::PURPLE);
    mesh.colored_vertex(rect.right_top(), c::PINK);
    mesh.colored_vertex(rect.right_bottom(), c::PINK);
    mesh.colored_vertex(rect.left_bottom(), c::PURPLE);
    mesh.add_triangle(0, 1, 2);
    mesh.add_triangle(0, 2, 3);
    ui.painter().add(egui::Shape::mesh(mesh));
}
