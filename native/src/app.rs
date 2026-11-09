use crate::api::{Dashboard, DashboardGuests, PublicHost, ProxoraClient, SessionUser};
use crate::prefs::{self, Prefs};
use eframe::egui::{self, Align, Color32, CornerRadius, Frame, Layout, RichText, Sense, Stroke, Ui, Vec2};
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
}

impl ProxoraApp {
    pub fn new(cc: &eframe::CreationContext<'_>) -> Self {
        apply_theme(&cc.egui_ctx);
        let prefs = prefs::load();
        let (msg_tx, rx) = mpsc::channel();
        let (job_tx, job_rx) = mpsc::channel::<Job>();
        thread::Builder::new()
            .name("proxora-api".into())
            .spawn(move || worker_loop(job_rx, msg_tx))
            .expect("api worker");

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
        };
        if !app.prefs.server_url.trim().is_empty() {
            app.rebuild_client();
            app.enqueue(JobKind::Probe);
        }
        app
    }

    fn rebuild_client(&mut self) {
        match ProxoraClient::new(&self.prefs.server_url, self.prefs.allow_insecure_tls) {
            Ok(client) => {
                self.client = Some(client);
            }
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
    }

    fn top_bar(&mut self, ui: &mut Ui) {
        ui.horizontal(|ui| {
            ui.label(RichText::new("PROXORA").strong().size(18.0).color(Color32::from_rgb(0, 229, 255)));
            ui.label(RichText::new("Native").small().color(Color32::from_rgb(140, 160, 180)));
            ui.with_layout(Layout::right_to_left(Align::Center), |ui| {
                if self.busy {
                    ui.spinner();
                }
                if self.screen == Screen::Home {
                    if ui.button("Abmelden").clicked() {
                        self.enqueue(JobKind::Logout);
                    }
                    if ui.button("Aktualisieren").clicked() {
                        self.enqueue(JobKind::Refresh);
                    }
                    if let Some(user) = &self.user {
                        ui.label(format!("{} · {}", user.username, user.role.name));
                    }
                }
            });
        });
        ui.add_space(4.0);
        if !self.status.is_empty() {
            ui.label(RichText::new(&self.status).small().color(Color32::from_rgb(180, 200, 210)));
        }
        ui.separator();
    }
}

impl eframe::App for ProxoraApp {
    fn update(&mut self, ctx: &egui::Context, _frame: &mut eframe::Frame) {
        self.poll_worker();
        if self.busy {
            ctx.request_repaint_after(std::time::Duration::from_millis(100));
        }

        egui::CentralPanel::default()
            .frame(Frame::new().fill(Color32::from_rgb(10, 10, 15)).inner_margin(16.0))
            .show(ctx, |ui| {
                self.top_bar(ui);
                ui.add_space(8.0);
                match self.screen {
                    Screen::Setup => self.ui_setup(ui),
                    Screen::Login => self.ui_login(ui),
                    Screen::Totp => self.ui_totp(ui),
                    Screen::Home => self.ui_home(ui),
                }
            });
    }
}

impl ProxoraApp {
    fn ui_setup(&mut self, ui: &mut Ui) {
        ui.heading("Server verbinden");
        ui.label("URL deiner self-hosted Proxora-Instanz.");
        ui.add_space(8.0);
        ui.horizontal(|ui| {
            ui.label("URL");
            ui.add(
                egui::TextEdit::singleline(&mut self.prefs.server_url)
                    .desired_width(420.0)
                    .hint_text("http://192.168.178.246:3000"),
            );
        });
        ui.checkbox(&mut self.prefs.allow_insecure_tls, "Unsicheres TLS erlauben (self-signed)");
        ui.add_space(12.0);
        ui.horizontal(|ui| {
            if ui.button("Weiter").clicked() {
                let _ = prefs::save(&self.prefs);
                self.rebuild_client();
                self.enqueue(JobKind::Probe);
                self.screen = Screen::Login;
            }
            if ui.button("Prüfen").clicked() {
                let _ = prefs::save(&self.prefs);
                self.rebuild_client();
                self.enqueue(JobKind::Probe);
            }
        });
    }

    fn ui_login(&mut self, ui: &mut Ui) {
        ui.heading("Anmelden");
        ui.label(format!("Server: {}", self.prefs.server_url));
        if ui.link("Server ändern").clicked() {
            self.screen = Screen::Setup;
        }
        ui.add_space(8.0);
        ui.horizontal(|ui| {
            ui.label("Benutzer");
            ui.add(egui::TextEdit::singleline(&mut self.username).desired_width(280.0));
        });
        ui.horizontal(|ui| {
            ui.label("Passwort");
            ui.add(
                egui::TextEdit::singleline(&mut self.password)
                    .password(true)
                    .desired_width(280.0),
            );
        });
        ui.add_space(10.0);
        let enter = ui.input(|i| i.key_pressed(egui::Key::Enter));
        if (ui.add_enabled(!self.busy, egui::Button::new("Login")).clicked() || enter) && !self.busy {
            self.enqueue(JobKind::Login {
                username: self.username.clone(),
                password: self.password.clone(),
            });
        }
    }

    fn ui_totp(&mut self, ui: &mut Ui) {
        ui.heading("Zwei-Faktor");
        ui.label("TOTP- oder Recovery-Code eingeben.");
        ui.horizontal(|ui| {
            ui.label("Code");
            ui.add(egui::TextEdit::singleline(&mut self.totp_code).desired_width(180.0));
        });
        if ui.add_enabled(!self.busy, egui::Button::new("Bestätigen")).clicked() {
            if let Some(ticket) = self.totp_ticket.clone() {
                self.enqueue(JobKind::Totp {
                    ticket,
                    code: self.totp_code.clone(),
                });
            }
        }
        if ui.button("Zurück").clicked() {
            self.screen = Screen::Login;
            self.totp_ticket = None;
        }
    }

    fn ui_home(&mut self, ui: &mut Ui) {
        ui.horizontal(|ui| {
            for (tab, label) in [
                (HomeTab::Overview, "Übersicht"),
                (HomeTab::Hosts, "Hosts"),
                (HomeTab::Guests, "Gäste"),
            ] {
                let selected = self.tab == tab;
                if ui
                    .add(egui::SelectableLabel::new(selected, label))
                    .clicked()
                {
                    self.tab = tab;
                }
            }
        });
        ui.add_space(8.0);
        match self.tab {
            HomeTab::Overview => self.ui_overview(ui),
            HomeTab::Hosts => self.ui_hosts(ui),
            HomeTab::Guests => self.ui_guests(ui),
        }
    }

    fn ui_overview(&mut self, ui: &mut Ui) {
        let Some(dash) = self.dashboard.clone() else {
            ui.label("Noch keine Daten — Aktualisieren.");
            return;
        };
        ui.horizontal(|ui| {
            metric_card(ui, "Hosts online", &format!("{}/{}", dash.hosts.online, dash.hosts.total));
            metric_card(ui, "VMs", &dash.virtualization.vms.to_string());
            metric_card(ui, "LXC", &dash.virtualization.lxc.to_string());
            metric_card(ui, "Running", &dash.virtualization.running.to_string());
        });
        ui.add_space(10.0);
        ui.label(RichText::new("Ressourcen").strong());
        ui.label(format!(
            "CPU {:.0}% · RAM {} / {} · Disk {} / {}",
            dash.resources.cpu * 100.0,
            fmt_bytes(dash.resources.mem_used),
            fmt_bytes(dash.resources.mem_total),
            fmt_bytes(dash.resources.disk_used),
            fmt_bytes(dash.resources.disk_total),
        ));
        ui.add_space(10.0);
        ui.label(RichText::new("Hosts").strong());
        egui::ScrollArea::vertical().show(ui, |ui| {
            for host in &dash.hosts.items {
                Frame::group(ui.style())
                    .fill(Color32::from_rgb(18, 20, 28))
                    .corner_radius(CornerRadius::same(6))
                    .inner_margin(10.0)
                    .show(ui, |ui| {
                        ui.horizontal(|ui| {
                            state_dot(ui, &host.connection_state);
                            ui.label(RichText::new(&host.name).strong());
                            ui.label(host.connection_state.clone());
                            if let Some(v) = &host.proxmox_version {
                                ui.label(RichText::new(v).small().weak());
                            }
                        });
                        if let (Some(mu), Some(mt)) = (host.mem_used, host.mem_total) {
                            ui.label(format!("RAM {} / {}", fmt_bytes(mu), fmt_bytes(mt)));
                        }
                    });
                ui.add_space(6.0);
            }
        });
    }

    fn ui_hosts(&mut self, ui: &mut Ui) {
        egui::ScrollArea::vertical().show(ui, |ui| {
            for host in &self.hosts {
                Frame::group(ui.style())
                    .fill(Color32::from_rgb(18, 20, 28))
                    .corner_radius(CornerRadius::same(6))
                    .inner_margin(10.0)
                    .show(ui, |ui| {
                        ui.horizontal(|ui| {
                            state_dot(ui, &host.connection_state);
                            ui.label(RichText::new(&host.name).strong().size(15.0));
                        });
                        ui.label(format!("{} · {}", host.connection_state, host.url));
                        if let Some(peer) = &host.peer_name {
                            ui.label(format!("Peer: {peer}"));
                        }
                        if let Some(err) = &host.last_error {
                            if !err.is_empty() {
                                ui.colored_label(Color32::from_rgb(255, 120, 120), err);
                            }
                        }
                    });
                ui.add_space(6.0);
            }
        });
    }

    fn ui_guests(&mut self, ui: &mut Ui) {
        ui.horizontal(|ui| {
            ui.label("Filter");
            ui.add(
                egui::TextEdit::singleline(&mut self.guest_filter)
                    .desired_width(240.0)
                    .hint_text("Name, VMID, Host…"),
            );
        });
        ui.add_space(6.0);
        let filter = self.guest_filter.to_lowercase();
        let Some(guests) = self.guests.clone() else {
            ui.label("Keine Gäste geladen.");
            return;
        };

        egui::ScrollArea::vertical().show(ui, |ui| {
            ui.label(RichText::new("VMs").strong());
            for g in guests.vms.iter().filter(|g| guest_matches(g, &filter)) {
                self.guest_row(ui, "vm", g);
            }
            ui.add_space(8.0);
            ui.label(RichText::new("Container").strong());
            for g in guests.containers.iter().filter(|g| guest_matches(g, &filter)) {
                self.guest_row(ui, "lxc", g);
            }
        });
    }

    fn guest_row(&mut self, ui: &mut Ui, kind: &str, g: &crate::api::Guest) {
        let host_id = g.host_id.clone().unwrap_or_default();
        Frame::group(ui.style())
            .fill(Color32::from_rgb(18, 20, 28))
            .corner_radius(CornerRadius::same(6))
            .inner_margin(8.0)
            .show(ui, |ui| {
                ui.horizontal(|ui| {
                    state_dot(ui, &g.status);
                    ui.label(RichText::new(format!("{} ({})", g.name, g.vmid)).strong());
                    ui.label(format!(
                        "{} · {} · {}",
                        kind.to_uppercase(),
                        g.node,
                        g.host_name.as_deref().unwrap_or("?")
                    ));
                });
                ui.label(format!(
                    "CPU {:.0}% · RAM {} / {} · {}",
                    g.cpu * 100.0,
                    fmt_bytes(g.mem),
                    fmt_bytes(g.maxmem),
                    g.status
                ));
                ui.horizontal(|ui| {
                    let running = g.status == "running";
                    if !host_id.is_empty() {
                        if !running
                            && ui
                                .add_enabled(!self.busy, egui::Button::new("Start"))
                                .clicked()
                        {
                            self.enqueue(JobKind::Action {
                                guest_kind: kind.into(),
                                host_id: host_id.clone(),
                                node: g.node.clone(),
                                vmid: g.vmid,
                                action: "start".into(),
                            });
                        }
                        if running {
                            if ui
                                .add_enabled(!self.busy, egui::Button::new("Shutdown"))
                                .clicked()
                            {
                                self.enqueue(JobKind::Action {
                                    guest_kind: kind.into(),
                                    host_id: host_id.clone(),
                                    node: g.node.clone(),
                                    vmid: g.vmid,
                                    action: "shutdown".into(),
                                });
                            }
                            if ui
                                .add_enabled(!self.busy, egui::Button::new("Reboot"))
                                .clicked()
                            {
                                self.enqueue(JobKind::Action {
                                    guest_kind: kind.into(),
                                    host_id: host_id.clone(),
                                    node: g.node.clone(),
                                    vmid: g.vmid,
                                    action: "reboot".into(),
                                });
                            }
                            if ui
                                .add_enabled(!self.busy, egui::Button::new("Stop"))
                                .clicked()
                            {
                                self.enqueue(JobKind::Action {
                                    guest_kind: kind.into(),
                                    host_id: host_id.clone(),
                                    node: g.node.clone(),
                                    vmid: g.vmid,
                                    action: "stop".into(),
                                });
                            }
                        }
                    }
                });
            });
        ui.add_space(4.0);
    }
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
                match (job.client.dashboard(), job.client.hosts(), job.client.guests()) {
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

fn apply_theme(ctx: &egui::Context) {
    let mut style = (*ctx.style()).clone();
    style.visuals.dark_mode = true;
    style.visuals.panel_fill = Color32::from_rgb(10, 10, 15);
    style.visuals.window_fill = Color32::from_rgb(16, 18, 26);
    style.visuals.override_text_color = Some(Color32::from_rgb(220, 230, 240));
    style.visuals.widgets.inactive.bg_fill = Color32::from_rgb(28, 34, 48);
    style.visuals.widgets.hovered.bg_fill = Color32::from_rgb(0, 80, 100);
    style.visuals.widgets.active.bg_fill = Color32::from_rgb(0, 140, 160);
    style.visuals.selection.bg_fill = Color32::from_rgb(0, 120, 140);
    style.spacing.item_spacing = Vec2::new(8.0, 6.0);
    ctx.set_style(style);
}

fn metric_card(ui: &mut Ui, label: &str, value: &str) {
    Frame::group(ui.style())
        .fill(Color32::from_rgb(18, 24, 36))
        .stroke(Stroke::new(1.0_f32, Color32::from_rgb(0, 100, 120)))
        .corner_radius(CornerRadius::same(8))
        .inner_margin(12.0)
        .show(ui, |ui| {
            ui.set_min_width(110.0);
            ui.label(RichText::new(label).small().weak());
            ui.label(RichText::new(value).strong().size(20.0).color(Color32::from_rgb(0, 229, 255)));
        });
}

fn state_dot(ui: &mut Ui, state: &str) {
    let color = match state.to_lowercase().as_str() {
        "online" | "running" => Color32::from_rgb(40, 220, 120),
        "offline" | "stopped" => Color32::from_rgb(120, 130, 140),
        "error" | "paused" => Color32::from_rgb(255, 180, 60),
        "maintenance" => Color32::from_rgb(255, 120, 80),
        _ => Color32::from_rgb(100, 140, 180),
    };
    let (rect, _) = ui.allocate_exact_size(Vec2::splat(10.0), Sense::hover());
    ui.painter().circle_filled(rect.center(), 4.5, color);
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
