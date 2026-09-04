export type ConnectionState = "ONLINE" | "OFFLINE" | "CONNECTING" | "ERROR" | "MAINTENANCE";

export type PublicHost = {
  id: string;
  name: string;
  url: string;
  authType: "API_TOKEN" | "PASSWORD";
  username: string;
  tokenId: string | null;
  allowInsecureTls: boolean;
  connectionState: ConnectionState;
  lastSeenAt: string | null;
  lastError: string | null;
  proxmoxVersion: string | null;
  clusterName: string | null;
  isClusterMember: boolean;
  notes: string | null;
  aptUpdateCount?: number;
  aptCheckedAt?: string | Date | null;
};

export type Guest = {
  vmid: number;
  name: string;
  node: string;
  status: "running" | "stopped" | "paused" | "unknown";
  cpu: number;
  cpus: number;
  mem: number;
  maxmem: number;
  disk: number;
  maxdisk: number;
  uptime: number;
  hostId?: string;
  hostName?: string;
  template?: boolean;
  kind?: "vm" | "lxc";
  tags?: string;
  description?: string;
  ips?: string[];
};

export type SessionUser = {
  id: string;
  username: string;
  email: string;
  role: { id: string; slug: string; name: string; permissions: string[] };
  allowedHostIds: string[] | null;
  allowedGuests: Array<{ hostId: string; kind: "vm" | "lxc"; vmid: number }> | null;
};

export type DashboardHost = {
  id: string;
  name: string;
  connectionState: ConnectionState;
  proxmoxVersion: string | null;
  cpu?: number;
  cpuCores?: number;
  memUsed?: number;
  memTotal?: number;
  diskUsed?: number;
  diskTotal?: number;
  uptime?: number;
  lastError?: string | null;
  nodeCount?: number;
  onlineNodes?: number;
};

export type Dashboard = {
  hosts: {
    total: number;
    online: number;
    offline: number;
    warning: number;
    items: DashboardHost[];
  };
  virtualization: { vms: number; lxc: number; running: number; stopped: number; paused: number };
  resources: { cpu: number; memUsed: number; memTotal: number; diskUsed: number; diskTotal: number };
  guests: {
    vms: Array<Omit<Guest, "kind">>;
    containers: Array<Omit<Guest, "kind">>;
  };
};

