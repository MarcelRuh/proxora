use crate::app::shared::{Shared, Tag};
use crate::net::{
    seg, AccountSession, CpuTemps, DiskAlerts, EmbedsResponse, GuestIpSettings, IpNetwork,
    NotificationsResponse, Pending, RecoveryCodes, Resource, SessionsResponse, SettingsResponse,
    SuiteApp, TotpBegin, TotpState, ApiResult,
};
use crate::theme::{self, c};
use crate::ui::format;
use crate::ui::widgets::{self as w, Btn};
use crate::updater::{UpdateCmd, UpdateState, APP_VERSION};
use eframe::egui::{self, Align, Layout, RichText, Ui};
use egui_phosphor::regular as ph;
use serde_json::{json, Value};
use std::collections::BTreeSet;
use std::time::Duration;

#[derive(Clone, Copy, PartialEq, Eq)]
enum Tab {
    Account,
    App,
    Networks,
    Alerts,
    Notifications,
    Suite,
}

#[derive(Default)]
struct Totp {
    begin: Option<TotpBegin>,
    code: String,
    password: String,
    recovery: Vec<String>,
    pending: Option<Pending<ApiResult<Value>>>,
}

#[derive(Default)]
struct NewChannel {
    open: bool,
    kind: String,
    name: String,
    url: String,
    smtp_host: String,
    smtp_port: String,
    smtp_user: String,
    smtp_pass: String,
    from: String,
    to: String,
}

pub struct SettingsPage {
    tab: Tab,
    // account
    pw_current: String,
    pw_new: String,
    pw_repeat: String,
    totp_state: Resource<TotpState>,
    totp: Totp,
    sessions: Resource<SessionsResponse>,
    // networks
    settings: Resource<SettingsResponse>,
    ip: Option<GuestIpSettings>,
    ip_host: Option<String>,
    // alerts
    disk: Resource<DiskAlerts>,
    temp: Resource<CpuTemps>,
    disk_alert: String,
    disk_clear: String,
    temp_alert: String,
    temp_clear: String,
    // notifications
    notif: Resource<NotificationsResponse>,
    events: std::collections::HashMap<String, BTreeSet<String>>,
    new_channel: NewChannel,
    // suite
    embeds: Resource<EmbedsResponse>,
    apps: Option<Vec<SuiteApp>>,
    // app
    server_url: String,
}

impl Default for SettingsPage {
    fn default() -> Self {
        Self {
            tab: Tab::Account,
            pw_current: String::new(),
            pw_new: String::new(),
            pw_repeat: String::new(),
            totp_state: Resource::new(),
            totp: Totp::default(),
            sessions: Resource::new(),
            settings: Resource::new(),
            ip: None,
            ip_host: None,
            disk: Resource::new(),
            temp: Resource::new(),
            disk_alert: String::new(),
            disk_clear: String::new(),
            temp_alert: String::new(),
            temp_clear: String::new(),
            notif: Resource::new(),
            events: Default::default(),
            new_channel: NewChannel { kind: "discord".into(), smtp_port: "587".into(), ..Default::default() },
            embeds: Resource::new(),
            apps: None,
            server_url: String::new(),
        }
    }
}

impl SettingsPage {
    pub fn ui(&mut self, ui: &mut Ui, sh: &mut Shared) {
        w::page_header(ui, "Einstellungen", Some("Konto, Desktop-App und Server-Einstellungen"), |_| {});
        let mut tabs = vec![(Tab::Account, "Konto & Sicherheit"), (Tab::App, "Desktop-App")];
        if sh.user.can("settings.view") {
            tabs.push((Tab::Networks, "Gast-Netze"));
            tabs.push((Tab::Alerts, "Alarme"));
            tabs.push((Tab::Suite, "Suite-Apps"));
        }
        if sh.user.can("notifications.view") {
            tabs.push((Tab::Notifications, "Benachrichtigungen"));
        }
        w::tabs(ui, &mut self.tab, &tabs);
        egui::ScrollArea::vertical().auto_shrink([false, false]).show(ui, |ui| {
            ui.set_max_width(860.0);
            match self.tab {
                Tab::Account => self.account(ui, sh),
                Tab::App => self.app(ui, sh),
                Tab::Networks => self.networks(ui, sh),
                Tab::Alerts => self.alerts(ui, sh),
                Tab::Notifications => self.notifications(ui, sh),
                Tab::Suite => self.suite(ui, sh),
            }
            ui.add_space(30.0);
        });
    }

    // ------------------------------------------------------------ account

    fn account(&mut self, ui: &mut Ui, sh: &mut Shared) {
        let (c1, c2) = (sh.client.clone(), sh.client.clone());
        let epoch = sh.epoch(Tag::Account);
        self.totp_state.ensure(&sh.ctx, Duration::from_secs(120), epoch, || move || c1.get::<TotpState>("/api/account/totp"));
        self.sessions.ensure(&sh.ctx, Duration::from_secs(60), epoch, || move || c2.get::<SessionsResponse>("/api/account/sessions"));

        w::section(ui, "Profil", |_| {}, |ui| {
            w::kv_grid(ui, "profile", &[
                ("Benutzer", sh.user.username.clone()),
                ("E-Mail", sh.user.email.clone()),
                ("Rolle", sh.user.role.name.clone()),
                ("Server", sh.client.host_label()),
            ]);
        });
        ui.add_space(12.0);

        w::section(ui, "Passwort ändern", |_| {}, |ui| {
            egui::Grid::new("pw").num_columns(2).spacing([16.0, 9.0]).show(ui, |ui| {
                ui.label(w::label("Aktuelles Passwort"));
                w::password_input(ui, &mut self.pw_current, "", 260.0);
                ui.end_row();
                ui.label(w::label("Neues Passwort"));
                w::password_input(ui, &mut self.pw_new, "mind. 10 Zeichen", 260.0);
                ui.end_row();
                ui.label(w::label("Wiederholen"));
                w::password_input(ui, &mut self.pw_repeat, "", 260.0);
                ui.end_row();
            });
            let mismatch = !self.pw_repeat.is_empty() && self.pw_new != self.pw_repeat;
            if mismatch {
                ui.label(RichText::new("Passwörter stimmen nicht überein").color(c::DANGER).font(theme::medium(12.0)));
            }
            ui.add_space(8.0);
            let ok = !self.pw_current.is_empty() && self.pw_new.len() >= 10 && self.pw_new == self.pw_repeat;
            if ui.add(Btn::primary("Passwort ändern").icon(ph::KEY).enabled(ok).loading(sh.op_running("account:pw"))).clicked() {
                let body = json!({ "currentPassword": self.pw_current, "newPassword": self.pw_new });
                sh.run("account:pw", "Passwort geändert — andere Sitzungen wurden beendet", &[Tag::Account], move |c| c.post::<Value>("/api/account/password", &body));
                self.pw_current.clear();
                self.pw_new.clear();
                self.pw_repeat.clear();
            }
        });
        ui.add_space(12.0);
        self.totp_section(ui, sh);
        ui.add_space(12.0);

        let mut revoke: Option<AccountSession> = None;
        w::section(ui, "Aktive Sitzungen", |_| {}, |ui| {
            let Some(data) = &self.sessions.data else {
                w::skeleton(ui, 3);
                return;
            };
            for (i, s) in data.sessions.iter().enumerate() {
                if i > 0 {
                    w::separator(ui);
                }
                ui.horizontal(|ui| {
                    let desktop = s.user_agent.as_deref().is_some_and(|u| u.contains("ProxoraNative"));
                    ui.label(w::icon_text(if desktop { ph::DESKTOP_TOWER } else { ph::BROWSERS }, 18.0, c::MUTED));
                    ui.vertical(|ui| {
                        ui.spacing_mut().item_spacing.y = 1.0;
                        ui.horizontal(|ui| {
                            ui.label(w::strong(agent_label(s.user_agent.as_deref())));
                            if s.current {
                                w::badge(ui, "diese Sitzung", c::OK);
                            }
                        });
                        ui.label(w::small(format!("{} · angemeldet {} · läuft ab {}", s.ip.clone().unwrap_or_default(), format::relative(&s.created_at), format::timestamp(&s.expires_at))));
                    });
                    ui.with_layout(Layout::right_to_left(Align::Center), |ui| {
                        if !s.current && ui.add(Btn::secondary("Beenden").small()).clicked() {
                            revoke = Some(s.clone());
                        }
                    });
                });
            }
        });
        if let Some(s) = revoke {
            sh.confirm("Sitzung beenden?", "Das Gerät wird abgemeldet.", "Beenden", true, move |sh| {
                let path = format!("/api/account/sessions/{}", seg(&s.id));
                sh.run("account:revoke", "Sitzung beendet", &[Tag::Account], move |c| c.delete::<Value>(&path));
            });
        }
    }

    fn totp_section(&mut self, ui: &mut Ui, sh: &mut Shared) {
        if let Some(res) = self.totp.pending.as_ref().and_then(Pending::poll) {
            self.totp.pending = None;
            match res {
                Ok(v) => {
                    if let Ok(b) = serde_json::from_value::<TotpBegin>(v.clone()) {
                        if !b.secret.is_empty() {
                            self.totp.begin = Some(b);
                        }
                    }
                    if let Ok(r) = serde_json::from_value::<RecoveryCodes>(v.clone()) {
                        if !r.recovery_codes.is_empty() {
                            self.totp.recovery = r.recovery_codes;
                            self.totp.begin = None;
                        }
                    }
                    if v.get("enabled").and_then(Value::as_bool) == Some(false) {
                        sh.toasts.success("2FA deaktiviert");
                    }
                    self.totp.code.clear();
                    self.totp.password.clear();
                    sh.bump(Tag::Account);
                }
                Err(e) => sh.toasts.error("2FA", e.message),
            }
        }
        let enabled = self.totp_state.data.as_ref().is_some_and(|t| t.enabled);
        let remaining = self.totp_state.data.as_ref().map(|t| t.recovery_remaining).unwrap_or(0);
        let mut action: Option<Value> = None;
        w::section(ui, "Zwei-Faktor-Anmeldung", |ui| {
            w::badge(ui, if enabled { "aktiv" } else { "aus" }, if enabled { c::OK } else { c::MUTED });
        }, |ui| {
            if !self.totp.recovery.is_empty() {
                w::callout(ui, ph::KEY, c::WARN, "Recovery-Codes jetzt sicher ablegen — sie werden nur einmal angezeigt.");
                ui.add_space(6.0);
                let text = self.totp.recovery.join("\n");
                egui::Grid::new("recovery").num_columns(5).spacing([18.0, 6.0]).show(ui, |ui| {
                    for (i, code) in self.totp.recovery.iter().enumerate() {
                        ui.label(RichText::new(code).font(theme::mono(13.0)).color(c::TEXT));
                        if i % 5 == 4 {
                            ui.end_row();
                        }
                    }
                });
                ui.horizontal(|ui| {
                    if ui.add(Btn::secondary("Kopieren").icon(ph::COPY).small()).clicked() {
                        ui.ctx().copy_text(text.clone());
                    }
                    if ui.add(Btn::ghost("Ausblenden").small()).clicked() {
                        self.totp.recovery.clear();
                    }
                });
                ui.add_space(10.0);
            }
            if let Some(b) = self.totp.begin.clone() {
                ui.label(w::secondary("Secret in der Authenticator-App hinzufügen (oder den QR-Code in der Web-Oberfläche scannen):"));
                ui.horizontal(|ui| {
                    ui.label(RichText::new(&b.secret).font(theme::mono(14.0)).color(c::PINK));
                    w::copy_button(ui, &b.secret);
                    if ui.add(Btn::ghost("otpauth-Link").icon(ph::LINK).small()).clicked() {
                        ui.ctx().copy_text(b.otpauth.clone());
                        sh.toasts.info("otpauth-Link kopiert");
                    }
                });
                ui.horizontal(|ui| {
                    w::text_input(ui, &mut self.totp.code, "6-stelliger Code", 140.0);
                    if ui.add(Btn::primary("Aktivieren").enabled(self.totp.code.trim().len() >= 6)).clicked() {
                        action = Some(json!({ "action": "enable", "secret": b.secret, "code": self.totp.code.trim() }));
                    }
                    if ui.add(Btn::ghost("Abbrechen").small()).clicked() {
                        self.totp.begin = None;
                    }
                });
            } else if enabled {
                ui.label(w::muted(format!("{remaining} Recovery-Codes übrig.")));
                ui.add_space(6.0);
                ui.horizontal(|ui| {
                    w::password_input(ui, &mut self.totp.password, "Passwort", 180.0);
                    w::text_input(ui, &mut self.totp.code, "Code (zum Deaktivieren)", 160.0);
                });
                ui.horizontal(|ui| {
                    if ui.add(Btn::secondary("Neue Recovery-Codes").enabled(!self.totp.password.is_empty())).clicked() {
                        action = Some(json!({ "action": "recovery", "password": self.totp.password }));
                    }
                    if ui.add(Btn::danger("2FA deaktivieren").enabled(!self.totp.password.is_empty() && self.totp.code.trim().len() >= 6)).clicked() {
                        action = Some(json!({ "action": "disable", "code": self.totp.code.trim(), "password": self.totp.password }));
                    }
                });
            } else {
                ui.label(w::muted("Schützt dein Konto zusätzlich mit einem Einmal-Code aus einer Authenticator-App."));
                ui.add_space(6.0);
                if ui.add(Btn::primary("2FA einrichten").icon(ph::SHIELD_CHECK)).clicked() {
                    action = Some(json!({ "action": "begin" }));
                }
            }
        });
        if let Some(body) = action {
            let client = sh.client.clone();
            self.totp.pending = Some(Pending::spawn(&sh.ctx, move || client.post::<Value>("/api/account/totp", &body)));
        }
    }

    // ------------------------------------------------------------ app

    fn app(&mut self, ui: &mut Ui, sh: &mut Shared) {
        if self.server_url.is_empty() {
            self.server_url = sh.prefs.server_url.clone();
        }
        w::section(ui, "Desktop-Version", |ui| {
            ui.label(w::small(format!("v{APP_VERSION}")));
        }, |ui| {
            match sh.native_update.clone() {
                UpdateState::Checking => {
                    ui.horizontal(|ui| {
                        ui.spinner();
                        ui.label(w::secondary("Suche nach Updates …"));
                    });
                }
                UpdateState::UpToDate => {
                    ui.label(w::secondary(format!("Proxora Desktop {APP_VERSION} ist aktuell.")));
                    if ui.add(Btn::secondary("Nach Updates suchen").icon(ph::ARROW_CLOCKWISE).small()).clicked() {
                        let _ = sh.updater.send(UpdateCmd::Check);
                    }
                }
                UpdateState::Available(info) => {
                    ui.label(RichText::new(format!("Version {} ist verfügbar", info.version)).font(theme::semibold(15.0)).color(c::PINK));
                    if !info.notes.trim().is_empty() {
                        ui.add(egui::Label::new(w::muted(info.notes.lines().take(12).collect::<Vec<_>>().join("\n"))).wrap());
                    }
                    ui.horizontal(|ui| {
                        if ui.add(Btn::primary("Herunterladen & installieren").icon(ph::CLOUD_ARROW_DOWN)).clicked() {
                            let _ = sh.updater.send(UpdateCmd::Download(info.clone()));
                        }
                        if ui.add(Btn::ghost("Release-Seite").icon(ph::ARROW_SQUARE_OUT).small()).clicked() {
                            crate::updater::open_url(&info.release_url);
                        }
                    });
                }
                UpdateState::Downloading { info, progress } => {
                    ui.label(w::secondary(format!("Lade {} …", info.version)));
                    w::meter(ui, progress, ui.available_width(), 6.0);
                }
                UpdateState::ReadyToInstall { info, path } => {
                    ui.label(w::secondary(format!("{} ist heruntergeladen.", info.version)));
                    if ui.add(Btn::primary("Installieren & neu starten").icon(ph::ROCKET_LAUNCH)).clicked() {
                        let _ = sh.updater.send(UpdateCmd::Install { path });
                    }
                }
                UpdateState::Error(err) => {
                    w::callout(ui, ph::WARNING, c::WARN, &format!("Update-Prüfung fehlgeschlagen: {err}"));
                    if ui.add(Btn::secondary("Erneut prüfen").small()).clicked() {
                        let _ = sh.updater.send(UpdateCmd::Check);
                    }
                }
            }
            ui.add_space(8.0);
            let mut auto = sh.prefs.auto_check_updates;
            if ui.checkbox(&mut auto, "Beim Start nach Updates suchen").changed() {
                sh.prefs.auto_check_updates = auto;
                sh.save_prefs();
            }
        });
        ui.add_space(12.0);
        w::section(ui, "Darstellung", |_| {}, |ui| {
            ui.horizontal(|ui| {
                ui.label(w::label("Skalierung"));
                for (label, v) in [("90 %", 0.9f32), ("100 %", 1.0), ("110 %", 1.1), ("125 %", 1.25), ("150 %", 1.5)] {
                    if ui.add(Btn::secondary(label).small().selected((sh.prefs.ui_scale - v).abs() < 0.01)).clicked() {
                        sh.prefs.ui_scale = v;
                        sh.save_prefs();
                        ui.ctx().set_zoom_factor(v);
                    }
                }
            });
            ui.label(w::small("Alternativ Strg + / Strg − / Strg 0."));
            let mut collapsed = sh.prefs.sidebar_collapsed;
            if ui.checkbox(&mut collapsed, "Kompakte Seitenleiste (nur Icons)").changed() {
                sh.prefs.sidebar_collapsed = collapsed;
                sh.save_prefs();
            }
        });
        ui.add_space(12.0);
        w::section(ui, "Verbindung", |_| {}, |ui| {
            w::kv_grid(ui, "conn", &[
                ("Server", sh.prefs.server_url.clone()),
                ("Proxora", sh.server_version.clone().unwrap_or_default()),
                ("Zertifikat", if sh.prefs.allow_insecure_tls { "selbstsigniert erlaubt".into() } else { "wird geprüft".into() }),
            ]);
            ui.add_space(8.0);
            let mut remember = sh.prefs.remember_session;
            if ui.checkbox(&mut remember, "Angemeldet bleiben (Sitzung lokal speichern)").changed() {
                sh.prefs.remember_session = remember;
                if remember {
                    sh.prefs.session_token = sh.client.session_cookie();
                } else {
                    sh.prefs.session_token = None;
                }
                sh.save_prefs();
            }
            ui.label(w::small("Die Sitzung liegt unverschlüsselt im Benutzerprofil. Auf geteilten Rechnern deaktivieren."));
            ui.add_space(10.0);
            ui.horizontal(|ui| {
                if ui.add(Btn::secondary("Abmelden").icon(ph::SIGN_OUT)).clicked() {
                    sh.logout = true;
                }
                if ui.add(Btn::ghost("Server wechseln").icon(ph::PLUGS)).clicked() {
                    sh.prefs.server_url.clear();
                    sh.prefs.session_token = None;
                    sh.save_prefs();
                    sh.logout = true;
                }
            });
        });
    }

    // ------------------------------------------------------------ networks

    fn networks(&mut self, ui: &mut Ui, sh: &mut Shared) {
        sh.ensure_hosts();
        let client = sh.client.clone();
        if self.settings.poll() || (self.ip.is_none() && self.settings.data.is_some()) {
            self.ip = self.settings.data.as_ref().map(|s| s.guest_ip());
        }
        self.settings.ensure(&sh.ctx, Duration::from_secs(300), sh.epoch(Tag::Settings), || move || client.get::<SettingsResponse>("/api/settings"));
        let editable = sh.user.can("settings.update");
        let Some(ip) = &mut self.ip else {
            w::skeleton(ui, 4);
            return;
        };
        let hosts: Vec<(Option<String>, String)> = std::iter::once((None, "Standard (alle Hosts)".to_owned()))
            .chain(sh.hosts.data.iter().flatten().filter(|h| !h.is_peer()).map(|h| (Some(h.id.clone()), h.name.clone())))
            .collect();
        let mut save = false;
        let mut scope = self.ip_host.clone();
        w::section(ui, "IP-Pools für Container", |ui| {
            w::combo(ui, "ip_scope", &mut scope, &hosts, 220.0);
        }, |ui| {
            ui.label(w::muted("Beim Anlegen eines Containers wird die Adresse aus Netz + VMID gebildet (z. B. 192.168.178.105)."));
            ui.add_space(8.0);
            let list: &mut Vec<IpNetwork> = match &self.ip_host {
                None => &mut ip.defaults,
                Some(h) => ip.by_host.entry(h.clone()).or_default(),
            };
            let mut remove: Option<usize> = None;
            ui.add_enabled_ui(editable, |ui| {
                egui::Grid::new("ip_nets").num_columns(4).spacing([12.0, 8.0]).show(ui, |ui| {
                    ui.label(w::label("Netz"));
                    ui.label(w::label("Präfix"));
                    ui.label(w::label("Gateway"));
                    ui.end_row();
                    for (i, n) in list.iter_mut().enumerate() {
                        w::text_input(ui, &mut n.id, "192.168.178.0", 160.0);
                        let mut prefix = n.prefix.to_string();
                        if w::text_input(ui, &mut prefix, "24", 50.0).changed() {
                            n.prefix = prefix.trim().parse().unwrap_or(n.prefix);
                        }
                        w::text_input(ui, &mut n.gateway, "192.168.178.1", 160.0);
                        if ui.add(Btn::icon_only(ph::X, "Entfernen").small()).clicked() {
                            remove = Some(i);
                        }
                        ui.end_row();
                    }
                });
                if let Some(i) = remove {
                    list.remove(i);
                }
                ui.add_space(6.0);
                ui.horizontal(|ui| {
                    if ui.add(Btn::secondary("Netz hinzufügen").icon(ph::PLUS).small()).clicked() {
                        list.push(IpNetwork { id: String::new(), prefix: 24, gateway: String::new() });
                    }
                    save = ui.add(Btn::primary("Speichern").icon(ph::FLOPPY_DISK)).clicked();
                });
            });
            if self.ip_host.is_some() && list.is_empty() {
                ui.label(w::small("Leer = Standardnetze gelten für diesen Host."));
            }
        });
        self.ip_host = scope;
        if save {
            if let Some(ip) = &self.ip {
                let mut value = ip.clone();
                value.by_host.retain(|_, v| !v.is_empty());
                sh.run("settings:ip", "Gast-Netze gespeichert", &[Tag::Settings], move |c| c.patch::<Value>("/api/settings", &json!({ "key": "guest-ip", "value": value })));
            }
        }
    }

    // ------------------------------------------------------------ alerts

    fn alerts(&mut self, ui: &mut Ui, sh: &mut Shared) {
        let (c1, c2) = (sh.client.clone(), sh.client.clone());
        let epoch = sh.epoch(Tag::Settings);
        if self.disk.poll() {
            if let Some(d) = &self.disk.data {
                self.disk_alert = format!("{:.0}", d.alert_percent);
                self.disk_clear = format!("{:.0}", d.clear_percent);
            }
        }
        if self.temp.poll() {
            if let Some(t) = &self.temp.data {
                self.temp_alert = format!("{:.0}", t.alert_celsius);
                self.temp_clear = format!("{:.0}", t.clear_celsius);
            }
        }
        self.disk.ensure(&sh.ctx, Duration::from_secs(300), epoch, || move || c1.get::<DiskAlerts>("/api/disk-alerts"));
        self.temp.ensure(&sh.ctx, Duration::from_secs(300), epoch, || move || c2.get::<CpuTemps>("/api/cpu-temp"));
        let editable = sh.user.can("settings.update");
        let mut save_disk = false;
        let mut save_temp = false;
        w::section(ui, "Speicher-Alarm", |_| {}, |ui| {
            ui.add_enabled_ui(editable, |ui| {
                ui.horizontal(|ui| {
                    ui.label(w::label("Alarm ab"));
                    w::text_input(ui, &mut self.disk_alert, "90", 50.0);
                    ui.label(w::small("%  ·  Entwarnung unter"));
                    w::text_input(ui, &mut self.disk_clear, "85", 50.0);
                    ui.label(w::small("%"));
                    save_disk = ui.add(Btn::primary("Speichern").small()).clicked();
                });
            });
            if let Some(d) = &self.disk.data {
                for s in &d.samples {
                    ui.label(w::small(format!("{} · {} · {:.0} %", s.host_name, s.name, s.percent)));
                }
            }
        });
        ui.add_space(12.0);
        w::section(ui, "CPU-Temperatur", |_| {}, |ui| {
            ui.add_enabled_ui(editable, |ui| {
                ui.horizontal(|ui| {
                    ui.label(w::label("Alarm ab"));
                    w::text_input(ui, &mut self.temp_alert, "85", 50.0);
                    ui.label(w::small("°C  ·  Entwarnung unter"));
                    w::text_input(ui, &mut self.temp_clear, "75", 50.0);
                    ui.label(w::small("°C"));
                    save_temp = ui.add(Btn::primary("Speichern").small()).clicked();
                });
            });
        });
        let num = |s: &str| s.trim().parse::<f64>().ok();
        if save_disk {
            if let (Some(a), Some(c)) = (num(&self.disk_alert), num(&self.disk_clear)) {
                sh.run("settings:disk", "Speicher-Alarm gespeichert", &[Tag::Settings, Tag::Storage], move |cl| cl.patch::<Value>("/api/disk-alerts", &json!({ "alertPercent": a, "clearPercent": c })));
            }
        }
        if save_temp {
            if let (Some(a), Some(c)) = (num(&self.temp_alert), num(&self.temp_clear)) {
                sh.run("settings:temp", "Temperatur-Alarm gespeichert", &[Tag::Settings], move |cl| cl.patch::<Value>("/api/cpu-temp", &json!({ "alertCelsius": a, "clearCelsius": c })));
            }
        }
    }

    // ------------------------------------------------------------ notifications

    fn notifications(&mut self, ui: &mut Ui, sh: &mut Shared) {
        let client = sh.client.clone();
        if self.notif.poll() {
            self.events.clear();
        }
        self.notif.ensure(&sh.ctx, Duration::from_secs(120), sh.epoch(Tag::Notifications), || move || client.get::<NotificationsResponse>("/api/notifications"));
        let Some(data) = self.notif.data.clone() else {
            match self.notif.error.clone() {
                Some(e) => {
                    w::error_box(ui, &e);
                }
                None => w::skeleton(ui, 4),
            }
            return;
        };
        let (can_create, can_update, can_delete) = (sh.user.can("notifications.create"), sh.user.can("notifications.update"), sh.user.can("notifications.delete"));
        ui.horizontal(|ui| {
            if ui.add(Btn::primary("Kanal hinzufügen").icon(ph::PLUS).enabled(can_create)).clicked() {
                self.new_channel.open = !self.new_channel.open;
            }
        });
        ui.add_space(10.0);
        if self.new_channel.open {
            self.new_channel_form(ui, sh);
            ui.add_space(12.0);
        }
        for ch in &data.channels {
            let selected = self
                .events
                .entry(ch.id.clone())
                .or_insert_with(|| ch.events.clone().unwrap_or_else(|| data.topics.clone()).into_iter().collect());
            let mut toggle = false;
            let mut save = false;
            let mut test = false;
            let mut delete = false;
            w::section(ui, &ch.name, |ui| {
                let mut on = ch.enabled;
                if ui.add_enabled(can_update, egui::Checkbox::new(&mut on, "aktiv")).changed() {
                    toggle = true;
                }
                w::badge(ui, &ch.kind, c::CYAN);
            }, |ui| {
                ui.label(w::label("Ereignisse"));
                ui.horizontal_wrapped(|ui| {
                    for t in &data.topics {
                        let on = selected.contains(t);
                        if ui.add(Btn::secondary(&topic_label(t)).small().selected(on).enabled(can_update)).clicked() {
                            if on {
                                selected.remove(t);
                            } else {
                                selected.insert(t.clone());
                            }
                        }
                    }
                });
                ui.add_space(8.0);
                ui.horizontal(|ui| {
                    let original: BTreeSet<String> = ch.events.clone().unwrap_or_else(|| data.topics.clone()).into_iter().collect();
                    save = ui.add(Btn::primary("Speichern").small().enabled(can_update && *selected != original)).clicked();
                    test = ui.add(Btn::secondary("Testnachricht").icon(ph::BELL).small().enabled(can_update)).clicked();
                    delete = ui.add(Btn::ghost("Löschen").icon(ph::TRASH).small().enabled(can_delete)).clicked();
                });
            });
            ui.add_space(12.0);
            let path = format!("/api/notifications/{}", seg(&ch.id));
            if toggle {
                let on = !ch.enabled;
                let p = path.clone();
                sh.run("notif:toggle", if on { "Kanal aktiviert" } else { "Kanal deaktiviert" }, &[Tag::Notifications], move |c| c.patch::<Value>(&p, &json!({ "enabled": on })));
            }
            if save {
                let events: Vec<String> = selected.iter().cloned().collect();
                let p = path.clone();
                sh.run("notif:save", "Ereignisse gespeichert", &[Tag::Notifications], move |c| c.patch::<Value>(&p, &json!({ "events": events })));
            }
            if test {
                let p = format!("{path}/test");
                sh.run("notif:test", format!("Testnachricht an {} gesendet", ch.name), &[], move |c| c.post::<Value>(&p, &json!({})));
            }
            if delete {
                let p = path.clone();
                let name = ch.name.clone();
                sh.confirm(format!("Kanal „{name}“ löschen?"), "Es werden keine Meldungen mehr dorthin gesendet.", "Löschen", true, move |sh| {
                    sh.run("notif:delete", format!("{name} gelöscht"), &[Tag::Notifications], move |c| c.delete::<Value>(&p));
                });
            }
        }
        if data.channels.is_empty() {
            w::empty_state(ui, ph::BELL, "Keine Kanäle", "Discord, Webhook oder E-Mail für Meldungen zu Hosts, Backups und Updates.");
        }
    }

    fn new_channel_form(&mut self, ui: &mut Ui, sh: &mut Shared) {
        let f = &mut self.new_channel;
        let mut create = false;
        let mut test = false;
        w::section(ui, "Neuer Kanal", |_| {}, |ui| {
            ui.horizontal(|ui| {
                for (k, l) in [("discord", "Discord"), ("webhook", "Webhook"), ("smtp", "E-Mail (SMTP)")] {
                    if ui.add(Btn::secondary(l).small().selected(f.kind == k)).clicked() {
                        f.kind = k.into();
                    }
                }
            });
            ui.add_space(8.0);
            egui::Grid::new("new_channel").num_columns(2).spacing([16.0, 9.0]).show(ui, |ui| {
                ui.label(w::label("Name"));
                w::text_input(ui, &mut f.name, "Ops-Discord", 280.0);
                ui.end_row();
                if f.kind == "smtp" {
                    for (label, value, hint) in [
                        ("SMTP-Server", &mut f.smtp_host, "smtp.example.de"),
                        ("Port", &mut f.smtp_port, "587"),
                        ("Benutzer", &mut f.smtp_user, ""),
                        ("Absender", &mut f.from, "proxora@example.de"),
                        ("Empfänger", &mut f.to, "ops@example.de"),
                    ] {
                        ui.label(w::label(label));
                        w::text_input(ui, value, hint, 280.0);
                        ui.end_row();
                    }
                    ui.label(w::label("Passwort"));
                    w::password_input(ui, &mut f.smtp_pass, "", 280.0);
                    ui.end_row();
                } else {
                    ui.label(w::label("Webhook-URL"));
                    w::text_input(ui, &mut f.url, "https://discord.com/api/webhooks/…", 420.0);
                    ui.end_row();
                }
            });
            ui.add_space(10.0);
            ui.horizontal(|ui| {
                let ok = !f.name.trim().is_empty() && if f.kind == "smtp" { !f.smtp_host.is_empty() && !f.from.is_empty() && !f.to.is_empty() } else { f.url.starts_with("http") };
                create = ui.add(Btn::primary("Anlegen").enabled(ok)).clicked();
                test = ui.add(Btn::secondary("Testen").icon(ph::BELL).enabled(ok)).clicked();
            });
        });
        let config = if f.kind == "smtp" {
            json!({ "host": f.smtp_host.trim(), "port": f.smtp_port.trim().parse::<u64>().unwrap_or(587), "username": f.smtp_user.trim(), "password": f.smtp_pass, "from": f.from.trim(), "to": f.to.trim() })
        } else {
            json!({ "url": f.url.trim() })
        };
        if test {
            let body = json!({ "type": f.kind, "config": config });
            sh.run("notif:testnew", "Testnachricht gesendet", &[], move |c| c.post::<Value>("/api/notifications/test", &body));
        }
        if create {
            let body = json!({ "type": f.kind, "name": f.name.trim(), "enabled": true, "config": config });
            sh.run("notif:create", "Kanal angelegt", &[Tag::Notifications], move |c| c.post::<Value>("/api/notifications", &body));
            *f = NewChannel { kind: "discord".into(), smtp_port: "587".into(), ..Default::default() };
        }
    }

    // ------------------------------------------------------------ suite

    fn suite(&mut self, ui: &mut Ui, sh: &mut Shared) {
        let client = sh.client.clone();
        if self.embeds.poll() || (self.apps.is_none() && self.embeds.data.is_some()) {
            self.apps = self.embeds.data.as_ref().map(|e| e.apps.clone());
        }
        self.embeds.ensure(&sh.ctx, Duration::from_secs(300), sh.epoch(Tag::Settings), || move || client.get::<EmbedsResponse>("/api/embeds"));
        let editable = sh.user.can("settings.update");
        let Some(apps) = &mut self.apps else {
            w::skeleton(ui, 3);
            return;
        };
        let mut save = false;
        let mut open: Option<String> = None;
        w::section(ui, "Suite-Apps", |_| {}, |ui| {
            ui.label(w::muted("Weitere Oberflächen aus dem Ora-Stack, die Proxora als Proxy einbindet."));
            ui.add_space(8.0);
            let mut remove: Option<usize> = None;
            ui.add_enabled_ui(editable, |ui| {
                for (i, a) in apps.iter_mut().enumerate() {
                    ui.horizontal(|ui| {
                        w::text_input(ui, &mut a.name, "Name", 160.0);
                        w::text_input(ui, &mut a.url, "http://192.168.1.20:3000", 300.0);
                        ui.checkbox(&mut a.insecure_tls, "TLS unsicher");
                        if !a.id.is_empty() && ui.add(Btn::icon_only(ph::ARROW_SQUARE_OUT, "Öffnen").small()).clicked() {
                            open = Some(a.id.clone());
                        }
                        if ui.add(Btn::icon_only(ph::X, "Entfernen").small()).clicked() {
                            remove = Some(i);
                        }
                    });
                }
                if let Some(i) = remove {
                    apps.remove(i);
                }
                ui.add_space(6.0);
                ui.horizontal(|ui| {
                    if ui.add(Btn::secondary("App hinzufügen").icon(ph::PLUS).small()).clicked() {
                        apps.push(SuiteApp::default());
                    }
                    save = ui.add(Btn::primary("Speichern").icon(ph::FLOPPY_DISK)).clicked();
                });
            });
        });
        if let Some(id) = open {
            sh.open_web(&format!("/stack/{}", seg(&id)));
        }
        if save {
            let list = apps.clone();
            sh.run("settings:embeds", "Suite-Apps gespeichert", &[Tag::Settings], move |c| c.patch::<Value>("/api/embeds", &json!({ "apps": list })));
            self.apps = None;
        }
    }
}

fn agent_label(ua: Option<&str>) -> String {
    let ua = ua.unwrap_or("");
    if ua.contains("ProxoraNative") {
        "Proxora Desktop".into()
    } else if ua.contains("ProxoraAndroid") {
        "Proxora Android".into()
    } else if ua.contains("ProxoraDesktop") {
        "Proxora Desktop (Web)".into()
    } else if ua.contains("Firefox") {
        "Firefox".into()
    } else if ua.contains("Edg/") {
        "Edge".into()
    } else if ua.contains("Chrome") {
        "Chrome".into()
    } else if ua.contains("Safari") {
        "Safari".into()
    } else if ua.is_empty() {
        "Unbekannt".into()
    } else {
        ua.chars().take(40).collect()
    }
}

fn topic_label(t: &str) -> String {
    match t {
        "host.online" => "Host online",
        "host.offline" => "Host offline",
        "host.updates" => "Host-Updates",
        "vm.created" => "VM erstellt",
        "lxc.created" => "Container erstellt",
        "vm.deleted" => "VM gelöscht",
        "lxc.deleted" => "Container gelöscht",
        "backup.started" => "Backup gestartet",
        "backup.failed" => "Backup fehlgeschlagen",
        "backup.restored" => "Backup wiederhergestellt",
        "task.failed" => "Task fehlgeschlagen",
        "disk.full" => "Speicher voll",
        "host.cpu.hot" => "CPU zu heiß",
        "zfs.degraded" => "ZFS degradiert",
        "peer.update" => "Peer-Update",
        "proxora.update.failed" => "Self-Update fehlgeschlagen",
        "wireguard.peer.unreachable" => "WireGuard-Peer weg",
        other => other,
    }
    .to_owned()
}
