import { ProxmoxHttpClient } from "@/server/proxmox/http";
import { ClusterApi, TaskApi, UpdateApi } from "@/server/proxmox/tasks";
import { LxcApi } from "@/server/proxmox/lxc";
import { NodeApi } from "@/server/proxmox/nodes";
import { StorageApi, ZfsApi } from "@/server/proxmox/storage";
import type {
  ClusterStatusEntry,
  ConnectionTestResult,
  GuestListItem,
  GuestStatus,
  PermissionMap,
  ProxmoxConnectionConfig,
  ProxmoxResource,
  ProxmoxVersion,
} from "@/server/proxmox/types";
import { VmApi } from "@/server/proxmox/vms";
import { BackupApi } from "@/server/proxmox/backup";

export class ProxmoxClient {
  readonly http: ProxmoxHttpClient;
  readonly nodes: NodeApi;
  readonly vms: VmApi;
  readonly lxc: LxcApi;
  readonly storage: StorageApi;
  readonly zfs: ZfsApi;
  readonly tasks: TaskApi;
  readonly updates: UpdateApi;
  readonly cluster: ClusterApi;
  readonly backup: BackupApi;

  constructor(config: ProxmoxConnectionConfig) {
    this.http = new ProxmoxHttpClient(config);
    this.nodes = new NodeApi(this.http);
    this.vms = new VmApi(this.http);
    this.lxc = new LxcApi(this.http);
    this.storage = new StorageApi(this.http);
    this.zfs = new ZfsApi(this.http);
    this.tasks = new TaskApi(this.http);
    this.updates = new UpdateApi(this.http);
    this.cluster = new ClusterApi(this.http);
    this.backup = new BackupApi(this.http);
  }

  version() {
    return this.http.get<ProxmoxVersion>("/version");
  }

  permissions() {
    return this.http.get<PermissionMap>("/access/permissions");
  }

  async testConnection(): Promise<ConnectionTestResult> {
    try {
      const [version, cluster, nodes, permissions] = await Promise.all([
        this.version(),
        this.cluster.status().catch(() => [] as ClusterStatusEntry[]),
        this.nodes.list(),
        this.permissions().catch(() => ({}) as PermissionMap),
      ]);

      const clusterInfo = (cluster as ClusterStatusEntry[]).find((c) => c.type === "cluster");
      return {
        ok: true,
        version,
        cluster: {
          isCluster: Boolean(clusterInfo),
          name: clusterInfo?.name,
          quorate: clusterInfo?.quorate === 1,
          nodes: clusterInfo?.nodes,
        },
        nodes: nodes.map((n) => ({
          node: n.node,
          status: n.status,
          cpu: n.cpu,
          mem: n.mem && n.maxmem ? n.mem / n.maxmem : undefined,
        })),
        permissions,
      };
    } catch (error) {
      return {
        ok: false,
        error: error instanceof Error ? error.message : "Unknown error",
      };
    }
  }

  async listResources(type?: "vm" | "storage" | "node") {
    return this.cluster.resources(type) as unknown as Promise<ProxmoxResource[]>;
  }

  async listInventory(): Promise<{ nodes: ProxmoxResource[]; vms: GuestListItem[]; containers: GuestListItem[] }> {
    const resources = await this.listResources();
    return splitResources(resources);
  }

  async listGuests(): Promise<{ vms: GuestListItem[]; containers: GuestListItem[] }> {
    const resources = await this.listResources("vm");
    const { vms, containers } = splitResources(resources);
    return { vms, containers };
  }

  async listVms(): Promise<GuestListItem[]> {
    const { vms } = await this.listGuests();
    return vms;
  }

  async listContainers(): Promise<GuestListItem[]> {
    const { containers } = await this.listGuests();
    return containers;
  }
}

function splitResources(resources: ProxmoxResource[]) {
  return {
    nodes: resources.filter((r) => r.type === "node"),
    vms: resources.filter((r) => r.type === "qemu").map((r) => mapGuest(r)),
    containers: resources.filter((r) => r.type === "lxc").map((r) => mapGuest(r)),
  };
}

function mapGuest(r: ProxmoxResource): GuestListItem {
  const status = (r.status ?? "unknown") as GuestStatus;
  return {
    vmid: r.vmid ?? 0,
    name: r.name ?? `id-${r.vmid}`,
    node: r.node ?? "",
    status: ["running", "stopped", "paused"].includes(status) ? status : "unknown",
    cpu: r.cpu ?? 0,
    cpus: r.cpus ?? r.maxcpu ?? 0,
    mem: r.mem ?? 0,
    maxmem: r.maxmem ?? 0,
    disk: r.disk ?? 0,
    maxdisk: r.maxdisk ?? 0,
    uptime: r.uptime ?? 0,
    tags: r.tags,
    template: r.template === 1,
    netin: r.netin,
    netout: r.netout,
  };
}

export function createProxmoxClient(config: ProxmoxConnectionConfig): ProxmoxClient {
  return new ProxmoxClient(config);
}
