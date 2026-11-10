use super::shared::Page;
use crate::net::SessionUser;
use egui_phosphor::regular as ph;

pub struct NavItem {
    pub page: Page,
    pub label: &'static str,
    pub icon: &'static str,
    pub group: &'static str,
    /// Visible when the user has any of these (empty = always).
    pub any_of: &'static [&'static str],
}

pub const NAV: &[NavItem] = &[
    NavItem { page: Page::Dashboard, label: "Übersicht", icon: ph::SQUARES_FOUR, group: "Betrieb", any_of: &["hosts.view"] },
    NavItem { page: Page::Hosts, label: "Hosts", icon: ph::DESKTOP_TOWER, group: "Betrieb", any_of: &["hosts.view"] },
    NavItem { page: Page::Vms, label: "VMs", icon: ph::MONITOR, group: "Betrieb", any_of: &["vm.view"] },
    NavItem { page: Page::Containers, label: "Container", icon: ph::CUBE, group: "Betrieb", any_of: &["lxc.view"] },
    NavItem { page: Page::Templates, label: "Vorlagen & ISOs", icon: ph::STACK, group: "Betrieb", any_of: &["lxc.create", "vm.create"] },
    NavItem { page: Page::Scripts, label: "Community-Skripte", icon: ph::SCROLL, group: "Betrieb", any_of: &["hosts.view", "hosts.console"] },
    NavItem { page: Page::Tasks, label: "Aufgaben", icon: ph::LIST_CHECKS, group: "Betrieb", any_of: &["tasks.view"] },
    NavItem { page: Page::Storage, label: "Storage", icon: ph::HARD_DRIVES, group: "Daten", any_of: &["storage.view", "zfs.view"] },
    NavItem { page: Page::Backups, label: "Backups", icon: ph::ARCHIVE, group: "Daten", any_of: &["backup.view"] },
    NavItem { page: Page::Updates, label: "Updates", icon: ph::PACKAGE, group: "System", any_of: &["updates.view"] },
    NavItem { page: Page::Proxora, label: "Proxora", icon: ph::ROCKET_LAUNCH, group: "System", any_of: &["proxora.update", "updates.view"] },
    NavItem { page: Page::Users, label: "Benutzer", icon: ph::USERS, group: "System", any_of: &["users.view"] },
    NavItem { page: Page::Roles, label: "Rollen", icon: ph::SHIELD_CHECK, group: "System", any_of: &["roles.view"] },
    NavItem { page: Page::Audit, label: "Audit-Log", icon: ph::CLIPBOARD_TEXT, group: "System", any_of: &["audit.view"] },
    NavItem { page: Page::Wireguard, label: "WireGuard", icon: ph::TREE_STRUCTURE, group: "System", any_of: &["peers.manage"] },
    NavItem { page: Page::Settings, label: "Einstellungen", icon: ph::GEAR, group: "System", any_of: &[] },
];

pub fn visible(item: &NavItem, user: &SessionUser) -> bool {
    item.any_of.is_empty() || user.can_any(item.any_of)
}

pub fn title(page: Page) -> &'static str {
    match page {
        Page::CreateVm => "VM erstellen",
        Page::CreateLxc => "Container erstellen",
        other => NAV.iter().find(|i| i.page == other).map(|i| i.label).unwrap_or("Proxora"),
    }
}

pub fn icon(page: Page) -> &'static str {
    match page {
        Page::CreateVm => ph::MONITOR,
        Page::CreateLxc => ph::CUBE,
        other => NAV.iter().find(|i| i.page == other).map(|i| i.icon).unwrap_or(ph::CIRCLE),
    }
}

pub fn start_page(user: &SessionUser) -> Page {
    if user.can("hosts.view") {
        Page::Dashboard
    } else if user.can("lxc.view") {
        Page::Containers
    } else if user.can("vm.view") {
        Page::Vms
    } else {
        Page::Settings
    }
}
