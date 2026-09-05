export type ProxmoxAuthType = "API_TOKEN" | "PASSWORD";

export type FederationTransport = {
  peerBaseUrl: string;
  token: string;
  remoteHostId: string;
};

export interface ProxmoxConnectionConfig {
  url: string;
  authType: ProxmoxAuthType;
  username: string;
  tokenId?: string | null;
  secret: string;
  allowInsecureTls?: boolean;
  timeoutMs?: number;
  federation?: FederationTransport;
}

export interface ProxmoxVersion {
  version: string;
  release: string;
  repoid?: string;
}

export interface ProxmoxNode {
  node: string;
  status: string;
  cpu?: number;
  maxcpu?: number;
  mem?: number;
  maxmem?: number;
  disk?: number;
  maxdisk?: number;
  uptime?: number;
  ssl_fingerprint?: string;
  level?: string;
}

export interface ProxmoxNodeStatus {
  cpu: number;
  wait?: number;
  loadavg?: [string, string, string];
  memory: { total: number; used: number; free: number };
  swap?: { total: number; used: number; free: number };
  rootfs?: { total: number; used: number; free: number; avail: number };
  uptime: number;
  ksm?: { shared: number };
  idle?: number;
  kversion?: string;
  pveversion?: string;
  cpuinfo?: { cpus?: number; cores?: number; sockets?: number; model?: string; mhz?: string };
}

export interface ProxmoxResource {
  id: string;
  type: string;
  node?: string;
  vmid?: number;
  name?: string;
  status?: string;
  cpu?: number;
  cpus?: number;
  maxcpu?: number;
  mem?: number;
  maxmem?: number;
  disk?: number;
  maxdisk?: number;
  netin?: number;
  netout?: number;
  diskread?: number;
  diskwrite?: number;
  uptime?: number;
  template?: number;
  tags?: string;
  description?: string;
}

export interface ProxmoxTask {
  upid: string;
  type: string;
  status?: string;
  exitstatus?: string;
  starttime: number;
  endtime?: number;
  node: string;
  user: string;
  id?: string;
  pid?: number;
}

export interface ProxmoxStorage {
  storage: string;
  type: string;
  content?: string;
  active?: number;
  enabled?: number;
  shared?: number;
  used?: number;
  avail?: number;
  total?: number;
  used_fraction?: number;
}

export interface ProxmoxZfsPool {
  name: string;
  health: string;
  size: number;
  alloc: number;
  free: number;
  frag?: number;
  dedup?: number;
}

export interface ProxmoxAptUpdate {
  Package: string;
  Title?: string;
  Version?: string;
  OldVersion?: string;
  Description?: string;
  Section?: string;
  Priority?: string;
  Origin?: string;
  Arch?: string;
}

export interface TermProxyResult {
  port: string;
  ticket: string;
  user: string;
  upid?: string;
}

export interface ClusterStatusEntry {
  type: string;
  id: string;
  name?: string;
  ip?: string;
  local?: number;
  nodes?: number;
  quorate?: number;
  online?: number;
  level?: string;
}

export interface PermissionMap {
  [path: string]: Record<string, number>;
}

export type GuestStatus = "running" | "stopped" | "paused" | "unknown";

export interface GuestListItem {
  vmid: number;
  name: string;
  node: string;
  status: GuestStatus;
  cpu: number;
  cpus: number;
  mem: number;
  maxmem: number;
  disk: number;
  maxdisk: number;
  uptime: number;
  tags?: string;
  description?: string;
  ips?: string[];
  template: boolean;
  netin?: number;
  netout?: number;
}

export interface ConnectionTestResult {
  ok: boolean;
  version?: ProxmoxVersion;
  cluster?: {
    isCluster: boolean;
    name?: string;
    quorate?: boolean;
    nodes?: number;
  };
  nodes?: Array<{
    node: string;
    status: string;
    cpu?: number;
    mem?: number;
  }>;
  permissions?: PermissionMap;
  error?: string;
}
