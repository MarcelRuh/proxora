//! Create VM / container forms.

use super::host_picker;
use crate::app::shared::{Page, Shared, Tag};
use crate::net::{seg, CreateOptions, CreatedGuest, IpNetwork, Kind, Resource};
use crate::theme::{self, c};
use crate::ui::format;
use crate::ui::widgets::{self as w, Btn};
use eframe::egui::{self, RichText, Ui};
use egui_phosphor::regular as ph;
use serde_json::{json, Value};
use std::time::Duration;

pub struct CreatePage {
    kind: Kind,
    host: Option<String>,
    node: String,
    options: Resource<CreateOptions>,
    vmid: String,
    vmid_touched: bool,
    name: String,
    // VM
    iso: String,
    iso2: String,
    disk_storage: String,
    disk_size: String,
    bus: String,
    scsihw: String,
    cpu: String,
    // LXC
    template: String,
    password: String,
    swap: String,
    dhcp: bool,
    network: Option<IpNetwork>,
    ipv4: String,
    gateway: String,
    unprivileged: bool,
    nesting: bool,
    // shared
    cores: String,
    memory: String,
    bridge: String,
    vlan: String,
    start_after: bool,
    error: Option<String>,
}

impl CreatePage {
    pub fn new(kind: Kind) -> Self {
        Self {
            kind,
            host: None,
            node: String::new(),
            options: Resource::new(),
            vmid: String::new(),
            vmid_touched: false,
            name: String::new(),
            iso: String::new(),
            iso2: String::new(),
            disk_storage: String::new(),
            disk_size: if kind == Kind::Vm { "32".into() } else { "8".into() },
            bus: "scsi".into(),
            scsihw: "virtio-scsi-single".into(),
            cpu: String::new(),
            template: String::new(),
            password: String::new(),
            swap: "512".into(),
            dhcp: false,
            network: None,
            ipv4: String::new(),
            gateway: String::new(),
            unprivileged: true,
            nesting: true,
            cores: "2".into(),
            memory: if kind == Kind::Vm { "2048".into() } else { "1024".into() },
            bridge: String::new(),
            vlan: String::new(),
            start_after: true,
            error: None,
        }
    }

    fn load(&mut self, sh: &mut Shared) {
        sh.ensure_hosts();
        let Some(host) = self.host.clone() else {
            return;
        };
        let key = format!("{host}:{}", self.node);
        if self.options.set_key(&key) && !self.vmid_touched {
            self.vmid.clear();
        }
        let client = sh.client.clone();
        let node = self.node.clone();
        self.options.ensure(&sh.ctx, Duration::from_secs(30), sh.epoch(Tag::Guests), || {
            move || {
                let q = if node.is_empty() { String::new() } else { format!("node={}&", seg(&node)) };
                client.get::<CreateOptions>(&format!("/api/hosts/{}/options?{q}media=1", seg(&host)))
            }
        });
    }

    pub fn ui(&mut self, ui: &mut Ui, sh: &mut Shared) {
        let kind = self.kind;
        let perm = kind.perm("create");
        let title = if kind == Kind::Vm { "VM erstellen" } else { "Container erstellen" };
        let mut back = false;
        w::page_header(ui, title, Some("Neuer Gast auf einem Proxmox-Host"), |ui| {
            if ui.add(Btn::secondary("Abbrechen").icon(ph::X)).clicked() {
                back = true;
            }
        });
        if back {
            sh.go(if kind == Kind::Vm { Page::Vms } else { Page::Containers });
            return;
        }
        let user = sh.user.clone();
        egui::ScrollArea::vertical().auto_shrink([false, false]).show(ui, |ui| {
            ui.set_max_width(820.0);
            w::section(ui, "Ziel", |_| {}, |ui| {
                ui.horizontal(|ui| {
                    ui.label(w::label("Host"));
                    host_picker(ui, sh, &mut self.host, |h| h.online() && user.can_host(h, &perm));
                    if let Some(h) = self.host.as_ref().and_then(|id| sh.host(id)) {
                        if h.is_peer() {
                            w::badge(ui, "Peer-Host", c::CYAN);
                        }
                    }
                });
                self.load(sh);
                if self.host.is_none() {
                    ui.label(w::muted("Kein Host verfügbar, auf dem du Gäste anlegen darfst."));
                    return;
                }
                let Some(opts) = self.options.data.clone() else {
                    if let Some(err) = self.options.error.clone() {
                        w::error_box(ui, &err);
                    } else {
                        w::skeleton(ui, 3);
                    }
                    return;
                };
                if !self.vmid_touched && self.vmid.is_empty() && opts.nextid > 0 {
                    self.vmid = opts.nextid.to_string();
                }
                ui.add_space(8.0);
                egui::Grid::new("create_target").num_columns(2).spacing([16.0, 10.0]).show(ui, |ui| {
                    let nodes: Vec<(String, String)> = opts.nodes.iter().map(|n| (n.node.clone(), n.node.clone())).collect();
                    if self.node.is_empty() {
                        if let Some((n, _)) = nodes.first() {
                            self.node = n.clone();
                        }
                    }
                    if nodes.len() > 1 {
                        ui.label(w::label("Node"));
                        w::combo(ui, "create_node", &mut self.node, &nodes, 200.0);
                        ui.end_row();
                    }
                    ui.label(w::label("ID"));
                    ui.horizontal(|ui| {
                        if w::text_input(ui, &mut self.vmid, "", 90.0).changed() {
                            self.vmid_touched = true;
                        }
                        let id: u64 = self.vmid.trim().parse().unwrap_or(0);
                        if opts.used_vmids.contains(&id) {
                            ui.label(RichText::new("ID belegt").color(c::DANGER).font(theme::medium(12.0)));
                        }
                    });
                    ui.end_row();
                    ui.label(w::label(if kind == Kind::Vm { "Name" } else { "Hostname" }));
                    w::text_input(ui, &mut self.name, if kind == Kind::Vm { "web-01" } else { "pihole" }, 260.0);
                    ui.end_row();
                });
            });
            let Some(opts) = self.options.data.clone() else {
                return;
            };
            ui.add_space(12.0);
            if kind == Kind::Vm {
                self.vm_fields(ui, &opts);
            } else {
                self.lxc_fields(ui, &opts);
            }
            ui.add_space(12.0);
            w::section(ui, "Ressourcen & Netzwerk", |_| {}, |ui| {
                egui::Grid::new("create_res").num_columns(2).spacing([16.0, 10.0]).show(ui, |ui| {
                    ui.label(w::label("Kerne"));
                    w::text_input(ui, &mut self.cores, "2", 90.0);
                    ui.end_row();
                    ui.label(w::label("RAM (MiB)"));
                    ui.horizontal(|ui| {
                        w::text_input(ui, &mut self.memory, "2048", 90.0);
                        for preset in ["1024", "2048", "4096", "8192", "16384"] {
                            if ui.add(Btn::ghost(preset).small().selected(self.memory == preset)).clicked() {
                                self.memory = preset.into();
                            }
                        }
                    });
                    ui.end_row();
                    if kind == Kind::Lxc {
                        ui.label(w::label("Swap (MiB)"));
                        w::text_input(ui, &mut self.swap, "512", 90.0);
                        ui.end_row();
                    }
                    let bridges: Vec<(String, String)> = opts
                        .bridges
                        .iter()
                        .map(|b| crate::net::vstr(b, "iface"))
                        .filter(|b| !b.is_empty())
                        .map(|b| (b.clone(), b))
                        .collect();
                    if self.bridge.is_empty() {
                        if let Some((b, _)) = bridges.first() {
                            self.bridge = b.clone();
                        }
                    }
                    ui.label(w::label("Bridge"));
                    ui.horizontal(|ui| {
                        w::combo(ui, "create_bridge", &mut self.bridge, &bridges, 140.0);
                        ui.label(w::small("VLAN"));
                        w::text_input(ui, &mut self.vlan, "–", 60.0);
                    });
                    ui.end_row();
                });
                if kind == Kind::Lxc {
                    ui.add_space(8.0);
                    self.lxc_network(ui, &opts);
                }
            });
            ui.add_space(12.0);
            ui.checkbox(&mut self.start_after, "Nach dem Erstellen starten");
            if let Some(err) = &self.error {
                ui.add_space(8.0);
                w::callout(ui, ph::WARNING_CIRCLE, c::DANGER, err);
            }
            ui.add_space(14.0);
            let creating = sh.op_prefix_running("create:");
            let label = if kind == Kind::Vm { "VM erstellen" } else { "Container erstellen" };
            if ui.add(Btn::primary(label).icon(ph::PLUS).loading(creating)).clicked() {
                self.submit(sh, &opts);
            }
            ui.add_space(30.0);
        });
    }

    fn vm_fields(&mut self, ui: &mut Ui, opts: &CreateOptions) {
        w::section(ui, "Installation & Disk", |_| {}, |ui| {
            egui::Grid::new("create_vm").num_columns(2).spacing([16.0, 10.0]).show(ui, |ui| {
                let mut isos: Vec<(String, String)> = vec![(String::new(), "kein ISO".into())];
                isos.extend(opts.isos.iter().map(|i| (i.volid.clone(), i.volid.rsplit('/').next().unwrap_or(&i.volid).to_owned())));
                ui.label(w::label("ISO"));
                if w::combo(ui, "create_iso", &mut self.iso, &isos, 320.0) {
                    let lower = self.iso.to_lowercase();
                    if lower.contains("win") {
                        self.cpu = "host".into();
                        if let Some(v) = opts.isos.iter().find(|i| i.volid.to_lowercase().contains("virtio")) {
                            self.iso2 = v.volid.clone();
                        }
                    }
                }
                ui.end_row();
                ui.label(w::label("Zweites ISO"));
                w::combo(ui, "create_iso2", &mut self.iso2, &isos, 320.0);
                ui.end_row();
                let storages: Vec<(String, String)> = opts
                    .storage
                    .iter()
                    .filter(|s| s.supports("images"))
                    .map(|s| (s.storage.clone(), format!("{} · {} frei", s.storage, format::bytes(s.avail))))
                    .collect();
                if self.disk_storage.is_empty() {
                    if let Some((s, _)) = storages.first() {
                        self.disk_storage = s.clone();
                    }
                }
                ui.label(w::label("Disk-Storage"));
                w::combo(ui, "create_disk_storage", &mut self.disk_storage, &storages, 320.0);
                ui.end_row();
                ui.label(w::label("Disk (GiB)"));
                ui.horizontal(|ui| {
                    w::text_input(ui, &mut self.disk_size, "32", 80.0);
                    w::combo(ui, "create_bus", &mut self.bus, &[("scsi".into(), "SCSI".into()), ("virtio".into(), "VirtIO Block".into()), ("sata".into(), "SATA".into())], 130.0);
                });
                ui.end_row();
                ui.label(w::label("Controller"));
                w::combo(ui, "create_scsihw", &mut self.scsihw, &[("virtio-scsi-single".into(), "VirtIO SCSI single".into()), ("virtio-scsi".into(), "VirtIO SCSI".into())], 200.0);
                ui.end_row();
                ui.label(w::label("CPU-Typ"));
                w::combo(ui, "create_cpu", &mut self.cpu, &[(String::new(), "Standard".into()), ("host".into(), "host".into()), ("kvm64".into(), "kvm64".into())], 160.0);
                ui.end_row();
            });
            if self.iso.to_lowercase().contains("win") {
                ui.add_space(6.0);
                w::callout(ui, ph::INFO, c::CYAN, "Windows-ISO erkannt: Proxora setzt OVMF, q35, EFI- und TPM-Disk und drückt beim Start die Leertaste für den CD-Boot.");
            }
        });
    }

    fn lxc_fields(&mut self, ui: &mut Ui, opts: &CreateOptions) {
        w::section(ui, "Vorlage & Disk", |_| {}, |ui| {
            egui::Grid::new("create_lxc").num_columns(2).spacing([16.0, 10.0]).show(ui, |ui| {
                let templates: Vec<(String, String)> = opts
                    .templates
                    .iter()
                    .map(|t| (t.volid.clone(), t.volid.rsplit('/').next().unwrap_or(&t.volid).to_owned()))
                    .collect();
                if self.template.is_empty() {
                    if let Some((t, _)) = templates.first() {
                        self.template = t.clone();
                    }
                }
                ui.label(w::label("Vorlage"));
                if templates.is_empty() {
                    ui.label(w::muted("Keine Vorlagen — unter „Vorlagen & ISOs“ herunterladen."));
                } else {
                    w::combo(ui, "create_tpl", &mut self.template, &templates, 360.0);
                }
                ui.end_row();
                ui.label(w::label("Root-Passwort"));
                w::password_input(ui, &mut self.password, "mind. 5 Zeichen", 220.0);
                ui.end_row();
                let storages: Vec<(String, String)> = opts
                    .storage
                    .iter()
                    .filter(|s| s.supports("rootdir"))
                    .map(|s| (s.storage.clone(), format!("{} · {} frei", s.storage, format::bytes(s.avail))))
                    .collect();
                if self.disk_storage.is_empty() {
                    if let Some((s, _)) = storages.first() {
                        self.disk_storage = s.clone();
                    }
                }
                ui.label(w::label("Storage"));
                w::combo(ui, "create_ct_storage", &mut self.disk_storage, &storages, 320.0);
                ui.end_row();
                ui.label(w::label("Disk (GiB)"));
                w::text_input(ui, &mut self.disk_size, "8", 80.0);
                ui.end_row();
                ui.label(w::label("Optionen"));
                ui.horizontal(|ui| {
                    ui.checkbox(&mut self.unprivileged, "Unprivilegiert");
                    ui.checkbox(&mut self.nesting, "Nesting");
                });
                ui.end_row();
            });
        });
    }

    fn lxc_network(&mut self, ui: &mut Ui, opts: &CreateOptions) {
        ui.horizontal(|ui| {
            ui.label(w::label("IPv4"));
            if ui.add(Btn::secondary("Statisch").small().selected(!self.dhcp)).clicked() {
                self.dhcp = false;
            }
            if ui.add(Btn::secondary("DHCP").small().selected(self.dhcp)).clicked() {
                self.dhcp = true;
            }
        });
        if self.dhcp {
            return;
        }
        if self.network.is_none() {
            self.network = opts.networks.first().cloned();
        }
        let nets: Vec<(Option<IpNetwork>, String)> = opts
            .networks
            .iter()
            .map(|n| (Some(n.clone()), format!("{}/{} · GW {}", n.id, n.prefix, n.gateway)))
            .collect();
        ui.horizontal(|ui| {
            ui.label(w::small("Netz"));
            let before = self.network.clone();
            w::combo(ui, "create_net", &mut self.network, &nets, 260.0);
            let vmid: u64 = self.vmid.trim().parse().unwrap_or(0);
            if (before != self.network || self.ipv4.is_empty()) && vmid > 0 {
                if let Some(n) = &self.network {
                    let base: Vec<&str> = n.id.split('.').collect();
                    if base.len() == 4 && vmid < 255 {
                        self.ipv4 = format!("{}.{}.{}.{vmid}/{}", base[0], base[1], base[2], n.prefix);
                    }
                    self.gateway = n.gateway.clone();
                }
            }
        });
        ui.horizontal(|ui| {
            ui.label(w::small("Adresse"));
            w::text_input(ui, &mut self.ipv4, "192.168.1.50/24", 180.0);
            ui.label(w::small("Gateway"));
            w::text_input(ui, &mut self.gateway, "192.168.1.1", 140.0);
        });
        let addr = self.ipv4.split('/').next().unwrap_or("");
        if !addr.is_empty() && opts.used_ips.iter().any(|ip| ip == addr) {
            ui.label(RichText::new("IP ist bereits vergeben").color(c::DANGER).font(theme::medium(12.0)));
        }
    }

    fn submit(&mut self, sh: &mut Shared, opts: &CreateOptions) {
        self.error = None;
        let Some(host) = self.host.clone() else {
            return;
        };
        let Ok(vmid) = self.vmid.trim().parse::<u64>() else {
            self.error = Some("Die ID muss eine Zahl sein.".into());
            return;
        };
        if self.name.trim().is_empty() {
            self.error = Some("Name fehlt.".into());
            return;
        }
        let num = |s: &str| s.trim().parse::<u64>().ok();
        let (Some(cores), Some(memory)) = (num(&self.cores), num(&self.memory)) else {
            self.error = Some("Kerne und RAM müssen Zahlen sein.".into());
            return;
        };
        let node = if self.node.is_empty() { opts.nodes.first().map(|n| n.node.clone()).unwrap_or_default() } else { self.node.clone() };
        let kind = self.kind;
        let mut body = match kind {
            Kind::Vm => {
                let mut b = json!({
                    "node": node, "vmid": vmid, "name": self.name.trim(), "memory": memory, "cores": cores,
                    "diskStorage": self.disk_storage, "diskSize": self.disk_size.trim(), "bridge": self.bridge,
                    "diskBus": self.bus, "scsihw": self.scsihw, "discard": true, "ssd": true,
                });
                if !self.iso.is_empty() {
                    b["iso"] = json!(self.iso);
                }
                if !self.iso2.is_empty() {
                    b["iso2"] = json!(self.iso2);
                }
                if !self.cpu.is_empty() {
                    b["cpu"] = json!(self.cpu);
                }
                b
            }
            Kind::Lxc => {
                if self.password.len() < 5 {
                    self.error = Some("Das Root-Passwort braucht mindestens 5 Zeichen.".into());
                    return;
                }
                if self.template.is_empty() {
                    self.error = Some("Bitte eine Vorlage wählen.".into());
                    return;
                }
                let mut b = json!({
                    "node": node, "vmid": vmid, "hostname": self.name.trim(), "password": self.password,
                    "ostemplate": self.template, "storage": self.disk_storage, "diskSize": self.disk_size.trim(),
                    "cores": cores, "memory": memory, "bridge": self.bridge, "swap": num(&self.swap).unwrap_or(512),
                    "unprivileged": self.unprivileged, "nesting": self.nesting,
                });
                if self.dhcp {
                    b["ipv4"] = json!("dhcp");
                } else {
                    b["ipv4"] = json!(self.ipv4.trim());
                    if !self.gateway.trim().is_empty() {
                        b["gateway"] = json!(self.gateway.trim());
                    }
                }
                b
            }
        };
        if let Some(vlan) = num(&self.vlan) {
            body["vlan"] = json!(vlan);
        }
        let path = format!("/api/hosts/{}/{}", seg(&host), kind.api());
        let name = self.name.trim().to_owned();
        let start = self.start_after;
        let windows = self.iso.to_lowercase().contains("win");
        let host2 = host.clone();
        let node2 = node.clone();
        sh.run_task_then(
            format!("create:{host}:{vmid}"),
            format!("{} {name} ({vmid}) erstellen", kind.label()),
            &host,
            &[Tag::Guests],
            move |c| {
                let created: CreatedGuest = c.post(&path, &body)?;
                Ok(json!({ "upid": created.upid, "vmid": created.vmid }))
            },
            move |sh| {
                if start {
                    let gpath = crate::app::shared::guest_path(&host2, kind, &node2, vmid);
                    let gpath2 = gpath.clone();
                    sh.run_task(
                        format!("guest:{host2}:{}:{vmid}", kind.key()),
                        format!("Start · {name}"),
                        &host2,
                        &[Tag::Guests],
                        move |c| {
                            let r = c.post::<Value>(&gpath, &json!({ "action": "start", "wait": false }))?;
                            if windows {
                                let _ = c.post::<Value>(&gpath2, &json!({ "action": "nudge-cd-boot", "wait": false }));
                            }
                            Ok(r)
                        },
                    );
                }
                sh.open_guest(&host2, &node2, vmid, kind);
            },
        );
        self.vmid.clear();
        self.vmid_touched = false;
        self.name.clear();
        self.password.clear();
        self.ipv4.clear();
    }
}
