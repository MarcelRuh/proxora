import type { ProxmoxHttpClient } from "@/server/proxmox/http";

export interface LxcCreateParams {
  vmid: number;
  ostemplate: string;
  hostname?: string;
  password?: string;
  "ssh-public-keys"?: string;
  rootfs?: string;
  cores?: number;
  memory?: number;
  swap?: number;
  net0?: string;
  unprivileged?: number;
  features?: string;
  nameserver?: string;
  searchdomain?: string;
  onboot?: number;
  description?: string;
  [key: string]: unknown;
}

export class LxcApi {
  constructor(private readonly http: ProxmoxHttpClient) {}

  list(node: string) {
    return this.http.get<Array<Record<string, unknown>>>(
      `/nodes/${encodeURIComponent(node)}/lxc`,
    );
  }

  status(node: string, vmid: number) {
    return this.http.get<Record<string, unknown>>(
      `/nodes/${encodeURIComponent(node)}/lxc/${vmid}/status/current`,
    );
  }

  config(node: string, vmid: number) {
    return this.http.get<Record<string, unknown>>(
      `/nodes/${encodeURIComponent(node)}/lxc/${vmid}/config`,
    );
  }

  updateConfig(node: string, vmid: number, body: Record<string, unknown>) {
    return this.http.put<string>(`/nodes/${encodeURIComponent(node)}/lxc/${vmid}/config`, body);
  }

  create(node: string, params: LxcCreateParams) {
    return this.http.post<string>(`/nodes/${encodeURIComponent(node)}/lxc`, params);
  }

  start(node: string, vmid: number) {
    return this.http.post<string>(`/nodes/${encodeURIComponent(node)}/lxc/${vmid}/status/start`);
  }

  stop(node: string, vmid: number) {
    return this.http.post<string>(`/nodes/${encodeURIComponent(node)}/lxc/${vmid}/status/stop`);
  }

  shutdown(node: string, vmid: number) {
    return this.http.post<string>(`/nodes/${encodeURIComponent(node)}/lxc/${vmid}/status/shutdown`);
  }

  reboot(node: string, vmid: number) {
    return this.http.post<string>(`/nodes/${encodeURIComponent(node)}/lxc/${vmid}/status/reboot`);
  }

  delete(node: string, vmid: number, purge = true) {
    return this.http.del<string>(`/nodes/${encodeURIComponent(node)}/lxc/${vmid}`, {
      purge: purge ? 1 : 0,
    });
  }

  clone(node: string, vmid: number, params: Record<string, unknown>) {
    return this.http.post<string>(`/nodes/${encodeURIComponent(node)}/lxc/${vmid}/clone`, params);
  }

  snapshots(node: string, vmid: number) {
    return this.http.get<Array<Record<string, unknown>>>(
      `/nodes/${encodeURIComponent(node)}/lxc/${vmid}/snapshot`,
    );
  }

  createSnapshot(node: string, vmid: number, snapname: string, description?: string) {
    return this.http.post<string>(`/nodes/${encodeURIComponent(node)}/lxc/${vmid}/snapshot`, {
      snapname,
      description,
    });
  }

  deleteSnapshot(node: string, vmid: number, snapname: string) {
    return this.http.del<string>(
      `/nodes/${encodeURIComponent(node)}/lxc/${vmid}/snapshot/${encodeURIComponent(snapname)}`,
    );
  }

  rollbackSnapshot(node: string, vmid: number, snapname: string) {
    return this.http.post<string>(
      `/nodes/${encodeURIComponent(node)}/lxc/${vmid}/snapshot/${encodeURIComponent(snapname)}/rollback`,
    );
  }

  resize(node: string, vmid: number, disk: string, size: string) {
    return this.http.put<string>(`/nodes/${encodeURIComponent(node)}/lxc/${vmid}/resize`, { disk, size });
  }

  termproxy(node: string, vmid: number) {
    return this.http.post<{ port: string; ticket: string; user: string }>(
      `/nodes/${encodeURIComponent(node)}/lxc/${vmid}/termproxy`,
    );
  }
}
