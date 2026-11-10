//! Client-side mirror of `lib/permissions.ts` + `lib/federation-access.ts`.
//! Only used to hide/disable controls — the server enforces everything.

use super::models::{Host, Kind, SessionUser};
use std::collections::HashSet;

fn aliases(raw: &str) -> &'static [&'static str] {
    match raw {
        "hosts.edit" => &["hosts.update", "hosts.credentials"],
        "vm.edit" => &["vm.config"],
        "vm.files" => &["vm.files.read", "vm.files.write"],
        "vm.stop" => &["vm.force-stop", "vm.shutdown", "vm.reboot", "vm.reset", "vm.pause", "vm.resume"],
        "vm.snapshot" => &["vm.snapshot.create", "vm.snapshot.delete", "vm.snapshot.rollback"],
        "lxc.edit" => &["lxc.config"],
        "lxc.files" => &["lxc.files.read", "lxc.files.write"],
        "lxc.stop" => &["lxc.force-stop", "lxc.shutdown", "lxc.reboot"],
        "lxc.snapshot" => &["lxc.snapshot.create", "lxc.snapshot.delete", "lxc.snapshot.rollback"],
        "storage.manage" => &["storage.view", "storage.delete"],
        "zfs.manage" => &["zfs.view"],
        "backup.manage" => &[
            "backup.run",
            "backup.restore",
            "backup.delete",
            "backup.job.create",
            "backup.job.update",
            "backup.job.delete",
        ],
        "updates.execute" => &["updates.check", "updates.upgrade", "proxora.update"],
        "users.manage" => &["users.create", "users.update", "users.delete"],
        "roles.manage" => &["roles.create", "roles.update", "roles.delete"],
        "settings.manage" => &[
            "settings.update",
            "notifications.view",
            "notifications.create",
            "notifications.update",
            "notifications.delete",
        ],
        _ => &[],
    }
}

pub fn has(granted: &[String], required: &str) -> bool {
    granted
        .iter()
        .any(|g| g == required || aliases(g).contains(&required))
}

fn host_scoped(perm: &str) -> bool {
    if perm == "hosts.create" || perm == "proxora.update" {
        return false;
    }
    ["hosts.", "vm.", "lxc.", "storage.", "zfs.", "backup.", "updates.", "tasks."]
        .iter()
        .any(|p| perm.starts_with(p))
}

fn guest_action(perm: &str) -> bool {
    perm != "vm.create" && perm != "lxc.create" && (perm.starts_with("vm.") || perm.starts_with("lxc."))
}

const SHARE_VIEW: &[&str] = &[
    "hosts.view",
    "vm.view",
    "lxc.view",
    "storage.view",
    "zfs.view",
    "backup.view",
    "updates.view",
    "tasks.view",
];
const SHARE_CREATE_ONLY: &[&str] = &["vm.create", "vm.clone", "lxc.create", "lxc.clone"];
const SHARE_DENY: &[&str] = &[
    "hosts.console",
    "hosts.delete",
    "hosts.credentials",
    "updates.check",
    "updates.upgrade",
];

/// Owner ceiling for hosts shared by a WireGuard peer.
pub fn peer_allows(host: &Host, perm: &str) -> bool {
    if !host.is_peer() {
        return true;
    }
    if let Some(list) = host.share_permissions.as_ref().filter(|l| !l.is_empty()) {
        return has(list, perm);
    }
    match host.share_level.as_deref().unwrap_or("view") {
        "create" => host_scoped(perm) && !SHARE_DENY.contains(&perm),
        "control" => {
            host_scoped(perm) && !SHARE_DENY.contains(&perm) && !SHARE_CREATE_ONLY.contains(&perm)
        }
        _ => SHARE_VIEW.contains(&perm),
    }
}

impl SessionUser {
    /// Same evaluation order as `userHasPermission`: guest override → host override → role.
    pub fn can_at(&self, perm: &str, host_id: Option<&str>, guest: Option<(Kind, u64)>) -> bool {
        let role = &self.role.permissions;
        if !host_scoped(perm) {
            return has(role, perm);
        }
        if let (Some(h), Some((kind, vmid))) = (host_id, guest) {
            if guest_action(perm) {
                let key = format!("{h}:{}:{vmid}", kind.key());
                if let Some(Some(list)) = self.guest_permissions.as_ref().and_then(|m| m.get(&key)) {
                    return has(list, perm);
                }
            }
        }
        if let Some(h) = host_id {
            if let Some(Some(list)) = self.host_permissions.as_ref().and_then(|m| m.get(h)) {
                return has(list, perm);
            }
            return has(role, perm);
        }
        if has(role, perm) {
            return true;
        }
        let any_host = self
            .host_permissions
            .as_ref()
            .is_some_and(|m| m.values().flatten().any(|l| has(l, perm)));
        any_host
            || self
                .guest_permissions
                .as_ref()
                .is_some_and(|m| m.values().flatten().any(|l| has(l, perm)))
    }

    /// Global check (role or any override).
    pub fn can(&self, perm: &str) -> bool {
        self.can_at(perm, None, None)
    }

    pub fn can_any(&self, perms: &[&str]) -> bool {
        perms.iter().any(|p| self.can(p))
    }

    /// Host-scoped check including the peer share ceiling.
    pub fn can_host(&self, host: &Host, perm: &str) -> bool {
        self.can_at(perm, Some(&host.id), None) && peer_allows(host, perm)
    }

    pub fn can_guest(&self, host: Option<&Host>, host_id: &str, kind: Kind, vmid: u64, perm: &str) -> bool {
        self.can_at(perm, Some(host_id), Some((kind, vmid))) && host.is_none_or(|h| peer_allows(h, perm))
    }

    pub fn effective_role_permissions(&self) -> HashSet<String> {
        let mut out = HashSet::new();
        for p in &self.role.permissions {
            out.insert(p.clone());
            for a in aliases(p) {
                out.insert((*a).to_owned());
            }
        }
        out
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::net::models::Role;
    use std::collections::HashMap;

    fn user(perms: &[&str]) -> SessionUser {
        SessionUser {
            role: Role {
                permissions: perms.iter().map(|s| s.to_string()).collect(),
                ..Default::default()
            },
            ..Default::default()
        }
    }

    #[test]
    fn legacy_aliases_expand() {
        let u = user(&["vm.stop"]);
        assert!(u.can("vm.shutdown"));
        assert!(!u.can("vm.start"));
    }

    #[test]
    fn host_override_replaces_role() {
        let mut u = user(&["vm.start"]);
        let mut hp = HashMap::new();
        hp.insert("h1".to_string(), Some(vec!["vm.view".to_string()]));
        u.host_permissions = Some(hp);
        assert!(!u.can_at("vm.start", Some("h1"), None));
        assert!(u.can_at("vm.start", Some("h2"), None));
    }

    #[test]
    fn guest_override_wins() {
        let mut u = user(&[]);
        let mut gp = HashMap::new();
        gp.insert("h1:lxc:101".to_string(), Some(vec!["lxc.start".to_string()]));
        u.guest_permissions = Some(gp);
        assert!(u.can_at("lxc.start", Some("h1"), Some((Kind::Lxc, 101))));
        assert!(!u.can_at("lxc.start", Some("h1"), Some((Kind::Lxc, 102))));
        assert!(u.can("lxc.start"));
    }

    #[test]
    fn peer_levels() {
        let mut h = Host {
            origin: Some("PEER".into()),
            share_level: Some("control".into()),
            ..Default::default()
        };
        assert!(peer_allows(&h, "vm.start"));
        assert!(!peer_allows(&h, "vm.create"));
        assert!(!peer_allows(&h, "hosts.console"));
        h.share_level = Some("view".into());
        assert!(!peer_allows(&h, "vm.start"));
        assert!(peer_allows(&h, "vm.view"));
    }
}
