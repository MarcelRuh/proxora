pub mod audit;
pub mod auth;
pub mod backups;
pub mod create;
pub mod dashboard;
pub mod files;
pub mod guest_detail;
pub mod guests;
pub mod hosts;
pub mod proxora;
pub mod roles;
pub mod scripts;
pub mod settings;
pub mod storage;
pub mod tasks;
pub mod templates;
pub mod updates;
pub mod users;
pub mod wireguard;

use crate::app::shared::{Page, Shared};
use crate::net::Kind;
use eframe::egui::Ui;

pub struct Pages {
    dashboard: dashboard::DashboardPage,
    hosts: hosts::HostsPage,
    vms: guests::GuestsPage,
    containers: guests::GuestsPage,
    create_vm: create::CreatePage,
    create_lxc: create::CreatePage,
    templates: templates::TemplatesPage,
    scripts: scripts::ScriptsPage,
    tasks: tasks::TasksPage,
    storage: storage::StoragePage,
    backups: backups::BackupsPage,
    updates: updates::UpdatesPage,
    proxora: proxora::ProxoraPage,
    users: users::UsersPage,
    roles: roles::RolesPage,
    audit: audit::AuditPage,
    wireguard: wireguard::WireguardPage,
    settings: settings::SettingsPage,
}

impl Default for Pages {
    fn default() -> Self {
        Self {
            dashboard: Default::default(),
            hosts: Default::default(),
            vms: guests::GuestsPage::new(Kind::Vm),
            containers: guests::GuestsPage::new(Kind::Lxc),
            create_vm: create::CreatePage::new(Kind::Vm),
            create_lxc: create::CreatePage::new(Kind::Lxc),
            templates: Default::default(),
            scripts: Default::default(),
            tasks: Default::default(),
            storage: Default::default(),
            backups: Default::default(),
            updates: Default::default(),
            proxora: Default::default(),
            users: Default::default(),
            roles: Default::default(),
            audit: Default::default(),
            wireguard: Default::default(),
            settings: Default::default(),
        }
    }
}

impl Pages {
    #[cfg(feature = "demo")]
    pub fn demo_config_tab(&mut self) {
        self.vms.demo_config_tab();
    }

    pub fn show(&mut self, page: Page, ui: &mut Ui, sh: &mut Shared) {
        match page {
            Page::Dashboard => self.dashboard.ui(ui, sh),
            Page::Hosts => self.hosts.ui(ui, sh),
            Page::Vms => self.vms.ui(ui, sh),
            Page::Containers => self.containers.ui(ui, sh),
            Page::CreateVm => self.create_vm.ui(ui, sh),
            Page::CreateLxc => self.create_lxc.ui(ui, sh),
            Page::Templates => self.templates.ui(ui, sh),
            Page::Scripts => self.scripts.ui(ui, sh),
            Page::Tasks => self.tasks.ui(ui, sh),
            Page::Storage => self.storage.ui(ui, sh),
            Page::Backups => self.backups.ui(ui, sh),
            Page::Updates => self.updates.ui(ui, sh),
            Page::Proxora => self.proxora.ui(ui, sh),
            Page::Users => self.users.ui(ui, sh),
            Page::Roles => self.roles.ui(ui, sh),
            Page::Audit => self.audit.ui(ui, sh),
            Page::Wireguard => self.wireguard.ui(ui, sh),
            Page::Settings => self.settings.ui(ui, sh),
        }
    }
}

/// Host picker used by host-scoped pages. Returns the selected host id.
pub fn host_picker(ui: &mut Ui, sh: &Shared, selected: &mut Option<String>, filter: impl Fn(&crate::net::Host) -> bool) {
    let hosts: Vec<(Option<String>, String)> = sh
        .hosts
        .data
        .as_ref()
        .map(|hs| {
            hs.iter()
                .filter(|h| filter(h))
                .map(|h| {
                    let suffix = if h.is_peer() {
                        format!(" · {}", h.peer_name.clone().unwrap_or_else(|| "Peer".into()))
                    } else {
                        String::new()
                    };
                    (Some(h.id.clone()), format!("{}{suffix}", h.name))
                })
                .collect()
        })
        .unwrap_or_default();
    if selected.is_none() || !hosts.iter().any(|(id, _)| id == selected) {
        *selected = hosts.first().and_then(|(id, _)| id.clone());
    }
    match hosts.len() {
        0 => {}
        1 => {
            ui.label(crate::ui::widgets::strong(hosts[0].1.clone()));
        }
        _ => {
            crate::ui::widgets::combo(ui, "host_picker", selected, &hosts, 220.0);
        }
    }
}
