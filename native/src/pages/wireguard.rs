use crate::app::shared::{Shared, Tag};
use crate::net::{PeerShare, Resource, WgInterface, WgPeer, WireguardResponse};
use crate::theme::{self, c};
use crate::ui::format;
use crate::ui::widgets::{self as w, Btn};
use eframe::egui::{self, Align, Layout, RichText, Ui};
use egui_phosphor::regular as ph;
use serde_json::{json, Value};
use std::collections::HashMap;
use std::time::Duration;

#[derive(Default)]
struct IfaceDraft {
    instance_name: String,
    address: String,
    server_endpoint: String,
    server_public_key: String,
    allowed_ips: String,
    keepalive: String,
}

impl IfaceDraft {
    fn from(i: &WgInterface) -> Self {
        Self {
            instance_name: i.instance_name.clone(),
            address: i.address.clone(),
            server_endpoint: i.server_endpoint.clone(),
            server_public_key: i.server_public_key.clone(),
            allowed_ips: i.allowed_ips.clone(),
            keepalive: i.persistent_keepalive.to_string(),
        }
    }
}

#[derive(Default)]
pub struct WireguardPage {
    data: Resource<WireguardResponse>,
    iface: Option<IfaceDraft>,
    conf: String,
    invite_name: String,
    invite_ip: String,
    invite_secret: String,
    shares: HashMap<String, Vec<PeerShare>>,
}

fn random_secret() -> String {
    let alphabet = b"ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";
    let mut bytes = [0u8; 24];
    if getrandom::fill(&mut bytes).is_err() {
        return String::new();
    }
    bytes.iter().map(|b| alphabet[*b as usize % alphabet.len()] as char).collect()
}

impl WireguardPage {
    pub fn ui(&mut self, ui: &mut Ui, sh: &mut Shared) {
        sh.ensure_hosts();
        let client = sh.client.clone();
        if self.data.poll() {
            if let Some(d) = &self.data.data {
                if self.iface.is_none() {
                    self.iface = Some(IfaceDraft::from(&d.interface));
                }
                for p in &d.peers {
                    self.shares.entry(p.id.clone()).or_insert_with(|| p.shares.clone());
                }
            }
        }
        self.data.ensure(&sh.ctx, Duration::from_secs(10), sh.epoch(Tag::Wireguard), || move || client.get::<WireguardResponse>("/api/wireguard"));
        let mut diagnose = false;
        w::page_header(ui, "WireGuard", Some("Tunnel zu Kollegen-Instanzen und Host-Freigaben"), |ui| {
            if ui.add(Btn::secondary("Diagnose").icon(ph::HEARTBEAT).loading(sh.op_running("wg:diagnose"))).clicked() {
                diagnose = true;
            }
        });
        if diagnose {
            sh.run("wg:diagnose", "Diagnose abgeschlossen", &[Tag::Wireguard], |c| c.post::<Value>("/api/wireguard", &json!({ "action": "diagnose" })));
        }
        let Some(data) = self.data.data.clone() else {
            match self.data.error.clone() {
                Some(e) => {
                    if w::error_box(ui, &e) {
                        self.data.invalidate();
                    }
                }
                None => w::skeleton(ui, 6),
            }
            return;
        };
        egui::ScrollArea::vertical().auto_shrink([false, false]).show(ui, |ui| {
            ui.set_max_width(1000.0);
            self.interface(ui, sh, &data);
            ui.add_space(12.0);
            self.diagnostics(ui, &data);
            ui.add_space(12.0);
            self.peers(ui, sh, &data);
            ui.add_space(12.0);
            self.invite(ui, sh);
            ui.add_space(24.0);
        });
    }

    fn interface(&mut self, ui: &mut Ui, sh: &mut Shared, data: &WireguardResponse) {
        let i = &data.interface;
        let enabled = i.enabled;
        let mut toggle = false;
        let mut save = false;
        w::section(ui, "Tunnel", |ui| {
            let mut on = enabled;
            if ui.checkbox(&mut on, "aktiv").changed() {
                toggle = true;
            }
            w::badge(ui, if data.diagnostics.up { "verbunden" } else { "getrennt" }, if data.diagnostics.up { c::OK } else { c::MUTED });
        }, |ui| {
            let d = self.iface.get_or_insert_with(|| IfaceDraft::from(i));
            egui::Grid::new("wg_iface").num_columns(2).spacing([16.0, 9.0]).show(ui, |ui| {
                ui.label(w::label("Instanzname"));
                w::text_input(ui, &mut d.instance_name, "Proxora", 280.0);
                ui.end_row();
                ui.label(w::label("Adresse"));
                w::text_input(ui, &mut d.address, "10.88.0.2/24", 200.0);
                ui.end_row();
                ui.label(w::label("Server-Endpoint"));
                w::text_input(ui, &mut d.server_endpoint, "vpn.example.de:51820", 280.0);
                ui.end_row();
                ui.label(w::label("Server Public Key"));
                w::text_input(ui, &mut d.server_public_key, "", 360.0);
                ui.end_row();
                ui.label(w::label("AllowedIPs"));
                w::text_input(ui, &mut d.allowed_ips, "10.88.0.0/24", 280.0);
                ui.end_row();
                ui.label(w::label("Keepalive (s)"));
                w::text_input(ui, &mut d.keepalive, "25", 70.0);
                ui.end_row();
                ui.label(w::label("Eigener Public Key"));
                ui.horizontal(|ui| {
                    ui.label(RichText::new(&i.public_key).font(theme::mono(11.5)).color(c::TEXT_2));
                    w::copy_button(ui, &i.public_key);
                });
                ui.end_row();
            });
            ui.add_space(10.0);
            ui.horizontal(|ui| {
                save = ui.add(Btn::primary("Speichern").icon(ph::FLOPPY_DISK)).clicked();
                if !i.server_peer_snippet.is_empty() && ui.add(Btn::ghost("[Peer]-Block kopieren").icon(ph::COPY).small()).clicked() {
                    ui.ctx().copy_text(i.server_peer_snippet.clone());
                    sh.toasts.info("Peer-Block für den WireGuard-Server kopiert");
                }
            });
            ui.add_space(10.0);
            ui.label(w::label(".conf importieren"));
            ui.add(egui::TextEdit::multiline(&mut self.conf).font(theme::mono(11.5)).desired_rows(3).desired_width(f32::INFINITY).hint_text("[Interface]\nPrivateKey = …"));
            if ui.add(Btn::secondary("Importieren").icon(ph::UPLOAD_SIMPLE).small().enabled(self.conf.trim().len() >= 20)).clicked() {
                let config = std::mem::take(&mut self.conf);
                sh.run("wg:import", "Konfiguration importiert", &[Tag::Wireguard], move |c| c.post::<Value>("/api/wireguard", &json!({ "action": "import-conf", "config": config })));
                self.iface = None;
            }
        });
        if toggle {
            let on = !enabled;
            sh.run("wg:toggle", if on { "Tunnel aktiviert" } else { "Tunnel deaktiviert" }, &[Tag::Wireguard], move |c| c.patch::<Value>("/api/wireguard", &json!({ "enabled": on })));
        }
        if save {
            if let Some(d) = &self.iface {
                let body = json!({
                    "instanceName": d.instance_name.trim(), "address": d.address.trim(), "serverEndpoint": d.server_endpoint.trim(),
                    "serverPublicKey": d.server_public_key.trim(), "allowedIPs": d.allowed_ips.trim(),
                    "persistentKeepalive": d.keepalive.trim().parse::<u64>().unwrap_or(25),
                });
                sh.run("wg:save", "Tunnel gespeichert", &[Tag::Wireguard], move |c| c.patch::<Value>("/api/wireguard", &body));
            }
        }
    }

    fn diagnostics(&mut self, ui: &mut Ui, data: &WireguardResponse) {
        let d = &data.diagnostics;
        w::section(ui, "Diagnose", |ui| {
            if let Some(at) = &d.checked_at {
                ui.label(w::small(format!("geprüft {}", format::relative(at))));
            }
        }, |ui| {
            if let Some(err) = d.error.as_ref().filter(|e| !e.is_empty()) {
                w::callout(ui, ph::WARNING_CIRCLE, c::DANGER, err);
                ui.add_space(6.0);
            }
            for h in &d.hints {
                let (icon, color) = match h.level.as_str() {
                    "error" => (ph::WARNING_CIRCLE, c::DANGER),
                    "warn" => (ph::WARNING, c::WARN),
                    _ => (ph::INFO, c::CYAN),
                };
                let params = h.params.clone().unwrap_or_default();
                let p = |k: &str| params.get(k).cloned().unwrap_or_default();
                let text = match h.code.as_str() {
                    "ok" => "Tunnel steht, alle Peers erreichbar.".to_owned(),
                    "disabled" => "Tunnel ist deaktiviert.".to_owned(),
                    "down" => "Interface ist nicht aktiv.".to_owned(),
                    "downError" => format!("Interface-Fehler: {}", p("error")),
                    "noRuntimePeer" => "Kein Server-Peer im laufenden Interface.".to_owned(),
                    "handshakeStale" => "Letzter Handshake ist zu alt — Endpoint oder Firewall prüfen.".to_owned(),
                    "handshakeNever" => "Noch kein Handshake mit dem Server.".to_owned(),
                    "peerAddress" => format!("{}: keine Proxora-IP gesetzt.", p("name")),
                    "allowedIps" => format!("{}: IP {} liegt nicht in AllowedIPs ({}).", p("name"), p("ip"), p("allowed")),
                    "peerSync" => format!("{}: Abgleich fehlgeschlagen — {}", p("name"), p("error")),
                    "http" => format!("{}: API nicht erreichbar — {}", p("name"), p("error")),
                    "version" => format!("{}: Version {} weicht ab (lokal {}).", p("name"), p("peer"), p("local")),
                    "healedAllowedIps" => "AllowedIPs wurden automatisch ergänzt.".to_owned(),
                    other => other.to_owned(),
                };
                w::callout(ui, icon, color, &text);
                ui.add_space(4.0);
            }
            for rp in &d.peers {
                ui.horizontal(|ui| {
                    w::dot(ui, if rp.handshake_ok { c::OK } else { c::WARN });
                    ui.label(w::mono(rp.endpoint.clone()));
                    let age = rp.latest_handshake_age_sec.map(|s| format::relative_secs(s as i64)).unwrap_or_else(|| "nie".into());
                    ui.label(w::small(format!("Handshake {age} · ↓ {} · ↑ {}", format::bytes(rp.transfer_rx), format::bytes(rp.transfer_tx))));
                });
            }
            for r in &d.reachability {
                ui.horizontal(|ui| {
                    w::dot(ui, if r.ok { c::OK } else { c::DANGER });
                    ui.label(w::strong(r.name.clone()));
                    let info = if r.ok { format!("{} ms · v{}", r.ms.unwrap_or(0), r.version.clone().unwrap_or_default()) } else { r.error.clone().unwrap_or_default() };
                    ui.label(w::small(info));
                });
            }
        });
    }

    fn peers(&mut self, ui: &mut Ui, sh: &mut Shared, data: &WireguardResponse) {
        let local_hosts: Vec<(String, String)> = sh.hosts.data.iter().flatten().filter(|h| !h.is_peer()).map(|h| (h.id.clone(), h.name.clone())).collect();
        let mut delete: Option<WgPeer> = None;
        let mut save_shares: Option<String> = None;
        w::section(ui, "Kollegen", |ui| { ui.label(w::small(data.peers.len().to_string())); }, |ui| {
            if data.peers.is_empty() {
                ui.label(w::muted("Noch keine Kollegen-Instanz gekoppelt."));
            }
            for (i, p) in data.peers.iter().enumerate() {
                if i > 0 {
                    w::separator(ui);
                }
                ui.horizontal(|ui| {
                    ui.label(w::icon_text(ph::USERS, 18.0, c::PURPLE));
                    ui.vertical(|ui| {
                        ui.spacing_mut().item_spacing.y = 2.0;
                        ui.horizontal(|ui| {
                            ui.label(w::strong(p.name.clone()));
                            if p.paired {
                                w::badge(ui, "gekoppelt", c::OK);
                            } else {
                                w::badge(ui, "wartet", c::WARN);
                            }
                        });
                        let seen = p.last_seen_at.as_deref().map(format::relative).unwrap_or_else(|| "nie".into());
                        ui.label(w::small(format!("{}:{} · zuletzt {seen}", p.address, p.proxora_port)));
                    });
                    ui.with_layout(Layout::right_to_left(Align::Center), |ui| {
                        if ui.add(Btn::icon_only(ph::TRASH, "Entfernen").small()).clicked() {
                            delete = Some(p.clone());
                        }
                    });
                });
                ui.add_space(4.0);
                ui.label(w::label("Freigaben"));
                let shares = self.shares.entry(p.id.clone()).or_insert_with(|| p.shares.clone());
                egui::Grid::new(("shares", &p.id)).num_columns(2).spacing([16.0, 6.0]).show(ui, |ui| {
                    for (hid, hname) in &local_hosts {
                        ui.label(w::secondary(hname.clone()));
                        let mut level = shares.iter().find(|s| &s.host_id == hid).map(|s| s.level.clone()).unwrap_or_default();
                        let opts: Vec<(String, String)> = vec![
                            (String::new(), "keine".into()),
                            ("view".into(), "ansehen".into()),
                            ("control".into(), "steuern".into()),
                            ("create".into(), "anlegen".into()),
                        ];
                        if w::combo(ui, ("share", &p.id, hid), &mut level, &opts, 140.0) {
                            shares.retain(|s| &s.host_id != hid);
                            if !level.is_empty() {
                                shares.push(PeerShare { host_id: hid.clone(), level, permissions: None });
                            }
                        }
                        ui.end_row();
                    }
                });
                if shares != &p.shares && ui.add(Btn::primary("Freigaben speichern").small()).clicked() {
                    save_shares = Some(p.id.clone());
                }
            }
        });
        if let Some(id) = save_shares {
            let shares = self.shares.get(&id).cloned().unwrap_or_default();
            sh.run("wg:shares", "Freigaben gespeichert", &[Tag::Wireguard], move |c| c.post::<Value>("/api/wireguard", &json!({ "action": "shares", "peerId": id, "shares": shares })));
        }
        if let Some(p) = delete {
            sh.confirm(format!("{} entfernen?", p.name), "Der Kollege verliert den Zugriff auf alle freigegebenen Hosts.", "Entfernen", true, move |sh| {
                sh.run("wg:delete", format!("{} entfernt", p.name), &[Tag::Wireguard, Tag::Hosts], move |c| c.post::<Value>("/api/wireguard", &json!({ "action": "delete-peer", "peerId": p.id })));
            });
        }
    }

    fn invite(&mut self, ui: &mut Ui, sh: &mut Shared) {
        w::section(ui, "Kollegen koppeln", |_| {}, |ui| {
            ui.label(w::muted("Beide Seiten tragen die IP der jeweils anderen Proxora ein und dasselbe Geheimnis."));
            ui.add_space(8.0);
            egui::Grid::new("wg_invite").num_columns(2).spacing([16.0, 9.0]).show(ui, |ui| {
                ui.label(w::label("Name"));
                w::text_input(ui, &mut self.invite_name, "Tim", 220.0);
                ui.end_row();
                ui.label(w::label("IP seiner Proxora"));
                w::text_input(ui, &mut self.invite_ip, "10.88.0.3", 220.0);
                ui.end_row();
                ui.label(w::label("Gemeinsames Geheimnis"));
                ui.horizontal(|ui| {
                    w::text_input(ui, &mut self.invite_secret, "min. 12 Zeichen", 240.0);
                    if ui.add(Btn::ghost("Erzeugen").small()).clicked() {
                        self.invite_secret = random_secret();
                    }
                    if !self.invite_secret.is_empty() {
                        w::copy_button(ui, &self.invite_secret);
                    }
                });
                ui.end_row();
            });
            ui.add_space(10.0);
            let ok = !self.invite_name.trim().is_empty() && self.invite_secret.len() >= 12;
            if ui.add(Btn::primary("Koppeln").icon(ph::LINK).enabled(ok)).clicked() {
                let body = json!({ "action": "create-peer", "name": self.invite_name.trim(), "address": self.invite_ip.trim(), "proxoraPort": 3000, "pairingSecret": self.invite_secret });
                ui.ctx().copy_text(self.invite_secret.clone());
                sh.run("wg:create", "Kollege angelegt — Geheimnis in der Zwischenablage", &[Tag::Wireguard], move |c| c.post::<Value>("/api/wireguard", &body));
                self.invite_name.clear();
                self.invite_ip.clear();
                self.invite_secret.clear();
            }
        });
    }
}
