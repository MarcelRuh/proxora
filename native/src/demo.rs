//! Offline fixtures for UI snapshots (`--features demo`).

use crate::app::shared::Page;
use crate::net::{ApiError, Client, Kind, Role, SessionUser};
use crate::prefs::Prefs;
use crate::ProxoraApp;
use eframe::egui;
use serde_json::{json, Value};
use std::sync::Arc;

pub const SCENES: &[&str] = &[
    "login", "dashboard", "vms", "vm-detail", "vm-config", "containers", "hosts", "host-detail", "tasks",
    "storage", "backups", "updates", "templates", "scripts", "users", "roles", "audit", "wireguard",
    "settings", "proxora", "create-vm", "create-lxc", "palette",
];

fn user() -> SessionUser {
    SessionUser {
        id: "u1".into(),
        username: "marcel".into(),
        email: "marcel@example.de".into(),
        role: Role {
            id: "r1".into(),
            slug: "super-admin".into(),
            name: "Super-Admin".into(),
            permissions: ALL_PERMS.iter().map(|s| s.to_string()).collect(),
        },
        ..Default::default()
    }
}

const ALL_PERMS: &[&str] = &[
    "hosts.view", "hosts.create", "hosts.update", "hosts.credentials", "hosts.delete", "hosts.reboot", "hosts.shutdown", "hosts.console",
    "vm.view", "vm.create", "vm.config", "vm.delete", "vm.start", "vm.shutdown", "vm.force-stop", "vm.reboot", "vm.reset", "vm.pause", "vm.resume",
    "vm.console", "vm.files.read", "vm.files.write", "vm.snapshot.create", "vm.snapshot.delete", "vm.snapshot.rollback", "vm.clone", "vm.migrate",
    "lxc.view", "lxc.create", "lxc.config", "lxc.delete", "lxc.start", "lxc.shutdown", "lxc.force-stop", "lxc.reboot", "lxc.console",
    "lxc.files.read", "lxc.files.write", "lxc.snapshot.create", "lxc.snapshot.delete", "lxc.snapshot.rollback", "lxc.clone", "lxc.migrate",
    "storage.view", "storage.delete", "zfs.view", "backup.view", "backup.run", "backup.restore", "backup.delete", "backup.job.create",
    "backup.job.update", "backup.job.delete", "updates.view", "updates.check", "updates.upgrade", "proxora.update", "users.view", "users.create",
    "users.update", "users.delete", "roles.view", "roles.create", "roles.update", "roles.delete", "audit.view", "tasks.view", "tasks.cancel",
    "settings.view", "settings.update", "peers.manage", "notifications.view", "notifications.create", "notifications.update", "notifications.delete",
];

const GIB: u64 = 1024 * 1024 * 1024;

fn host(id: &str, name: &str, state: &str, cluster: Option<&str>, apt: u64, peer: Option<&str>) -> Value {
    json!({
        "id": id, "name": name, "url": format!("https://{name}.lan:8006"), "authType": "API_TOKEN", "username": "root@pam",
        "tokenId": "manager", "allowInsecureTls": true, "connectionState": state, "lastSeenAt": "2026-11-09T23:40:00.000Z",
        "lastError": if state == "ERROR" { json!("Unable to connect: timeout") } else { Value::Null },
        "proxmoxVersion": "9.0.11", "clusterName": cluster, "isClusterMember": cluster.is_some(), "notes": "Rack 2 · USV-gesichert",
        "aptUpdateCount": apt, "aptCheckedAt": "2026-11-09T21:10:00.000Z",
        "origin": if peer.is_some() { "PEER" } else { "LOCAL" }, "peerName": peer, "shareLevel": if peer.is_some() { json!("control") } else { Value::Null },
    })
}

fn hosts() -> Value {
    json!({ "hosts": [
        host("h1", "pve-main", "ONLINE", Some("lab"), 12, None),
        host("h2", "pve-backup", "ONLINE", None, 0, None),
        host("h3", "pve-edge", "ERROR", None, 0, None),
        host("h4", "tim-pve", "ONLINE", None, 3, Some("Tim")),
    ]})
}

fn guest(vmid: u64, name: &str, status: &str, host: &str, host_name: &str, node: &str, cpu: f64, mem_gib: f64, max_gib: u64, ip: &str, tags: &str) -> Value {
    let running = status == "running";
    json!({
        "vmid": vmid, "name": name, "node": node, "status": status, "cpu": if running { cpu } else { 0.0 }, "cpus": 4,
        "mem": if running { (mem_gib * GIB as f64) as u64 } else { 0 }, "maxmem": max_gib * GIB, "disk": 0, "maxdisk": 64 * GIB,
        "uptime": if running { 3 * 86400 + 4 * 3600 } else { 0 }, "template": false, "tags": tags,
        "hostId": host, "hostName": host_name, "hostOwner": Value::Null, "ips": if ip.is_empty() { json!([]) } else { json!([ip]) },
    })
}

fn guests() -> Value {
    json!({
        "vms": [
            guest(101, "web-01", "running", "h1", "pve-main", "pve1", 0.18, 3.1, 8, "192.168.178.101", "prod;web"),
            guest(102, "db-01", "running", "h1", "pve-main", "pve1", 0.41, 12.6, 16, "192.168.178.102", "prod;db"),
            guest(103, "win11-ws", "stopped", "h1", "pve-main", "pve2", 0.0, 0.0, 8, "", "desk"),
            guest(104, "gitlab", "running", "h1", "pve-main", "pve2", 0.77, 7.2, 8, "192.168.178.104", "dev"),
            guest(110, "k8s-node-1", "running", "h2", "pve-backup", "pve-backup", 0.32, 5.5, 8, "10.0.0.11", "k8s"),
            guest(111, "k8s-node-2", "paused", "h2", "pve-backup", "pve-backup", 0.0, 0.0, 8, "10.0.0.12", "k8s"),
            guest(200, "pbs", "running", "h2", "pve-backup", "pve-backup", 0.07, 1.9, 4, "192.168.178.200", "backup"),
        ],
        "containers": [
            guest(300, "pihole", "running", "h1", "pve-main", "pve1", 0.02, 0.2, 1, "192.168.178.53", "dns"),
            guest(301, "nginx-proxy", "running", "h1", "pve-main", "pve1", 0.04, 0.4, 1, "192.168.178.80", "web"),
            guest(302, "homeassistant", "running", "h1", "pve-main", "pve2", 0.11, 1.4, 4, "192.168.178.60", "home"),
            guest(303, "mqtt", "stopped", "h2", "pve-backup", "pve-backup", 0.0, 0.0, 1, "", "home"),
            guest(304, "grafana", "running", "h4", "tim-pve", "tim-pve", 0.05, 0.6, 2, "10.88.0.30", "monitoring"),
        ],
    })
}

fn dashboard() -> Value {
    json!({
        "hosts": { "total": 4, "online": 3, "offline": 0, "warning": 1, "items": [
            { "id": "h1", "name": "pve-main", "url": "", "connectionState": "ONLINE", "proxmoxVersion": "9.0.11", "clusterName": "lab", "isClusterMember": true, "origin": "LOCAL",
              "cpu": 0.31, "cpuCores": 32, "memUsed": 71 * GIB, "memTotal": 128 * GIB, "diskUsed": 2900 * GIB, "diskTotal": 3600 * GIB, "uptime": 41 * 86400, "nodeCount": 2, "onlineNodes": 2, "cpuTempC": 61.0, "cpuTempState": "value" },
            { "id": "h2", "name": "pve-backup", "url": "", "connectionState": "ONLINE", "proxmoxVersion": "9.0.11", "isClusterMember": false, "origin": "LOCAL",
              "cpu": 0.12, "cpuCores": 8, "memUsed": 22 * GIB, "memTotal": 32 * GIB, "diskUsed": 9100 * GIB, "diskTotal": 16000 * GIB, "uptime": 12 * 86400, "cpuTempC": 48.0, "cpuTempState": "value" },
            { "id": "h3", "name": "pve-edge", "url": "", "connectionState": "ERROR", "proxmoxVersion": "8.4.1", "isClusterMember": false, "origin": "LOCAL", "lastError": "Host did not respond in time" },
            { "id": "h4", "name": "tim-pve", "url": "", "connectionState": "ONLINE", "proxmoxVersion": "9.0.10", "isClusterMember": false, "origin": "PEER", "peerName": "Tim", "shareLevel": "control",
              "cpu": 0.08, "cpuCores": 12, "memUsed": 9 * GIB, "memTotal": 64 * GIB, "diskUsed": 400 * GIB, "diskTotal": 1800 * GIB, "uptime": 5 * 86400 },
        ]},
        "virtualization": { "vms": 7, "lxc": 5, "running": 9, "stopped": 2, "paused": 1 },
        "resources": { "cpu": 0.21, "memUsed": 102 * GIB, "memTotal": 224 * GIB, "diskUsed": 12400 * GIB, "diskTotal": 21400 * GIB },
        "cpuTempAlertC": 85,
    })
}

fn guest_detail() -> Value {
    json!({
        "status": { "vmid": 101, "name": "web-01", "status": "running", "qmpstatus": "running", "cpu": 0.18, "cpus": 4, "mem": (3.1 * GIB as f64) as u64,
            "maxmem": 8 * GIB, "netin": 18_400_000_000u64, "netout": 9_200_000_000u64, "uptime": 3 * 86400 + 4 * 3600, "ha": { "managed": 0 } },
        "config": { "name": "web-01", "memory": "8192", "cores": "4", "sockets": "1", "cpu": "x86-64-v2-AES", "ostype": "l26", "scsihw": "virtio-scsi-single",
            "scsi0": "local-zfs:vm-101-disk-0,iothread=1,size=64G", "ide2": "none,media=cdrom", "net0": "virtio=BC:24:11:2A:7F:01,bridge=vmbr0,firewall=1",
            "boot": "order=scsi0;ide2", "agent": "1", "onboot": "1", "tags": "prod;web", "description": "Nginx + PHP-FPM für die Website.", "digest": "abc" },
        "snapshots": [
            { "name": "vor-update", "description": "Vor dem PHP-8.4-Update", "snaptime": 1_762_500_000, "vmstate": 0 },
            { "name": "baseline", "snaptime": 1_760_000_000, "vmstate": 1 },
            { "name": "current", "running": 1 },
        ],
        "agentDisk": { "used": 21 * GIB, "total": 62 * GIB },
        "agentEnabled": true,
        "ips": ["192.168.178.101", "fd00::101"],
    })
}

fn host_status() -> Value {
    json!({
        "host": "pve-main", "cpuTempAlertC": 85,
        "nodes": [
            { "node": "pve1", "online": "online", "status": { "cpu": 0.34, "memory": { "used": 41 * GIB, "total": 64 * GIB }, "rootfs": { "used": 38 * GIB, "total": 94 * GIB }, "uptime": 41 * 86400, "cpuTempC": 61.0, "cpuTempHot": false, "cpuTempState": "value" } },
            { "node": "pve2", "online": "online", "status": { "cpu": 0.27, "memory": { "used": 30 * GIB, "total": 64 * GIB }, "rootfs": { "used": 22 * GIB, "total": 94 * GIB }, "uptime": 40 * 86400, "cpuTempC": 57.0, "cpuTempHot": false, "cpuTempState": "value" } },
        ],
        "vms": guests()["vms"].as_array().unwrap().iter().filter(|g| g["hostId"] == "h1").cloned().collect::<Vec<_>>(),
        "containers": guests()["containers"].as_array().unwrap().iter().filter(|g| g["hostId"] == "h1").cloned().collect::<Vec<_>>(),
        "storage": [ { "storage": "local", "type": "dir" }, { "storage": "local-zfs", "type": "zfspool" }, { "storage": "nas-backup", "type": "nfs" } ],
    })
}

fn tasks() -> Value {
    let now = chrono::Utc::now().timestamp();
    json!({ "tasks": [
        { "upid": "UPID:pve1:0001:01:6911A000:vzdump:101:root@pam:", "node": "pve1", "starttime": now - 40, "type": "vzdump", "id": "101", "user": "root@pam", "guestName": "web-01", "guestKind": "vm" },
        { "upid": "UPID:pve1:0002:01:6911A001:qmstart:102:marcel@pve:", "node": "pve1", "starttime": now - 600, "endtime": now - 590, "type": "qmstart", "id": "102", "user": "marcel@pve", "status": "OK", "guestName": "db-01", "guestKind": "vm" },
        { "upid": "UPID:pve2:0003:01:6911A002:qmigrate:104:marcel@pve:", "node": "pve2", "starttime": now - 3600, "endtime": now - 3300, "type": "qmigrate", "id": "104", "user": "marcel@pve", "status": "OK", "guestName": "gitlab", "guestKind": "vm" },
        { "upid": "UPID:pve1:0004:01:6911A003:aptupdate::root@pam:", "node": "pve1", "starttime": now - 7200, "endtime": now - 7140, "type": "aptupdate", "id": "", "user": "root@pam", "status": "OK" },
        { "upid": "UPID:pve2:0005:01:6911A004:vzstart:303:marcel@pve:", "node": "pve2", "starttime": now - 9000, "endtime": now - 8990, "type": "vzstart", "id": "303", "user": "marcel@pve", "status": "startup for container '303' failed", "guestName": "mqtt", "guestKind": "lxc" },
    ]})
}

fn route(method: &str, path: &str, _body: Option<&Value>) -> Result<Value, ApiError> {
    let (p, _query) = path.split_once('?').unwrap_or((path, ""));
    let v = match (method, p) {
        ("GET", "/api/health") => json!({ "status": "ok", "version": "2.4.18", "name": "Proxora" }),
        ("GET", "/api/auth/me") => json!({ "user": null }),
        ("GET", "/api/hosts") => hosts(),
        ("GET", "/api/dashboard") => dashboard(),
        ("GET", "/api/dashboard/guests") => guests(),
        ("GET", "/api/updates/summary") => json!({ "total": 15, "hosts": [ { "id": "h1", "name": "pve-main", "count": 12 }, { "id": "h4", "name": "tim-pve", "count": 3 } ] }),
        ("GET", "/api/system/self-update") => json!({ "enabled": true, "mode": "compose", "sidecar": "ready", "currentVersion": "2.4.18", "updateAvailable": true, "targetVersion": "2.5.0", "message": "Update available", "updating": false, "imageReady": true, "repo": "MarcelRuh/proxora", "branch": "main", "targetTag": "v2.5.0", "changelog": "- Neue Desktop-App\n- Schnellere Gastlisten" }),
        ("GET", "/api/disk-alerts") => json!({ "alertPercent": 90, "clearPercent": 85, "samples": [ { "key": "s1", "kind": "storage", "name": "local-zfs", "percent": 91.4, "hostId": "h1", "hostName": "pve-main", "node": "pve1" } ] }),
        ("GET", "/api/cpu-temp") => json!({ "alertCelsius": 85, "clearCelsius": 75, "samples": [] }),
        ("GET", "/api/hosts/h1/vms/pve1/101") => guest_detail(),
        ("GET", "/api/hosts/h1/status") => host_status(),
        ("GET", "/api/hosts/h1/cluster") => json!({ "clustered": true, "name": "lab", "quorate": true, "nodes": [ { "name": "pve1", "online": true, "ip": "192.168.178.10" }, { "name": "pve2", "online": true, "ip": "192.168.178.11" } ], "haGroups": [], "replications": [] }),
        (_, p) if p.ends_with("/tasks") => tasks(),
        (_, p) if p.ends_with("/firewall") => json!({ "options": { "enable": 1, "policy_in": "DROP", "policy_out": "ACCEPT" }, "rules": [ { "pos": 0, "type": "in", "action": "ACCEPT", "enable": 1, "proto": "tcp", "dport": "443", "comment": "HTTPS" }, { "pos": 1, "type": "in", "action": "ACCEPT", "enable": 1, "proto": "tcp", "dport": "22", "source": "192.168.178.0/24", "comment": "SSH intern" } ] }),
        _ => return demo_extra(method, p),
    };
    Ok(v)
}

/// Fixtures for the admin / data pages (kept separate for readability).
fn demo_extra(method: &str, p: &str) -> Result<Value, ApiError> {
    let now = chrono::Utc::now();
    let iso = |mins: i64| (now - chrono::Duration::minutes(mins)).to_rfc3339();
    let v = match (method, p) {
        ("GET", p) if p.ends_with("/storage") => json!({ "storage": [ { "node": "pve1", "storage": [
            { "storage": "local", "type": "dir", "content": "iso,vztmpl,backup", "active": 1, "used": 38 * GIB, "avail": 56 * GIB, "total": 94 * GIB },
            { "storage": "local-zfs", "type": "zfspool", "content": "images,rootdir", "active": 1, "used": 1640 * GIB, "avail": 160 * GIB, "total": 1800 * GIB },
            { "storage": "nas-backup", "type": "nfs", "content": "backup", "active": 1, "shared": 1, "used": 5200 * GIB, "avail": 2800 * GIB, "total": 8000 * GIB } ] } ] }),
        ("GET", p) if p.ends_with("/zfs") => json!({ "zfs": [ { "node": "pve1", "pools": [ { "name": "rpool", "health": "ONLINE", "size": 1800 * GIB, "alloc": 1640 * GIB, "free": 160 * GIB, "frag": 21, "healthSummary": { "allHealthy": true, "healthyDisks": 2, "totalDisks": 2, "problemDisks": 0, "devices": [] } } ] } ] }),
        ("GET", p) if p.ends_with("/backups") => json!({ "nodes": ["pve1", "pve2"], "primaryNode": "pve1", "backupStorages": ["nas-backup", "local"], "diskStorages": ["local-zfs"],
            "jobs": [ { "id": "backup-1", "enabled": true, "schedule": "02:00", "storage": "nas-backup", "mode": "snapshot", "compress": "zstd", "all": true, "vmid": "", "node": "", "prune": "keep-last=7", "keepLast": 7 },
                      { "id": "backup-2", "enabled": false, "schedule": "sat 04:00", "storage": "local", "mode": "stop", "compress": "zstd", "all": false, "vmid": "102,104", "node": "pve1", "prune": "", "keepLast": 3 } ],
            "guests": [ { "vmid": 101, "name": "web-01", "kind": "vm", "node": "pve1", "status": "running" }, { "vmid": 102, "name": "db-01", "kind": "vm", "node": "pve1", "status": "running" } ] }),
        ("GET", p) if p.ends_with("/backups/files") => json!({ "files": [
            { "volid": "nas-backup:backup/vzdump-qemu-101-2026_11_09-02_00_03.vma.zst", "node": "pve1", "storage": "nas-backup", "vmid": 101, "kind": "vm", "size": 14 * GIB, "ctime": (now.timestamp() - 80000) * 1000 },
            { "volid": "nas-backup:backup/vzdump-qemu-102-2026_11_09-02_10_44.vma.zst", "node": "pve1", "storage": "nas-backup", "vmid": 102, "kind": "vm", "size": 41 * GIB, "ctime": (now.timestamp() - 79000) * 1000 },
            { "volid": "nas-backup:backup/vzdump-lxc-300-2026_11_09-02_31_12.tar.zst", "node": "pve1", "storage": "nas-backup", "vmid": 300, "kind": "lxc", "size": GIB / 2, "ctime": (now.timestamp() - 78000) * 1000 },
            { "volid": "nas-backup:backup/vzdump-qemu-999-2026_10_01-02_00_00.vma.zst", "node": "pve1", "storage": "nas-backup", "vmid": 999, "kind": "vm", "size": 9 * GIB, "ctime": (now.timestamp() - 3_400_000) * 1000 } ] }),
        ("GET", p) if p.ends_with("/updates") => json!({ "version": "9.0.11", "updates": [ { "node": "pve1", "count": 12, "packages": [
            { "Package": "pve-manager", "OldVersion": "9.0.10", "Version": "9.0.11" }, { "Package": "proxmox-kernel-6.14", "OldVersion": "6.14.8-2", "Version": "6.14.11-1" },
            { "Package": "openssl", "OldVersion": "3.5.1-1", "Version": "3.5.4-1" }, { "Package": "zfsutils-linux", "OldVersion": "2.3.3-pve1", "Version": "2.3.4-pve1" } ] }, { "node": "pve2", "count": 0, "packages": [] } ] }),
        ("GET", p) if p.ends_with("/templates") => json!({ "nodes": ["pve1"], "node": "pve1", "storages": ["local"], "installed": ["local:vztmpl/debian-13-standard_13.1-1_amd64.tar.zst"], "catalog": [
            { "template": "debian-13-standard_13.1-2_amd64.tar.zst", "package": "debian-13-standard", "version": "13.1-2", "section": "system", "headline": "Debian 13 (standard)", "os": "debian", "installed": false },
            { "template": "ubuntu-24.04-standard_24.04-2_amd64.tar.zst", "package": "ubuntu-24.04-standard", "version": "24.04-2", "section": "system", "headline": "Ubuntu 24.04 (standard)", "os": "ubuntu", "installed": true, "volid": "local:vztmpl/ubuntu-24.04-standard_24.04-2_amd64.tar.zst" },
            { "template": "alpine-3.22-default_20250617_amd64.tar.xz", "package": "alpine-3.22-default", "version": "20250617", "section": "system", "headline": "Alpine 3.22", "os": "alpine", "installed": false } ], "usedBy": {} }),
        ("GET", p) if p.ends_with("/isos") => json!({ "nodes": ["pve1"], "node": "pve1", "storages": ["local"], "installed": ["local:iso/debian-13.1.0-amd64-netinst.iso"], "catalog": [
            { "key": "debian", "headline": "Debian 13 netinst", "section": "Linux", "url": "", "installedVersion": "13.1.0", "installedFilename": "debian-13.1.0-amd64-netinst.iso", "installedVolids": ["local:iso/debian-13.1.0-amd64-netinst.iso"], "latestVersion": "13.2.0", "latestFilename": "debian-13.2.0-amd64-netinst.iso", "updateAvailable": true },
            { "key": "virtio", "headline": "VirtIO-Treiber (Windows)", "section": "Treiber", "url": "", "installedVersion": "", "installedFilename": "", "installedVolids": [], "latestVersion": "0.1.271", "latestFilename": "virtio-win-0.1.271.iso", "updateAvailable": false } ], "usedBy": {} }),
        ("GET", "/api/community-scripts") => json!({ "scripts": [
            { "id": "1", "name": "Home Assistant OS", "slug": "haos-vm", "description": "Home-Automation-Plattform als VM mit Supervisor.", "kind": "vm", "categoryIds": ["home"], "port": 8123, "privileged": false, "updateable": true, "defaultCpu": 2, "defaultRamMb": 4096, "defaultDiskGb": 32 },
            { "id": "2", "name": "Pi-hole", "slug": "pihole", "description": "Netzwerkweiter Werbeblocker und DNS-Server.", "kind": "lxc", "categoryIds": ["network"], "port": 80, "privileged": false, "updateable": true, "defaultCpu": 1, "defaultRamMb": 512, "defaultDiskGb": 2 },
            { "id": "3", "name": "Jellyfin", "slug": "jellyfin", "description": "Freier Medienserver für Filme, Serien und Musik.", "kind": "lxc", "categoryIds": ["media"], "port": 8096, "privileged": true, "updateable": true, "defaultCpu": 2, "defaultRamMb": 2048, "defaultDiskGb": 8 },
            { "id": "4", "name": "PVE Post Install", "slug": "post-pve-install", "description": "Repos bereinigen, Subscription-Hinweis entfernen, Updates.", "kind": "pve", "categoryIds": ["pve"], "privileged": false, "updateable": false } ],
            "categories": [ { "id": "home", "name": "Hausautomation" }, { "id": "network", "name": "Netzwerk" }, { "id": "media", "name": "Medien" }, { "id": "pve", "name": "Proxmox-Tools" } ], "total": 412, "stale": false }),
        ("GET", "/api/users") => json!({ "users": [
            { "id": "u1", "username": "marcel", "email": "marcel@example.de", "status": "ACTIVE", "totpEnabled": true, "lastLoginAt": iso(3), "createdAt": iso(90000), "roleId": "r1", "role": { "id": "r1", "name": "Super-Admin", "slug": "super-admin", "permissions": [] }, "hosts": [], "guests": [] },
            { "id": "u2", "username": "tim", "email": "tim@example.de", "status": "ACTIVE", "totpEnabled": false, "lastLoginAt": iso(1500), "createdAt": iso(40000), "roleId": "r3", "role": { "id": "r3", "name": "Operator", "slug": "operator", "permissions": [] }, "hosts": [ { "hostId": "h1", "permissions": null } ], "guests": [] },
            { "id": "u3", "username": "praktikant", "email": "p@example.de", "status": "DISABLED", "totpEnabled": false, "lastLoginAt": null, "createdAt": iso(5000), "roleId": "r5", "role": { "id": "r5", "name": "Nothing", "slug": "nothing", "permissions": [] }, "hosts": [], "guests": [ { "hostId": "h1", "kind": "lxc", "vmid": 300, "permissions": null } ] } ] }),
        ("GET", "/api/roles") => json!({ "roles": [
            { "id": "r1", "name": "Super-Admin", "slug": "super-admin", "description": "Alle Rechte.", "isSystem": true, "permissions": ALL_PERMS, "_count": { "users": 1 } },
            { "id": "r2", "name": "Administrator", "slug": "administrator", "description": "Alles außer Benutzer, Rollen und Proxora-Update.", "isSystem": true, "permissions": ["hosts.view", "vm.view", "lxc.view"], "_count": { "users": 0 } },
            { "id": "r3", "name": "Operator", "slug": "operator", "description": "Gäste bedienen, Konsole, Dateien.", "isSystem": true, "permissions": ["hosts.view", "vm.view", "vm.start"], "_count": { "users": 1 } },
            { "id": "r6", "name": "Backup-Team", "slug": "backup-team", "description": "Backups und Restores.", "isSystem": false, "permissions": ["backup.view", "backup.run", "backup.restore"], "_count": { "users": 0 } } ],
            "catalog": ALL_PERMS.iter().map(|p| json!({ "id": p, "group": p.split('.').next().unwrap_or(""), "de": p, "en": p })).collect::<Vec<_>>(),
            "groups": [ { "id": "hosts", "de": "Hosts", "en": "Hosts" }, { "id": "vm", "de": "Virtuelle Maschinen", "en": "VMs" }, { "id": "lxc", "de": "Container", "en": "Containers" } ] }),
        ("GET", p) if p.starts_with("/api/audit") => json!({ "logs": [
            { "id": "a1", "ip": "192.168.178.20", "action": "VM_STARTED", "target": "102", "hostId": "h1", "result": "SUCCESS", "createdAt": iso(10), "user": { "username": "marcel" }, "host": { "name": "pve-main" } },
            { "id": "a2", "ip": "192.168.178.20", "action": "BACKUP_STARTED", "target": "101", "hostId": "h1", "result": "SUCCESS", "createdAt": iso(1), "user": { "username": "marcel" }, "host": { "name": "pve-main" } },
            { "id": "a3", "ip": "10.88.0.3", "action": "LOGIN_FAILED", "target": "admin", "result": "FAILURE", "error": "Invalid credentials", "createdAt": iso(240), "user": null, "host": null },
            { "id": "a4", "ip": "192.168.178.21", "action": "LXC_SNAPSHOT_CREATED", "target": "302", "hostId": "h1", "result": "SUCCESS", "createdAt": iso(600), "user": { "username": "tim" }, "host": { "name": "pve-main" } } ] }),
        ("GET", "/api/wireguard") => json!({ "interface": { "enabled": true, "instanceName": "Proxora Marcel", "address": "10.88.0.2/24", "publicKey": "kX1…=", "serverPublicKey": "Zt9…=", "serverEndpoint": "vpn.example.de:51820", "allowedIPs": "10.88.0.0/24", "persistentKeepalive": 25, "serverPeerSnippet": "[Peer]\nPublicKey = kX1…=\nAllowedIPs = 10.88.0.2/32" },
            "peers": [ { "id": "p1", "name": "Tim", "kind": "PROXORA", "publicKey": "", "endpoint": "", "address": "10.88.0.3", "proxoraPort": 3000, "allowedIPs": "", "paired": true, "lastSeenAt": iso(2), "shares": [ { "hostId": "h2", "level": "view", "permissions": null } ] } ],
            "diagnostics": { "up": true, "error": null, "checkedAt": iso(1), "peers": [ { "publicKey": "Zt9…=", "endpoint": "203.0.113.7:51820", "allowedIps": "10.88.0.0/24", "latestHandshakeAgeSec": 42, "transferRx": 812_000_000u64, "transferTx": 96_000_000u64, "handshakeOk": true } ], "log": ["wg0 up", "handshake ok"], "reachability": [], "hints": [ { "level": "info", "code": "ok" } ] } }),
        ("GET", "/api/settings") => json!({ "settings": [ { "key": "guest-ip", "value": { "defaults": [ { "id": "192.168.178.0", "prefix": 24, "gateway": "192.168.178.1" } ], "byHost": {} } } ] }),
        ("GET", "/api/notifications") => json!({ "channels": [ { "id": "n1", "type": "discord", "name": "Ops-Discord", "enabled": true, "createdAt": iso(9000), "events": ["host.offline", "backup.failed", "disk.full"] } ],
            "topics": ["host.online", "host.offline", "host.updates", "vm.created", "lxc.created", "vm.deleted", "lxc.deleted", "backup.started", "backup.failed", "backup.restored", "task.failed", "disk.full", "host.cpu.hot", "zfs.degraded", "peer.update", "proxora.update.failed", "wireguard.peer.unreachable"] }),
        ("GET", "/api/embeds") => json!({ "apps": [ { "id": "grafana", "name": "Grafana", "url": "http://192.168.178.70:3000/" } ] }),
        ("GET", "/api/account/totp") => json!({ "enabled": true, "recoveryRemaining": 8 }),
        ("GET", "/api/account/sessions") => json!({ "sessions": [ { "id": "s1", "ip": "192.168.178.20", "userAgent": "ProxoraNative/0.3.0", "createdAt": iso(30), "expiresAt": iso(-10000), "current": true }, { "id": "s2", "ip": "192.168.178.31", "userAgent": "Mozilla/5.0 Firefox/141", "createdAt": iso(2000), "expiresAt": iso(-6000), "current": false } ] }),
        ("GET", p) if p.ends_with("/options") => json!({ "nodes": [ { "node": "pve1" }, { "node": "pve2" } ], "nextid": 105, "storage": [
            { "storage": "local-zfs", "type": "zfspool", "content": "images,rootdir", "active": 1, "used": 1640 * GIB, "avail": 160 * GIB, "total": 1800 * GIB },
            { "storage": "local", "type": "dir", "content": "iso,vztmpl,backup", "active": 1, "used": 38 * GIB, "avail": 56 * GIB, "total": 94 * GIB } ],
            "isos": [ { "volid": "local:iso/debian-13.1.0-amd64-netinst.iso" }, { "volid": "local:iso/Win11_24H2_German_x64.iso" }, { "volid": "local:iso/virtio-win-0.1.271.iso" } ],
            "templates": [ { "volid": "local:vztmpl/debian-13-standard_13.1-1_amd64.tar.zst" } ], "bridges": [ { "iface": "vmbr0", "type": "bridge" }, { "iface": "vmbr1", "type": "bridge" } ],
            "networks": [ { "id": "192.168.178.0", "prefix": 24, "gateway": "192.168.178.1" } ], "usedIps": [], "usedVmids": [101, 102, 103, 104] }),
        _ => return Err(ApiError { status: Some(404), code: Some("NOT_FOUND".into()), message: format!("Demo: {method} {p} nicht hinterlegt") }),
    };
    Ok(v)
}

pub fn client() -> Client {
    Client::mock(Arc::new(route))
}

pub fn app_for_scene(ctx: &egui::Context, scene: &str) -> ProxoraApp {
    let prefs = Prefs {
        server_url: "https://proxora.example.de".into(),
        auto_check_updates: false,
        remember_session: false,
        ..Default::default()
    };
    if scene == "login" {
        return ProxoraApp::demo_login(ctx, prefs, client());
    }
    let page = match scene {
        "vms" | "vm-detail" | "vm-config" => Page::Vms,
        "containers" => Page::Containers,
        "hosts" | "host-detail" => Page::Hosts,
        "tasks" => Page::Tasks,
        "storage" => Page::Storage,
        "backups" => Page::Backups,
        "updates" => Page::Updates,
        "templates" => Page::Templates,
        "scripts" => Page::Scripts,
        "users" => Page::Users,
        "roles" => Page::Roles,
        "audit" => Page::Audit,
        "wireguard" => Page::Wireguard,
        "settings" => Page::Settings,
        "proxora" => Page::Proxora,
        "create-vm" => Page::CreateVm,
        "create-lxc" => Page::CreateLxc,
        _ => Page::Dashboard,
    };
    ProxoraApp::signed_in(ctx, prefs, client(), user(), page)
}

pub fn drive(app: &mut ProxoraApp, ctx: &egui::Context, scene: &str, frame: usize) {
    if frame == 3 {
        if let Some(ws) = app.workspace_mut() {
            match scene {
                "vm-detail" | "vm-config" => ws.sh.open_guest("h1", "pve1", 101, Kind::Vm),
                "host-detail" => ws.sh.open_host("h1"),
                "palette" => ws.open_palette_demo("web"),
                _ => {}
            }
        }
    }
    if frame == 6 && scene == "vm-config" {
        if let Some(ws) = app.workspace_mut() {
            ws.demo_guest_tab_config();
        }
    }
    app.ui(ctx);
}
