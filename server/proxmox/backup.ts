import type { ProxmoxHttpClient } from "@/server/proxmox/http";

export class BackupApi {
  constructor(private readonly http: ProxmoxHttpClient) {}

  jobs() {
    return this.http.get<Array<Record<string, unknown>>>("/cluster/backup");
  }

  createJob(params: Record<string, unknown>) {
    return this.http.post<null>("/cluster/backup", params);
  }

  updateJob(id: string, params: Record<string, unknown>) {
    return this.http.put<null>(`/cluster/backup/${encodeURIComponent(id)}`, params);
  }

  deleteJob(id: string) {
    return this.http.del<null>(`/cluster/backup/${encodeURIComponent(id)}`);
  }

  start(node: string, params: Record<string, unknown>) {
    return this.http.post<string>(`/nodes/${encodeURIComponent(node)}/vzdump`, params);
  }

  restoreVm(node: string, params: Record<string, unknown>) {
    return this.http.post<string>(`/nodes/${encodeURIComponent(node)}/qemu`, params);
  }

  restoreLxc(node: string, params: Record<string, unknown>) {
    return this.http.post<string>(`/nodes/${encodeURIComponent(node)}/lxc`, params);
  }
}
