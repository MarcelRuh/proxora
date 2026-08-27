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
};

export type SessionUser = {
  id: string;
  username: string;
  email: string;
  role: { id: string; slug: string; name: string; permissions: string[] };
  allowedHostIds: string[] | null;
  allowedGuests: Array<{ hostId: string; kind: "vm" | "lxc"; vmid: number }> | null;
};
