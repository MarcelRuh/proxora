//! Lenient serde models for the Proxora HTTP API.
//!
//! Proxora's own objects are camelCase; raw Proxmox objects keep PVE keys and
//! often encode numbers/bools as strings or 0/1 — hence the lenient helpers.

use serde::{Deserialize, Deserializer, Serialize};
use serde_json::{Map, Value};
use std::collections::HashMap;

// ---------------------------------------------------------------- lenient helpers

pub fn de_f64<'de, D: Deserializer<'de>>(d: D) -> Result<f64, D::Error> {
    Ok(match Value::deserialize(d)? {
        Value::Number(n) => n.as_f64().unwrap_or(0.0),
        Value::String(s) => s.trim().parse().unwrap_or(0.0),
        Value::Bool(b) => f64::from(u8::from(b)),
        _ => 0.0,
    })
}

pub fn de_u64<'de, D: Deserializer<'de>>(d: D) -> Result<u64, D::Error> {
    Ok(match Value::deserialize(d)? {
        Value::Number(n) => n
            .as_u64()
            .or_else(|| n.as_f64().map(|f| f.max(0.0) as u64))
            .unwrap_or(0),
        Value::String(s) => s.trim().parse().unwrap_or(0),
        _ => 0,
    })
}

pub fn de_opt_u64<'de, D: Deserializer<'de>>(d: D) -> Result<Option<u64>, D::Error> {
    Ok(match Value::deserialize(d)? {
        Value::Number(n) => n.as_u64().or_else(|| n.as_f64().map(|f| f.max(0.0) as u64)),
        Value::String(s) => s.trim().parse().ok(),
        _ => None,
    })
}

pub fn de_opt_f64<'de, D: Deserializer<'de>>(d: D) -> Result<Option<f64>, D::Error> {
    Ok(match Value::deserialize(d)? {
        Value::Number(n) => n.as_f64(),
        Value::String(s) => s.trim().parse().ok(),
        _ => None,
    })
}

pub fn de_bool<'de, D: Deserializer<'de>>(d: D) -> Result<bool, D::Error> {
    Ok(value_truthy(&Value::deserialize(d)?))
}

pub fn de_string<'de, D: Deserializer<'de>>(d: D) -> Result<String, D::Error> {
    Ok(match Value::deserialize(d)? {
        Value::String(s) => s,
        Value::Null => String::new(),
        other => other.to_string(),
    })
}

/// `null` → `T::default()` (serde's `default` only covers missing keys).
pub fn nd<'de, D: Deserializer<'de>, T: Deserialize<'de> + Default>(d: D) -> Result<T, D::Error> {
    Ok(Option::<T>::deserialize(d)?.unwrap_or_default())
}

pub fn value_truthy(v: &Value) -> bool {
    match v {
        Value::Bool(b) => *b,
        Value::Number(n) => n.as_f64().unwrap_or(0.0) != 0.0,
        Value::String(s) => matches!(s.trim(), "1" | "true" | "yes" | "on"),
        _ => false,
    }
}

/// String view of a raw PVE value ("" for null).
pub fn vstr(map: &Map<String, Value>, key: &str) -> String {
    match map.get(key) {
        Some(Value::String(s)) => s.clone(),
        Some(Value::Null) | None => String::new(),
        Some(other) => other.to_string(),
    }
}

pub fn vnum(map: &Map<String, Value>, key: &str) -> f64 {
    match map.get(key) {
        Some(Value::Number(n)) => n.as_f64().unwrap_or(0.0),
        Some(Value::String(s)) => s.trim().parse().unwrap_or(0.0),
        _ => 0.0,
    }
}

pub fn vbool(map: &Map<String, Value>, key: &str) -> bool {
    map.get(key).is_some_and(value_truthy)
}

// ---------------------------------------------------------------- session & permissions

#[derive(Debug, Clone, Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Role {
    #[serde(deserialize_with = "nd")]
    pub id: String,
    #[serde(deserialize_with = "nd")]
    pub slug: String,
    #[serde(deserialize_with = "nd")]
    pub name: String,
    #[serde(deserialize_with = "nd")]
    pub permissions: Vec<String>,
}

#[derive(Debug, Clone, Default, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", default)]
pub struct GuestRef {
    #[serde(deserialize_with = "nd")]
    pub host_id: String,
    #[serde(deserialize_with = "nd")]
    pub kind: String,
    pub vmid: u32,
}

#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct SessionUser {
    #[serde(deserialize_with = "nd")]
    pub id: String,
    #[serde(deserialize_with = "nd")]
    pub username: String,
    #[serde(deserialize_with = "nd")]
    pub email: String,
    #[serde(deserialize_with = "nd")]
    pub role: Role,
    pub allowed_host_ids: Option<Vec<String>>,
    pub allowed_guests: Option<Vec<GuestRef>>,
    pub host_permissions: Option<HashMap<String, Option<Vec<String>>>>,
    pub guest_permissions: Option<HashMap<String, Option<Vec<String>>>>,
}

#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct LoginResponse {
    pub user: Option<SessionUser>,
    #[serde(deserialize_with = "nd")]
    pub totp_required: bool,
    pub ticket: Option<String>,
}

#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct MeResponse {
    pub user: Option<SessionUser>,
    pub expires_at: Option<String>,
}

#[derive(Debug, Clone, Default, Deserialize)]
#[serde(default)]
pub struct Health {
    #[serde(deserialize_with = "nd")]
    pub status: String,
    pub version: Option<String>,
    pub name: Option<String>,
}

// ---------------------------------------------------------------- hosts

#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Host {
    #[serde(deserialize_with = "nd")]
    pub id: String,
    #[serde(deserialize_with = "nd")]
    pub name: String,
    #[serde(deserialize_with = "nd")]
    pub url: String,
    #[serde(deserialize_with = "nd")]
    pub auth_type: String,
    #[serde(deserialize_with = "nd")]
    pub username: String,
    pub token_id: Option<String>,
    #[serde(deserialize_with = "nd")]
    pub allow_insecure_tls: bool,
    #[serde(deserialize_with = "nd")]
    pub connection_state: String,
    pub last_seen_at: Option<String>,
    pub last_error: Option<String>,
    pub proxmox_version: Option<String>,
    pub cluster_name: Option<String>,
    #[serde(deserialize_with = "nd")]
    pub is_cluster_member: bool,
    pub notes: Option<String>,
    #[serde(deserialize_with = "de_u64")]
    pub apt_update_count: u64,
    pub apt_checked_at: Option<String>,
    pub origin: Option<String>,
    pub peer_id: Option<String>,
    pub peer_name: Option<String>,
    pub share_level: Option<String>,
    pub share_permissions: Option<Vec<String>>,
}

impl Host {
    pub fn is_peer(&self) -> bool {
        self.origin.as_deref() == Some("PEER")
    }
    pub fn online(&self) -> bool {
        self.connection_state.eq_ignore_ascii_case("online")
    }
}

#[derive(Debug, Clone, Default, Deserialize)]
#[serde(default)]
pub struct HostsResponse {
    #[serde(deserialize_with = "nd")]
    pub hosts: Vec<Host>,
}

#[derive(Debug, Clone, Default, Deserialize)]
#[serde(default)]
pub struct HostResponse {
    #[serde(deserialize_with = "nd")]
    pub host: Host,
}

#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct ConnectionTest {
    #[serde(deserialize_with = "nd")]
    pub ok: bool,
    pub version: Option<Map<String, Value>>,
    pub cluster: Option<Map<String, Value>>,
    pub error: Option<String>,
}

#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct UsedTotal {
    #[serde(deserialize_with = "de_u64")]
    pub used: u64,
    #[serde(deserialize_with = "de_u64")]
    pub total: u64,
}

#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct NodeMetrics {
    #[serde(deserialize_with = "de_f64")]
    pub cpu: f64,
    #[serde(deserialize_with = "nd")]
    pub memory: UsedTotal,
    #[serde(deserialize_with = "nd")]
    pub rootfs: UsedTotal,
    #[serde(deserialize_with = "de_u64")]
    pub uptime: u64,
    #[serde(deserialize_with = "de_opt_f64")]
    pub cpu_temp_c: Option<f64>,
    #[serde(deserialize_with = "nd")]
    pub cpu_temp_hot: bool,
    pub cpu_temp_state: Option<String>,
}

#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct NodeStatus {
    #[serde(deserialize_with = "nd")]
    pub node: String,
    #[serde(deserialize_with = "de_string")]
    pub online: String,
    #[serde(deserialize_with = "nd")]
    pub status: NodeMetrics,
}

impl NodeStatus {
    pub fn is_online(&self) -> bool {
        self.online.eq_ignore_ascii_case("online") || self.online == "1" || self.online == "true"
    }
}

#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct NamedStorage {
    #[serde(deserialize_with = "nd")]
    pub storage: String,
    #[serde(rename = "type")]
    #[serde(deserialize_with = "nd")]
    pub kind: String,
    pub node: Option<String>,
}

#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct HostStatus {
    #[serde(deserialize_with = "nd")]
    pub host: String,
    #[serde(deserialize_with = "de_f64")]
    pub cpu_temp_alert_c: f64,
    #[serde(deserialize_with = "nd")]
    pub nodes: Vec<NodeStatus>,
    #[serde(deserialize_with = "nd")]
    pub vms: Vec<Guest>,
    #[serde(deserialize_with = "nd")]
    pub containers: Vec<Guest>,
    #[serde(deserialize_with = "nd")]
    pub storage: Vec<NamedStorage>,
}

#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct ClusterNode {
    #[serde(deserialize_with = "nd")]
    pub name: String,
    #[serde(deserialize_with = "nd")]
    pub online: bool,
    pub ip: Option<String>,
}

#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct ClusterInfo {
    #[serde(deserialize_with = "nd")]
    pub clustered: bool,
    pub name: Option<String>,
    pub quorate: Option<bool>,
    #[serde(deserialize_with = "nd")]
    pub nodes: Vec<ClusterNode>,
    #[serde(deserialize_with = "nd")]
    pub ha_groups: Vec<Value>,
    #[serde(deserialize_with = "nd")]
    pub replications: Vec<Map<String, Value>>,
}

// ---------------------------------------------------------------- dashboard

#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct HostOverview {
    #[serde(deserialize_with = "nd")]
    pub id: String,
    #[serde(deserialize_with = "nd")]
    pub name: String,
    #[serde(deserialize_with = "nd")]
    pub url: String,
    #[serde(deserialize_with = "nd")]
    pub connection_state: String,
    pub proxmox_version: Option<String>,
    pub last_error: Option<String>,
    pub cluster_name: Option<String>,
    #[serde(deserialize_with = "nd")]
    pub is_cluster_member: bool,
    pub origin: Option<String>,
    pub peer_name: Option<String>,
    pub share_level: Option<String>,
    #[serde(deserialize_with = "de_opt_f64")]
    pub cpu: Option<f64>,
    #[serde(deserialize_with = "de_opt_u64")]
    pub cpu_cores: Option<u64>,
    #[serde(deserialize_with = "de_opt_u64")]
    pub mem_used: Option<u64>,
    #[serde(deserialize_with = "de_opt_u64")]
    pub mem_total: Option<u64>,
    #[serde(deserialize_with = "de_opt_u64")]
    pub disk_used: Option<u64>,
    #[serde(deserialize_with = "de_opt_u64")]
    pub disk_total: Option<u64>,
    #[serde(deserialize_with = "de_opt_u64")]
    pub uptime: Option<u64>,
    #[serde(deserialize_with = "de_opt_u64")]
    pub node_count: Option<u64>,
    #[serde(deserialize_with = "de_opt_u64")]
    pub online_nodes: Option<u64>,
    #[serde(deserialize_with = "de_opt_f64")]
    pub cpu_temp_c: Option<f64>,
    #[serde(deserialize_with = "nd")]
    pub cpu_temp_hot: bool,
    pub cpu_temp_node: Option<String>,
    pub cpu_temp_state: Option<String>,
}

#[derive(Debug, Clone, Default, Deserialize)]
#[serde(default)]
pub struct DashboardHosts {
    pub total: u32,
    pub online: u32,
    pub offline: u32,
    pub warning: u32,
    #[serde(deserialize_with = "nd")]
    pub items: Vec<HostOverview>,
}

#[derive(Debug, Clone, Default, Deserialize)]
#[serde(default)]
pub struct Virtualization {
    pub vms: u32,
    pub lxc: u32,
    pub running: u32,
    pub stopped: u32,
    pub paused: u32,
}

#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Resources {
    #[serde(deserialize_with = "de_f64")]
    pub cpu: f64,
    #[serde(deserialize_with = "de_u64")]
    pub mem_used: u64,
    #[serde(deserialize_with = "de_u64")]
    pub mem_total: u64,
    #[serde(deserialize_with = "de_u64")]
    pub disk_used: u64,
    #[serde(deserialize_with = "de_u64")]
    pub disk_total: u64,
}

#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Dashboard {
    #[serde(deserialize_with = "nd")]
    pub hosts: DashboardHosts,
    #[serde(deserialize_with = "nd")]
    pub virtualization: Virtualization,
    #[serde(deserialize_with = "nd")]
    pub resources: Resources,
    #[serde(deserialize_with = "de_f64")]
    pub cpu_temp_alert_c: f64,
}

#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct UpdateSummaryHost {
    #[serde(deserialize_with = "nd")]
    pub id: String,
    #[serde(deserialize_with = "nd")]
    pub name: String,
    #[serde(deserialize_with = "de_u64")]
    pub count: u64,
    pub checked_at: Option<String>,
}

#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct UpdateSummary {
    #[serde(deserialize_with = "de_u64")]
    pub total: u64,
    pub checked_at: Option<String>,
    #[serde(deserialize_with = "nd")]
    pub hosts: Vec<UpdateSummaryHost>,
}

#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct AlertSample {
    #[serde(deserialize_with = "nd")]
    pub key: String,
    pub kind: Option<String>,
    pub guest_kind: Option<String>,
    #[serde(deserialize_with = "nd")]
    pub name: String,
    pub label: Option<String>,
    #[serde(deserialize_with = "de_f64")]
    pub percent: f64,
    #[serde(deserialize_with = "de_f64")]
    pub celsius: f64,
    #[serde(deserialize_with = "nd")]
    pub host_id: String,
    #[serde(deserialize_with = "nd")]
    pub host_name: String,
    pub node: Option<String>,
}

#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct DiskAlerts {
    #[serde(deserialize_with = "de_f64")]
    pub alert_percent: f64,
    #[serde(deserialize_with = "de_f64")]
    pub clear_percent: f64,
    #[serde(deserialize_with = "nd")]
    pub samples: Vec<AlertSample>,
}

#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct CpuTemps {
    #[serde(deserialize_with = "de_f64")]
    pub alert_celsius: f64,
    #[serde(deserialize_with = "de_f64")]
    pub clear_celsius: f64,
    #[serde(deserialize_with = "nd")]
    pub samples: Vec<AlertSample>,
}

// ---------------------------------------------------------------- guests

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum Kind {
    Vm,
    Lxc,
}

impl Kind {
    pub fn api(self) -> &'static str {
        match self {
            Kind::Vm => "vms",
            Kind::Lxc => "lxc",
        }
    }
    pub fn key(self) -> &'static str {
        match self {
            Kind::Vm => "vm",
            Kind::Lxc => "lxc",
        }
    }
    pub fn label(self) -> &'static str {
        match self {
            Kind::Vm => "VM",
            Kind::Lxc => "Container",
        }
    }
    pub fn plural(self) -> &'static str {
        match self {
            Kind::Vm => "Virtuelle Maschinen",
            Kind::Lxc => "Container",
        }
    }
    pub fn web(self) -> &'static str {
        match self {
            Kind::Vm => "vms",
            Kind::Lxc => "containers",
        }
    }
    pub fn perm(self, action: &str) -> String {
        format!("{}.{action}", self.key())
    }
}

#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Guest {
    #[serde(deserialize_with = "de_u64")]
    pub vmid: u64,
    #[serde(deserialize_with = "de_string")]
    pub name: String,
    #[serde(deserialize_with = "nd")]
    pub node: String,
    #[serde(deserialize_with = "de_string")]
    pub status: String,
    #[serde(deserialize_with = "de_f64")]
    pub cpu: f64,
    #[serde(deserialize_with = "de_f64")]
    pub cpus: f64,
    #[serde(deserialize_with = "de_u64")]
    pub mem: u64,
    #[serde(deserialize_with = "de_u64")]
    pub maxmem: u64,
    #[serde(deserialize_with = "de_u64")]
    pub disk: u64,
    #[serde(deserialize_with = "de_u64")]
    pub maxdisk: u64,
    #[serde(deserialize_with = "de_u64")]
    pub uptime: u64,
    #[serde(deserialize_with = "de_bool")]
    pub template: bool,
    pub tags: Option<String>,
    pub description: Option<String>,
    #[serde(deserialize_with = "de_u64")]
    pub netin: u64,
    #[serde(deserialize_with = "de_u64")]
    pub netout: u64,
    pub ips: Option<Vec<String>>,
    pub host_id: Option<String>,
    pub host_name: Option<String>,
    pub host_owner: Option<String>,
}

impl Guest {
    pub fn running(&self) -> bool {
        self.status == "running"
    }
    pub fn tag_list(&self) -> Vec<String> {
        self.tags
            .as_deref()
            .unwrap_or("")
            .split([';', ',', ' '])
            .filter(|t| !t.trim().is_empty())
            .map(|t| t.trim().to_owned())
            .collect()
    }
    pub fn display_name(&self) -> String {
        if self.name.trim().is_empty() {
            format!("id-{}", self.vmid)
        } else {
            self.name.clone()
        }
    }
}

#[derive(Debug, Clone, Default, Deserialize)]
#[serde(default)]
pub struct GuestsResponse {
    #[serde(deserialize_with = "nd")]
    pub vms: Vec<Guest>,
    #[serde(deserialize_with = "nd")]
    pub containers: Vec<Guest>,
}

#[derive(Debug, Clone, Default, Deserialize)]
#[serde(default)]
pub struct Snapshot {
    #[serde(deserialize_with = "de_string")]
    pub name: String,
    pub description: Option<String>,
    #[serde(deserialize_with = "de_opt_u64")]
    pub snaptime: Option<u64>,
    pub parent: Option<String>,
    #[serde(deserialize_with = "de_bool")]
    pub vmstate: bool,
}

#[derive(Debug, Clone, Default, Deserialize)]
#[serde(default)]
pub struct AgentDisk {
    #[serde(deserialize_with = "de_u64")]
    pub used: u64,
    #[serde(deserialize_with = "de_u64")]
    pub total: u64,
}

#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct GuestDetail {
    #[serde(deserialize_with = "nd")]
    pub status: Map<String, Value>,
    #[serde(deserialize_with = "nd")]
    pub config: Map<String, Value>,
    #[serde(deserialize_with = "nd")]
    pub snapshots: Vec<Snapshot>,
    pub agent_disk: Option<AgentDisk>,
    #[serde(deserialize_with = "nd")]
    pub agent_enabled: bool,
    #[serde(deserialize_with = "nd")]
    pub ips: Vec<String>,
}

impl GuestDetail {
    /// Effective state, honouring QMP "paused" behind status "running".
    pub fn state(&self) -> String {
        let qmp = vstr(&self.status, "qmpstatus");
        if qmp == "paused" || qmp == "suspended" {
            return "paused".into();
        }
        vstr(&self.status, "status")
    }
}

#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct ActionResponse {
    pub upid: Option<Value>,
    pub phase: Option<String>,
}

impl ActionResponse {
    pub fn upid(&self) -> Option<String> {
        self.upid.as_ref().and_then(Value::as_str).map(str::to_owned)
    }
}

#[derive(Debug, Clone, Default, Deserialize)]
#[serde(default)]
pub struct FirewallRule {
    #[serde(deserialize_with = "de_u64")]
    pub pos: u64,
    #[serde(rename = "type", deserialize_with = "de_string")]
    pub kind: String,
    #[serde(deserialize_with = "de_string")]
    pub action: String,
    #[serde(deserialize_with = "de_bool")]
    pub enable: bool,
    pub proto: Option<String>,
    pub source: Option<String>,
    pub dest: Option<String>,
    #[serde(deserialize_with = "de_string")]
    pub dport: String,
    pub sport: Option<String>,
    #[serde(rename = "macro")]
    pub macro_name: Option<String>,
    pub comment: Option<String>,
}

#[derive(Debug, Clone, Default, Deserialize)]
#[serde(default)]
pub struct Firewall {
    #[serde(deserialize_with = "nd")]
    pub options: Map<String, Value>,
    #[serde(deserialize_with = "nd")]
    pub rules: Vec<FirewallRule>,
}

#[derive(Debug, Clone, Default, Deserialize)]
#[serde(default)]
pub struct HaInfo {
    #[serde(deserialize_with = "nd")]
    pub clustered: bool,
    pub resource: Option<Map<String, Value>>,
    #[serde(deserialize_with = "nd")]
    pub groups: Vec<Map<String, Value>>,
}

// ---------------------------------------------------------------- tasks

#[derive(Debug, Clone, Default, Deserialize)]
#[serde(default)]
pub struct TaskStatus {
    #[serde(deserialize_with = "nd")]
    pub upid: String,
    #[serde(deserialize_with = "nd")]
    pub node: String,
    #[serde(deserialize_with = "de_string")]
    pub status: String,
    pub exitstatus: Option<String>,
    #[serde(rename = "type", deserialize_with = "de_string")]
    pub kind: String,
    #[serde(deserialize_with = "de_string")]
    pub id: String,
    #[serde(deserialize_with = "de_string")]
    pub user: String,
    #[serde(deserialize_with = "de_u64")]
    pub starttime: u64,
}

impl TaskStatus {
    pub fn finished(&self) -> bool {
        !self.status.is_empty() && self.status != "running"
    }
    pub fn succeeded(&self) -> bool {
        task_exit_ok(self.exitstatus.as_deref().unwrap_or(""))
    }
}

pub fn task_exit_ok(exit: &str) -> bool {
    let e = exit.trim().to_ascii_uppercase();
    e.is_empty() || e == "OK" || e.starts_with("WARNING")
}

#[derive(Debug, Clone, Default, Deserialize)]
#[serde(default)]
pub struct LogLine {
    #[serde(deserialize_with = "de_u64")]
    pub n: u64,
    #[serde(deserialize_with = "de_string")]
    pub t: String,
}

#[derive(Debug, Clone, Default, Deserialize)]
#[serde(default)]
pub struct TaskInfo {
    #[serde(deserialize_with = "nd")]
    pub status: TaskStatus,
    #[serde(deserialize_with = "nd")]
    pub log: Vec<LogLine>,
}

#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct TaskEntry {
    #[serde(deserialize_with = "nd")]
    pub upid: String,
    #[serde(deserialize_with = "nd")]
    pub node: String,
    #[serde(deserialize_with = "de_u64")]
    pub starttime: u64,
    #[serde(deserialize_with = "de_opt_u64")]
    pub endtime: Option<u64>,
    #[serde(rename = "type", deserialize_with = "de_string")]
    pub kind: String,
    #[serde(deserialize_with = "de_string")]
    pub id: String,
    #[serde(deserialize_with = "de_string")]
    pub user: String,
    pub status: Option<String>,
    pub guest_name: Option<String>,
    pub guest_kind: Option<String>,
}

impl TaskEntry {
    pub fn running(&self) -> bool {
        self.endtime.is_none() && self.status.as_deref().is_none_or(|s| s.is_empty() || s == "running")
    }
}

#[derive(Debug, Clone, Default, Deserialize)]
#[serde(default)]
pub struct TasksResponse {
    #[serde(deserialize_with = "nd")]
    pub tasks: Vec<TaskEntry>,
}

/// Node part of a UPID: `UPID:{node}:{pid}:...`.
pub fn upid_node(upid: &str) -> Option<String> {
    let mut parts = upid.split(':');
    (parts.next()? == "UPID").then(|| parts.next().map(str::to_owned))?
}

/// Progress 0..1 parsed from a task log (matches the web UI heuristics).
pub fn log_progress(log: &[LogLine]) -> Option<f32> {
    let mut best: Option<f32> = None;
    for line in log {
        let t = line.t.to_ascii_lowercase();
        if t.contains("task ok") || t.contains("finished") {
            best = Some(1.0);
        }
        if t.contains("extracting archive") {
            best = Some(best.unwrap_or(0.0).max(0.1));
        }
        if let Some(idx) = t.find('%') {
            let digits: String = t[..idx]
                .chars()
                .rev()
                .take_while(|c| c.is_ascii_digit() || *c == '.')
                .collect::<Vec<_>>()
                .into_iter()
                .rev()
                .collect();
            if let Ok(p) = digits.parse::<f32>() {
                if p <= 100.0 {
                    best = Some(best.unwrap_or(0.0).max(p / 100.0));
                }
            }
        }
    }
    best
}

// ---------------------------------------------------------------- updates

#[derive(Debug, Clone, Default, Deserialize)]
#[serde(default)]
pub struct AptPackage {
    #[serde(rename = "Package")]
    #[serde(deserialize_with = "nd")]
    pub package: String,
    #[serde(rename = "Version")]
    pub version: Option<String>,
    #[serde(rename = "OldVersion")]
    pub old_version: Option<String>,
    #[serde(rename = "Title")]
    pub title: Option<String>,
}

#[derive(Debug, Clone, Default, Deserialize)]
#[serde(default)]
pub struct NodeUpdates {
    #[serde(deserialize_with = "nd")]
    pub node: String,
    #[serde(deserialize_with = "de_u64")]
    pub count: u64,
    #[serde(deserialize_with = "nd")]
    pub packages: Vec<AptPackage>,
}

#[derive(Debug, Clone, Default, Deserialize)]
#[serde(default)]
pub struct HostUpdates {
    pub version: Option<String>,
    #[serde(deserialize_with = "nd")]
    pub updates: Vec<NodeUpdates>,
}

// ---------------------------------------------------------------- storage

#[derive(Debug, Clone, Default, Deserialize)]
#[serde(default)]
pub struct StorageItem {
    #[serde(deserialize_with = "nd")]
    pub storage: String,
    #[serde(rename = "type", deserialize_with = "de_string")]
    pub kind: String,
    pub content: Option<String>,
    #[serde(deserialize_with = "de_bool")]
    pub active: bool,
    #[serde(deserialize_with = "de_bool")]
    pub shared: bool,
    #[serde(deserialize_with = "de_u64")]
    pub used: u64,
    #[serde(deserialize_with = "de_u64")]
    pub avail: u64,
    #[serde(deserialize_with = "de_u64")]
    pub total: u64,
}

impl StorageItem {
    pub fn supports(&self, content: &str) -> bool {
        self.content
            .as_deref()
            .unwrap_or("")
            .split(',')
            .any(|c| c.trim() == content)
    }
}

#[derive(Debug, Clone, Default, Deserialize)]
#[serde(default)]
pub struct NodeStorage {
    #[serde(deserialize_with = "nd")]
    pub node: String,
    #[serde(deserialize_with = "nd")]
    pub storage: Vec<StorageItem>,
}

#[derive(Debug, Clone, Default, Deserialize)]
#[serde(default)]
pub struct StorageResponse {
    #[serde(deserialize_with = "nd")]
    pub storage: Vec<NodeStorage>,
}

#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct ContentItem {
    #[serde(deserialize_with = "nd")]
    pub volid: String,
    #[serde(deserialize_with = "nd")]
    pub filename: String,
    #[serde(deserialize_with = "nd")]
    pub content: String,
    #[serde(deserialize_with = "de_u64")]
    pub size: u64,
    #[serde(deserialize_with = "de_u64")]
    pub ctime: u64,
    #[serde(deserialize_with = "de_opt_u64")]
    pub vmid: Option<u64>,
    pub format: Option<String>,
    #[serde(deserialize_with = "nd")]
    pub usage: String,
    pub guest_name: Option<String>,
    pub guest_kind: Option<String>,
}

#[derive(Debug, Clone, Default, Deserialize)]
#[serde(default)]
pub struct StorageContent {
    #[serde(deserialize_with = "nd")]
    pub node: String,
    #[serde(deserialize_with = "nd")]
    pub storage: String,
    #[serde(deserialize_with = "nd")]
    pub items: Vec<ContentItem>,
}

#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct ZfsDevice {
    #[serde(deserialize_with = "nd")]
    pub name: String,
    #[serde(deserialize_with = "nd")]
    pub role: String,
    #[serde(deserialize_with = "nd")]
    pub state: String,
    #[serde(deserialize_with = "de_u64")]
    pub read: u64,
    #[serde(deserialize_with = "de_u64")]
    pub write: u64,
    #[serde(deserialize_with = "de_u64")]
    pub cksum: u64,
    #[serde(deserialize_with = "nd")]
    pub healthy: bool,
}

#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct ZfsHealth {
    #[serde(deserialize_with = "nd")]
    pub all_healthy: bool,
    #[serde(deserialize_with = "de_u64")]
    pub healthy_disks: u64,
    #[serde(deserialize_with = "de_u64")]
    pub total_disks: u64,
    #[serde(deserialize_with = "de_u64")]
    pub problem_disks: u64,
    #[serde(deserialize_with = "nd")]
    pub devices: Vec<ZfsDevice>,
}

#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct ZfsPool {
    #[serde(deserialize_with = "nd")]
    pub name: String,
    #[serde(deserialize_with = "nd")]
    pub health: String,
    #[serde(deserialize_with = "de_u64")]
    pub size: u64,
    #[serde(deserialize_with = "de_u64")]
    pub alloc: u64,
    #[serde(deserialize_with = "de_u64")]
    pub free: u64,
    #[serde(deserialize_with = "de_opt_f64")]
    pub frag: Option<f64>,
    #[serde(deserialize_with = "nd")]
    pub health_summary: ZfsHealth,
}

#[derive(Debug, Clone, Default, Deserialize)]
#[serde(default)]
pub struct ZfsNode {
    #[serde(deserialize_with = "nd")]
    pub node: String,
    #[serde(deserialize_with = "nd")]
    pub pools: Vec<ZfsPool>,
}

#[derive(Debug, Clone, Default, Deserialize)]
#[serde(default)]
pub struct ZfsResponse {
    #[serde(deserialize_with = "nd")]
    pub zfs: Vec<ZfsNode>,
}

#[derive(Debug, Clone, Default, Deserialize)]
#[serde(default)]
pub struct ZfsPoolDetail {
    #[serde(deserialize_with = "nd")]
    pub node: String,
    #[serde(deserialize_with = "nd")]
    pub pool: ZfsPool,
}

// ---------------------------------------------------------------- create options, media

#[derive(Debug, Clone, Default, Deserialize)]
#[serde(default)]
pub struct NodeName {
    #[serde(deserialize_with = "nd")]
    pub node: String,
}

#[derive(Debug, Clone, Default, Deserialize)]
#[serde(default)]
pub struct Volid {
    #[serde(deserialize_with = "nd")]
    pub volid: String,
}

#[derive(Debug, Clone, Default, Deserialize, Serialize, PartialEq)]
#[serde(default)]
pub struct IpNetwork {
    #[serde(deserialize_with = "nd")]
    pub id: String,
    #[serde(deserialize_with = "de_u64")]
    pub prefix: u64,
    #[serde(deserialize_with = "nd")]
    pub gateway: String,
}

#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct CreateOptions {
    #[serde(deserialize_with = "nd")]
    pub nodes: Vec<NodeName>,
    #[serde(deserialize_with = "de_u64")]
    pub nextid: u64,
    #[serde(deserialize_with = "nd")]
    pub storage: Vec<StorageItem>,
    #[serde(deserialize_with = "nd")]
    pub isos: Vec<Volid>,
    #[serde(deserialize_with = "nd")]
    pub templates: Vec<Volid>,
    #[serde(deserialize_with = "nd")]
    pub bridges: Vec<Map<String, Value>>,
    #[serde(deserialize_with = "nd")]
    pub networks: Vec<IpNetwork>,
    #[serde(deserialize_with = "nd")]
    pub used_ips: Vec<String>,
    #[serde(deserialize_with = "nd")]
    pub used_vmids: Vec<u64>,
}

#[derive(Debug, Clone, Default, Deserialize)]
#[serde(default)]
pub struct NextId {
    #[serde(deserialize_with = "de_u64")]
    pub nextid: u64,
}

#[derive(Debug, Clone, Default, Deserialize)]
#[serde(default)]
pub struct CreatedGuest {
    pub upid: Option<String>,
    #[serde(deserialize_with = "nd")]
    pub node: String,
    #[serde(deserialize_with = "de_u64")]
    pub vmid: u64,
}

#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct CatalogTemplate {
    #[serde(deserialize_with = "nd")]
    pub template: String,
    #[serde(deserialize_with = "nd")]
    pub package: String,
    #[serde(deserialize_with = "nd")]
    pub version: String,
    #[serde(deserialize_with = "nd")]
    pub section: String,
    #[serde(deserialize_with = "nd")]
    pub headline: String,
    #[serde(deserialize_with = "nd")]
    pub os: String,
    #[serde(deserialize_with = "nd")]
    pub installed: bool,
    pub volid: Option<String>,
}

#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct VolumeUser {
    #[serde(deserialize_with = "nd")]
    pub kind: String,
    #[serde(deserialize_with = "de_u64")]
    pub vmid: u64,
    #[serde(deserialize_with = "nd")]
    pub name: String,
    #[serde(deserialize_with = "nd")]
    pub node: String,
}

#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct TemplatesResponse {
    #[serde(deserialize_with = "nd")]
    pub nodes: Vec<String>,
    #[serde(deserialize_with = "nd")]
    pub node: String,
    #[serde(deserialize_with = "nd")]
    pub storages: Vec<String>,
    #[serde(deserialize_with = "nd")]
    pub installed: Vec<String>,
    #[serde(deserialize_with = "nd")]
    pub catalog: Vec<CatalogTemplate>,
    #[serde(deserialize_with = "nd")]
    pub used_by: HashMap<String, Vec<VolumeUser>>,
}

#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct IsoCatalogItem {
    #[serde(deserialize_with = "nd")]
    pub id: String,
    #[serde(deserialize_with = "nd")]
    pub headline: String,
    #[serde(deserialize_with = "nd")]
    pub section: String,
    #[serde(deserialize_with = "nd")]
    pub filename: String,
    #[serde(deserialize_with = "nd")]
    pub url: String,
    #[serde(deserialize_with = "nd")]
    pub version: String,
}

#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct IsoPackageRow {
    #[serde(deserialize_with = "nd")]
    pub key: String,
    #[serde(deserialize_with = "nd")]
    pub headline: String,
    #[serde(deserialize_with = "nd")]
    pub section: String,
    #[serde(deserialize_with = "nd")]
    pub url: String,
    #[serde(deserialize_with = "nd")]
    pub installed_version: String,
    #[serde(deserialize_with = "nd")]
    pub installed_filename: String,
    #[serde(deserialize_with = "nd")]
    pub installed_volids: Vec<String>,
    #[serde(deserialize_with = "nd")]
    pub latest_version: String,
    #[serde(deserialize_with = "nd")]
    pub latest_filename: String,
    #[serde(deserialize_with = "nd")]
    pub update_available: bool,
}

#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct IsosResponse {
    #[serde(deserialize_with = "nd")]
    pub nodes: Vec<String>,
    #[serde(deserialize_with = "nd")]
    pub node: String,
    #[serde(deserialize_with = "nd")]
    pub storages: Vec<String>,
    #[serde(deserialize_with = "nd")]
    pub installed: Vec<String>,
    #[serde(deserialize_with = "nd")]
    pub catalog: Vec<IsoPackageRow>,
    #[serde(deserialize_with = "nd")]
    pub used_by: HashMap<String, Vec<VolumeUser>>,
    pub recommended_virtio: Option<IsoCatalogItem>,
}

#[derive(Debug, Clone, Default, Deserialize)]
#[serde(default)]
pub struct UpidResponse {
    pub upid: Option<String>,
    pub node: Option<String>,
    pub volid: Option<String>,
}

// ---------------------------------------------------------------- backups

#[derive(Debug, Clone, Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", default)]
pub struct BackupJob {
    #[serde(deserialize_with = "nd")]
    pub id: String,
    #[serde(deserialize_with = "nd")]
    pub enabled: bool,
    #[serde(deserialize_with = "nd")]
    pub schedule: String,
    #[serde(deserialize_with = "nd")]
    pub storage: String,
    #[serde(deserialize_with = "nd")]
    pub mode: String,
    #[serde(deserialize_with = "nd")]
    pub compress: String,
    #[serde(deserialize_with = "nd")]
    pub all: bool,
    #[serde(deserialize_with = "de_string")]
    pub vmid: String,
    #[serde(deserialize_with = "de_string")]
    pub node: String,
    #[serde(deserialize_with = "de_string")]
    pub prune: String,
    #[serde(deserialize_with = "de_opt_u64")]
    pub keep_last: Option<u64>,
}

#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct BackupGuest {
    #[serde(deserialize_with = "de_u64")]
    pub vmid: u64,
    #[serde(deserialize_with = "nd")]
    pub name: String,
    #[serde(deserialize_with = "nd")]
    pub kind: String,
    #[serde(deserialize_with = "nd")]
    pub node: String,
    #[serde(deserialize_with = "nd")]
    pub status: String,
}

#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct BackupsResponse {
    #[serde(deserialize_with = "nd")]
    pub nodes: Vec<String>,
    #[serde(deserialize_with = "nd")]
    pub primary_node: String,
    #[serde(deserialize_with = "nd")]
    pub backup_storages: Vec<String>,
    #[serde(deserialize_with = "nd")]
    pub disk_storages: Vec<String>,
    #[serde(deserialize_with = "nd")]
    pub jobs: Vec<BackupJob>,
    #[serde(deserialize_with = "nd")]
    pub guests: Vec<BackupGuest>,
}

#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct BackupFile {
    #[serde(deserialize_with = "nd")]
    pub volid: String,
    #[serde(deserialize_with = "nd")]
    pub node: String,
    #[serde(deserialize_with = "nd")]
    pub storage: String,
    #[serde(deserialize_with = "de_opt_u64")]
    pub vmid: Option<u64>,
    #[serde(deserialize_with = "nd")]
    pub kind: String,
    #[serde(deserialize_with = "de_u64")]
    pub size: u64,
    #[serde(deserialize_with = "de_u64")]
    pub ctime: u64,
    pub notes: Option<String>,
}

#[derive(Debug, Clone, Default, Deserialize)]
#[serde(default)]
pub struct BackupFilesResponse {
    #[serde(deserialize_with = "nd")]
    pub files: Vec<BackupFile>,
}

#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct RestoreStarted {
    #[serde(deserialize_with = "nd")]
    pub job_id: String,
    #[serde(deserialize_with = "nd")]
    pub phase: String,
}

#[derive(Debug, Clone, Default, Deserialize)]
#[serde(default)]
pub struct RestoreJob {
    #[serde(deserialize_with = "nd")]
    pub phase: String,
    pub upid: Option<String>,
    pub error: Option<String>,
}

#[derive(Debug, Clone, Default, Deserialize)]
#[serde(default)]
pub struct CleanupResult {
    #[serde(deserialize_with = "de_u64")]
    pub found: u64,
    #[serde(deserialize_with = "de_u64")]
    pub deleted: u64,
    #[serde(deserialize_with = "de_u64")]
    pub failed: u64,
}

// ---------------------------------------------------------------- community scripts

#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Script {
    #[serde(deserialize_with = "nd")]
    pub id: String,
    #[serde(deserialize_with = "nd")]
    pub name: String,
    #[serde(deserialize_with = "nd")]
    pub slug: String,
    #[serde(deserialize_with = "nd")]
    pub description: String,
    pub logo: Option<String>,
    #[serde(deserialize_with = "nd")]
    pub kind: String,
    #[serde(deserialize_with = "nd")]
    pub category_ids: Vec<String>,
    #[serde(deserialize_with = "de_opt_u64")]
    pub port: Option<u64>,
    #[serde(deserialize_with = "nd")]
    pub privileged: bool,
    #[serde(deserialize_with = "nd")]
    pub updateable: bool,
    pub website: Option<String>,
    pub documentation: Option<String>,
    #[serde(deserialize_with = "de_opt_u64")]
    pub default_cpu: Option<u64>,
    #[serde(deserialize_with = "de_opt_u64")]
    pub default_ram_mb: Option<u64>,
    #[serde(deserialize_with = "de_opt_u64")]
    pub default_disk_gb: Option<u64>,
    pub default_os: Option<String>,
}

#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct ScriptCategory {
    #[serde(deserialize_with = "nd")]
    pub id: String,
    #[serde(deserialize_with = "nd")]
    pub name: String,
}

#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct ScriptsResponse {
    #[serde(deserialize_with = "nd")]
    pub scripts: Vec<Script>,
    #[serde(deserialize_with = "nd")]
    pub categories: Vec<ScriptCategory>,
    #[serde(deserialize_with = "de_u64")]
    pub total: u64,
    #[serde(deserialize_with = "nd")]
    pub stale: bool,
}

#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct ScriptDetail {
    #[serde(deserialize_with = "nd")]
    pub script: Script,
    #[serde(deserialize_with = "nd")]
    pub command: String,
    #[serde(deserialize_with = "nd")]
    pub source_url: String,
    #[serde(deserialize_with = "nd")]
    pub page_url: String,
}

#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct ConsoleLaunch {
    #[serde(deserialize_with = "nd")]
    pub mode: String,
    #[serde(deserialize_with = "nd")]
    pub node: String,
    pub command: Option<String>,
}

// ---------------------------------------------------------------- search

#[derive(Debug, Clone, Default, Deserialize)]
#[serde(default)]
pub struct SearchHit {
    #[serde(rename = "type")]
    #[serde(deserialize_with = "nd")]
    pub kind: String,
    #[serde(deserialize_with = "nd")]
    pub id: String,
    #[serde(deserialize_with = "nd")]
    pub title: String,
    pub subtitle: Option<String>,
}

#[derive(Debug, Clone, Default, Deserialize)]
#[serde(default)]
pub struct SearchResponse {
    #[serde(deserialize_with = "nd")]
    pub hosts: Vec<SearchHit>,
    #[serde(deserialize_with = "nd")]
    pub vms: Vec<SearchHit>,
    #[serde(deserialize_with = "nd")]
    pub containers: Vec<SearchHit>,
    #[serde(deserialize_with = "nd")]
    pub storage: Vec<SearchHit>,
}

// ---------------------------------------------------------------- guest files

#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct FileEntry {
    #[serde(deserialize_with = "nd")]
    pub name: String,
    #[serde(deserialize_with = "nd")]
    pub path: String,
    #[serde(rename = "type")]
    #[serde(deserialize_with = "nd")]
    pub kind: String,
    #[serde(deserialize_with = "de_u64")]
    pub size: u64,
    #[serde(deserialize_with = "de_opt_u64")]
    pub mtime: Option<u64>,
}

#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct FileList {
    #[serde(deserialize_with = "nd")]
    pub path: String,
    #[serde(deserialize_with = "nd")]
    pub via: String,
    #[serde(deserialize_with = "nd")]
    pub entries: Vec<FileEntry>,
}

#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct FileRead {
    #[serde(deserialize_with = "nd")]
    pub path: String,
    #[serde(deserialize_with = "nd")]
    pub name: String,
    #[serde(deserialize_with = "de_u64")]
    pub size: u64,
    #[serde(deserialize_with = "nd")]
    pub content_base64: String,
}

#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct TransferTicket {
    #[serde(deserialize_with = "nd")]
    pub ticket: String,
    #[serde(deserialize_with = "nd")]
    pub path: String,
    #[serde(deserialize_with = "nd")]
    pub name: String,
    #[serde(deserialize_with = "de_u64")]
    pub part_size: u64,
    pub part_prefix: Option<String>,
    #[serde(deserialize_with = "de_opt_u64")]
    pub part_expected_size: Option<u64>,
}

// ---------------------------------------------------------------- account

#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct TotpState {
    #[serde(deserialize_with = "nd")]
    pub enabled: bool,
    #[serde(deserialize_with = "de_u64")]
    pub recovery_remaining: u64,
}

#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct TotpBegin {
    #[serde(deserialize_with = "nd")]
    pub secret: String,
    #[serde(deserialize_with = "nd")]
    pub otpauth: String,
    #[serde(deserialize_with = "nd")]
    pub qr: String,
}

#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct RecoveryCodes {
    #[serde(deserialize_with = "nd")]
    pub recovery_codes: Vec<String>,
}

#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct AccountSession {
    #[serde(deserialize_with = "nd")]
    pub id: String,
    pub ip: Option<String>,
    pub user_agent: Option<String>,
    #[serde(deserialize_with = "nd")]
    pub created_at: String,
    #[serde(deserialize_with = "nd")]
    pub expires_at: String,
    #[serde(deserialize_with = "nd")]
    pub current: bool,
}

#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct SessionsResponse {
    #[serde(deserialize_with = "nd")]
    pub sessions: Vec<AccountSession>,
}

// ---------------------------------------------------------------- users & roles

#[derive(Debug, Clone, Default, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct HostGrant {
    #[serde(deserialize_with = "nd")]
    pub host_id: String,
    pub permissions: Option<Vec<String>>,
}

#[derive(Debug, Clone, Default, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct GuestGrant {
    #[serde(deserialize_with = "nd")]
    pub host_id: String,
    #[serde(deserialize_with = "nd")]
    pub kind: String,
    pub vmid: u64,
    pub permissions: Option<Vec<String>>,
}

#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct UserDto {
    #[serde(deserialize_with = "nd")]
    pub id: String,
    #[serde(deserialize_with = "nd")]
    pub username: String,
    #[serde(deserialize_with = "nd")]
    pub email: String,
    #[serde(deserialize_with = "nd")]
    pub status: String,
    #[serde(deserialize_with = "nd")]
    pub totp_enabled: bool,
    pub last_login_at: Option<String>,
    #[serde(deserialize_with = "nd")]
    pub created_at: String,
    #[serde(deserialize_with = "nd")]
    pub role_id: String,
    #[serde(deserialize_with = "nd")]
    pub role: Role,
    #[serde(deserialize_with = "nd")]
    pub hosts: Vec<HostGrant>,
    #[serde(deserialize_with = "nd")]
    pub guests: Vec<GuestGrant>,
}

#[derive(Debug, Clone, Default, Deserialize)]
#[serde(default)]
pub struct UsersResponse {
    #[serde(deserialize_with = "nd")]
    pub users: Vec<UserDto>,
}

#[derive(Debug, Clone, Default, Deserialize)]
#[serde(default)]
pub struct RoleCount {
    #[serde(deserialize_with = "de_u64")]
    pub users: u64,
}

#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct RoleDto {
    #[serde(deserialize_with = "nd")]
    pub id: String,
    #[serde(deserialize_with = "nd")]
    pub name: String,
    #[serde(deserialize_with = "nd")]
    pub slug: String,
    #[serde(deserialize_with = "nd")]
    pub description: String,
    #[serde(deserialize_with = "nd")]
    pub is_system: bool,
    #[serde(deserialize_with = "nd")]
    pub permissions: Vec<String>,
    #[serde(rename = "_count")]
    #[serde(deserialize_with = "nd")]
    pub count: RoleCount,
}

#[derive(Debug, Clone, Default, Deserialize)]
#[serde(default)]
pub struct PermissionMeta {
    #[serde(deserialize_with = "nd")]
    pub id: String,
    #[serde(deserialize_with = "nd")]
    pub group: String,
    #[serde(deserialize_with = "nd")]
    pub de: String,
    #[serde(deserialize_with = "nd")]
    pub en: String,
}

#[derive(Debug, Clone, Default, Deserialize)]
#[serde(default)]
pub struct PermissionGroup {
    #[serde(deserialize_with = "nd")]
    pub id: String,
    #[serde(deserialize_with = "nd")]
    pub de: String,
    #[serde(deserialize_with = "nd")]
    pub en: String,
}

#[derive(Debug, Clone, Default, Deserialize)]
#[serde(default)]
pub struct RolesResponse {
    #[serde(deserialize_with = "nd")]
    pub roles: Vec<RoleDto>,
    #[serde(deserialize_with = "nd")]
    pub catalog: Vec<PermissionMeta>,
    #[serde(deserialize_with = "nd")]
    pub groups: Vec<PermissionGroup>,
}

// ---------------------------------------------------------------- audit

#[derive(Debug, Clone, Default, Deserialize)]
#[serde(default)]
pub struct NameRef {
    #[serde(alias = "username")]
    #[serde(deserialize_with = "nd")]
    pub name: String,
}

#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct AuditLog {
    #[serde(deserialize_with = "nd")]
    pub id: String,
    pub ip: Option<String>,
    #[serde(deserialize_with = "nd")]
    pub action: String,
    pub target: Option<String>,
    pub host_id: Option<String>,
    #[serde(deserialize_with = "nd")]
    pub result: String,
    pub error: Option<String>,
    #[serde(deserialize_with = "nd")]
    pub created_at: String,
    pub user: Option<NameRef>,
    pub host: Option<NameRef>,
}

#[derive(Debug, Clone, Default, Deserialize)]
#[serde(default)]
pub struct AuditResponse {
    #[serde(deserialize_with = "nd")]
    pub logs: Vec<AuditLog>,
}

// ---------------------------------------------------------------- settings & notifications

#[derive(Debug, Clone, Default, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct GuestIpSettings {
    #[serde(deserialize_with = "nd")]
    pub defaults: Vec<IpNetwork>,
    #[serde(deserialize_with = "nd")]
    pub by_host: HashMap<String, Vec<IpNetwork>>,
}

#[derive(Debug, Clone, Default, Deserialize)]
#[serde(default)]
pub struct SettingEntry {
    #[serde(deserialize_with = "nd")]
    pub key: String,
    #[serde(deserialize_with = "nd")]
    pub value: Value,
}

#[derive(Debug, Clone, Default, Deserialize)]
#[serde(default)]
pub struct SettingsResponse {
    #[serde(deserialize_with = "nd")]
    pub settings: Vec<SettingEntry>,
}

impl SettingsResponse {
    pub fn guest_ip(&self) -> GuestIpSettings {
        let Some(entry) = self.settings.iter().find(|s| s.key == "guest-ip") else {
            return GuestIpSettings::default();
        };
        if let Value::Array(_) = entry.value {
            return GuestIpSettings {
                defaults: serde_json::from_value(entry.value.clone()).unwrap_or_default(),
                by_host: HashMap::new(),
            };
        }
        serde_json::from_value(entry.value.clone()).unwrap_or_default()
    }
}

#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Channel {
    #[serde(deserialize_with = "nd")]
    pub id: String,
    #[serde(rename = "type")]
    #[serde(deserialize_with = "nd")]
    pub kind: String,
    #[serde(deserialize_with = "nd")]
    pub name: String,
    #[serde(deserialize_with = "nd")]
    pub enabled: bool,
    pub created_at: Option<String>,
    pub events: Option<Vec<String>>,
}

#[derive(Debug, Clone, Default, Deserialize)]
#[serde(default)]
pub struct NotificationsResponse {
    #[serde(deserialize_with = "nd")]
    pub channels: Vec<Channel>,
    #[serde(deserialize_with = "nd")]
    pub topics: Vec<String>,
}

#[derive(Debug, Clone, Default, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct SuiteApp {
    #[serde(skip_serializing_if = "String::is_empty")]
    #[serde(deserialize_with = "nd")]
    pub id: String,
    #[serde(deserialize_with = "nd")]
    pub name: String,
    #[serde(deserialize_with = "nd")]
    pub url: String,
    #[serde(skip_serializing_if = "std::ops::Not::not")]
    #[serde(deserialize_with = "nd")]
    pub insecure_tls: bool,
}

#[derive(Debug, Clone, Default, Deserialize)]
#[serde(default)]
pub struct EmbedsResponse {
    #[serde(deserialize_with = "nd")]
    pub apps: Vec<SuiteApp>,
}

// ---------------------------------------------------------------- self-update

#[derive(Debug, Clone, Default, Deserialize)]
#[serde(default)]
pub struct UpdateProgress {
    #[serde(deserialize_with = "de_u64")]
    pub percent: u64,
    #[serde(deserialize_with = "nd")]
    pub step: String,
    pub detail: Option<String>,
}

#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct SelfUpdateStatus {
    #[serde(deserialize_with = "nd")]
    pub enabled: bool,
    #[serde(deserialize_with = "nd")]
    pub mode: String,
    #[serde(deserialize_with = "nd")]
    pub sidecar: String,
    #[serde(deserialize_with = "nd")]
    pub current_version: String,
    pub remote_version: Option<String>,
    pub local_revision: Option<String>,
    pub remote_revision: Option<String>,
    #[serde(deserialize_with = "nd")]
    pub update_available: bool,
    #[serde(deserialize_with = "nd")]
    pub message: String,
    pub install_dir: Option<String>,
    pub repo: Option<String>,
    pub branch: Option<String>,
    pub target_tag: Option<String>,
    #[serde(deserialize_with = "nd")]
    pub updating: bool,
    pub progress: Option<UpdateProgress>,
    pub changelog: Option<String>,
    pub target_version: Option<String>,
    pub image_ready: Option<bool>,
}

#[derive(Debug, Clone, Default, Deserialize)]
#[serde(default)]
pub struct OkMessage {
    #[serde(deserialize_with = "nd")]
    pub ok: bool,
    #[serde(deserialize_with = "nd")]
    pub message: String,
}

// ---------------------------------------------------------------- wireguard

#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct WgInterface {
    #[serde(deserialize_with = "nd")]
    pub enabled: bool,
    #[serde(deserialize_with = "nd")]
    pub instance_name: String,
    #[serde(deserialize_with = "nd")]
    pub address: String,
    #[serde(deserialize_with = "nd")]
    pub public_key: String,
    #[serde(deserialize_with = "nd")]
    pub server_public_key: String,
    #[serde(deserialize_with = "nd")]
    pub server_endpoint: String,
    #[serde(rename = "allowedIPs")]
    #[serde(deserialize_with = "nd")]
    pub allowed_ips: String,
    #[serde(deserialize_with = "de_u64")]
    pub persistent_keepalive: u64,
    #[serde(deserialize_with = "nd")]
    pub server_peer_snippet: String,
}

#[derive(Debug, Clone, Default, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct PeerShare {
    #[serde(deserialize_with = "nd")]
    pub host_id: String,
    #[serde(deserialize_with = "nd")]
    pub level: String,
    pub permissions: Option<Vec<String>>,
}

#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct WgPeer {
    #[serde(deserialize_with = "nd")]
    pub id: String,
    #[serde(deserialize_with = "nd")]
    pub name: String,
    #[serde(deserialize_with = "nd")]
    pub kind: String,
    #[serde(deserialize_with = "nd")]
    pub public_key: String,
    #[serde(deserialize_with = "nd")]
    pub endpoint: String,
    #[serde(deserialize_with = "nd")]
    pub address: String,
    #[serde(deserialize_with = "de_u64")]
    pub proxora_port: u64,
    #[serde(rename = "allowedIPs")]
    #[serde(deserialize_with = "nd")]
    pub allowed_ips: String,
    #[serde(deserialize_with = "nd")]
    pub paired: bool,
    pub last_seen_at: Option<String>,
    #[serde(deserialize_with = "nd")]
    pub shares: Vec<PeerShare>,
}

#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct WgRuntimePeer {
    #[serde(deserialize_with = "nd")]
    pub public_key: String,
    #[serde(deserialize_with = "nd")]
    pub endpoint: String,
    #[serde(deserialize_with = "nd")]
    pub allowed_ips: String,
    pub latest_handshake_at: Option<String>,
    #[serde(deserialize_with = "de_opt_u64")]
    pub latest_handshake_age_sec: Option<u64>,
    #[serde(deserialize_with = "de_u64")]
    pub transfer_rx: u64,
    #[serde(deserialize_with = "de_u64")]
    pub transfer_tx: u64,
    #[serde(deserialize_with = "nd")]
    pub handshake_ok: bool,
}

#[derive(Debug, Clone, Default, Deserialize)]
#[serde(default)]
pub struct WgHint {
    #[serde(deserialize_with = "nd")]
    pub level: String,
    #[serde(deserialize_with = "nd")]
    pub code: String,
    pub params: Option<HashMap<String, String>>,
}

#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct WgReachability {
    #[serde(deserialize_with = "nd")]
    pub peer_id: String,
    #[serde(deserialize_with = "nd")]
    pub name: String,
    #[serde(deserialize_with = "nd")]
    pub url: String,
    #[serde(deserialize_with = "nd")]
    pub ok: bool,
    pub error: Option<String>,
    #[serde(deserialize_with = "de_opt_u64")]
    pub ms: Option<u64>,
    pub version: Option<String>,
}

#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct WgDiagnostics {
    #[serde(deserialize_with = "nd")]
    pub up: bool,
    pub error: Option<String>,
    pub checked_at: Option<String>,
    #[serde(deserialize_with = "nd")]
    pub peers: Vec<WgRuntimePeer>,
    #[serde(deserialize_with = "nd")]
    pub log: Vec<String>,
    #[serde(deserialize_with = "nd")]
    pub reachability: Vec<WgReachability>,
    #[serde(deserialize_with = "nd")]
    pub hints: Vec<WgHint>,
}

#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct WireguardResponse {
    #[serde(deserialize_with = "nd")]
    pub interface: WgInterface,
    #[serde(deserialize_with = "nd")]
    pub peers: Vec<WgPeer>,
    #[serde(deserialize_with = "nd")]
    pub diagnostics: WgDiagnostics,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn host_tolerates_nulls_and_missing_fields() {
        let h: Host = serde_json::from_value(serde_json::json!({
            "id": "h1", "name": null, "url": "", "connectionState": "ONLINE",
            "isClusterMember": null, "aptUpdateCount": null, "sharePermissions": null
        }))
        .unwrap();
        assert_eq!(h.id, "h1");
        assert!(h.name.is_empty());
        assert!(!h.is_cluster_member);
        assert_eq!(h.apt_update_count, 0);
    }

    #[test]
    fn offline_node_without_status() {
        let s: HostStatus = serde_json::from_value(serde_json::json!({
            "host": "pve", "nodes": [ { "node": "pve2", "online": "offline", "status": null } ]
        }))
        .unwrap();
        assert!(!s.nodes[0].is_online());
        assert_eq!(s.nodes[0].status.memory.total, 0);
    }

    #[test]
    fn pve_values_as_strings() {
        let g: Guest = serde_json::from_value(serde_json::json!({
            "vmid": "101", "name": 7, "node": "pve", "status": "running", "cpu": "0.25", "maxmem": "1024", "template": 1
        }))
        .unwrap();
        assert_eq!(g.vmid, 101);
        assert_eq!(g.name, "7");
        assert!(g.template);
        assert!((g.cpu - 0.25).abs() < 1e-9);
    }

    #[test]
    fn upid_helpers() {
        assert_eq!(upid_node("UPID:pve1:0001:01:6911A000:vzdump:101:root@pam:").as_deref(), Some("pve1"));
        assert_eq!(upid_node("nope"), None);
        assert!(task_exit_ok("WARNINGS: 1"));
        assert!(!task_exit_ok("command failed"));
    }
}
