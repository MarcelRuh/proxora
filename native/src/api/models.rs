#![allow(dead_code)]

use serde::Deserialize;

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionUser {
    pub id: String,
    pub username: String,
    pub email: String,
    pub role: RoleInfo,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RoleInfo {
    pub name: String,
    pub slug: String,
    pub permissions: Vec<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LoginResponse {
    pub user: Option<SessionUser>,
    pub totp_required: Option<bool>,
    pub ticket: Option<String>,
    pub error: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MeResponse {
    pub user: SessionUser,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PublicHost {
    pub id: String,
    pub name: String,
    pub url: String,
    pub connection_state: String,
    pub proxmox_version: Option<String>,
    pub last_error: Option<String>,
    pub origin: Option<String>,
    pub peer_name: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct HostsResponse {
    pub hosts: Vec<PublicHost>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DashboardHost {
    pub id: String,
    pub name: String,
    pub connection_state: String,
    pub cpu: Option<f64>,
    pub mem_used: Option<u64>,
    pub mem_total: Option<u64>,
    pub disk_used: Option<u64>,
    pub disk_total: Option<u64>,
    pub uptime: Option<u64>,
    pub proxmox_version: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Dashboard {
    pub hosts: DashboardHostsBlock,
    pub virtualization: VirtualizationBlock,
    pub resources: ResourcesBlock,
}

#[derive(Debug, Clone, Deserialize)]
pub struct DashboardHostsBlock {
    pub total: u32,
    pub online: u32,
    pub offline: u32,
    pub warning: u32,
    pub items: Vec<DashboardHost>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct VirtualizationBlock {
    pub vms: u32,
    pub lxc: u32,
    pub running: u32,
    pub stopped: u32,
    pub paused: u32,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ResourcesBlock {
    pub cpu: f64,
    pub mem_used: u64,
    pub mem_total: u64,
    pub disk_used: u64,
    pub disk_total: u64,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Guest {
    pub vmid: u32,
    pub name: String,
    pub node: String,
    pub status: String,
    pub cpu: f64,
    pub cpus: f64,
    pub mem: u64,
    pub maxmem: u64,
    pub disk: u64,
    pub maxdisk: u64,
    pub uptime: u64,
    pub host_id: Option<String>,
    pub host_name: Option<String>,
    pub tags: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct DashboardGuests {
    pub vms: Vec<Guest>,
    pub containers: Vec<Guest>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct HealthResponse {
    pub status: String,
    pub version: Option<String>,
    pub name: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct ApiErrorBody {
    pub error: Option<String>,
    pub code: Option<String>,
}
