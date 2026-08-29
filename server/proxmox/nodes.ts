import type { ProxmoxHttpClient } from "@/server/proxmox/http";
import type { ClusterStatusEntry, ProxmoxNode, ProxmoxNodeStatus } from "@/server/proxmox/types";

export class NodeApi {
  constructor(private readonly http: ProxmoxHttpClient) {}

  list() {
    return this.http.get<ProxmoxNode[]>("/nodes");
  }

  status(node: string) {
    return this.http.get<ProxmoxNodeStatus>(`/nodes/${encodeURIComponent(node)}/status`);
  }

  reboot(node: string) {
    return this.http.post<string>(`/nodes/${encodeURIComponent(node)}/status`, { command: "reboot" });
  }

  shutdown(node: string) {
    return this.http.post<string>(`/nodes/${encodeURIComponent(node)}/status`, {
      command: "shutdown",
    });
  }

  version(node: string) {
    return this.http.get<{ version: string }>(`/nodes/${encodeURIComponent(node)}/version`);
  }

  dns(node: string) {
    return this.http.get<Record<string, string>>(`/nodes/${encodeURIComponent(node)}/dns`);
  }

  network(node: string) {
    return this.http.get<Array<Record<string, unknown>>>(`/nodes/${encodeURIComponent(node)}/network`);
  }

  time(node: string) {
    return this.http.get<{ time: number; localtime: number; timezone: string }>(
      `/nodes/${encodeURIComponent(node)}/time`,
    );
  }

  termproxy(node: string, extra?: Record<string, unknown>) {
    return this.http.post<{ port: string; ticket: string; user: string; upid?: string }>(
      `/nodes/${encodeURIComponent(node)}/termproxy`,
      extra,
    );
  }

  clusterStatus() {
    return this.http.get<ClusterStatusEntry[]>("/cluster/status");
  }

  nextId() {
    return this.http.get<number>("/cluster/nextid");
  }

  aplinfo(node: string) {
    return this.http.get<Array<Record<string, unknown>>>(`/nodes/${encodeURIComponent(node)}/aplinfo`);
  }

  downloadAppliance(node: string, storage: string, template: string) {
    return this.http.post<string>(`/nodes/${encodeURIComponent(node)}/aplinfo`, { storage, template });
  }
}
