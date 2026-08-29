import type { ProxmoxHttpClient } from "@/server/proxmox/http";

export interface VmCreateParams {
  vmid: number;
  name?: string;
  description?: string;
  ostype?: string;
  memory?: number;
  balloon?: number;
  cores?: number;
  sockets?: number;
  numa?: number;
  cpu?: string;
  scsihw?: string;
  ide2?: string;
  scsi0?: string;
  virtio0?: string;
  sata0?: string;
  net0?: string;
  bios?: string;
  machine?: string;
  efidisk0?: string;
  tpmstate0?: string;
  onboot?: number;
  agent?: string;
  [key: string]: unknown;
}

export class VmApi {
  constructor(private readonly http: ProxmoxHttpClient) {}

  list(node: string) {
    return this.http.get<Array<Record<string, unknown>>>(
      `/nodes/${encodeURIComponent(node)}/qemu`,
    );
  }

  status(node: string, vmid: number) {
    return this.http.get<Record<string, unknown>>(
      `/nodes/${encodeURIComponent(node)}/qemu/${vmid}/status/current`,
    );
  }

  config(node: string, vmid: number) {
    return this.http.get<Record<string, unknown>>(
      `/nodes/${encodeURIComponent(node)}/qemu/${vmid}/config`,
    );
  }

  updateConfig(node: string, vmid: number, body: Record<string, unknown>) {
    return this.http.put<string>(`/nodes/${encodeURIComponent(node)}/qemu/${vmid}/config`, body);
  }

  create(node: string, params: VmCreateParams) {
    return this.http.post<string>(`/nodes/${encodeURIComponent(node)}/qemu`, params);
  }

  start(node: string, vmid: number) {
    return this.http.post<string>(`/nodes/${encodeURIComponent(node)}/qemu/${vmid}/status/start`);
  }

  stop(node: string, vmid: number) {
    return this.http.post<string>(`/nodes/${encodeURIComponent(node)}/qemu/${vmid}/status/stop`);
  }

  shutdown(node: string, vmid: number) {
    return this.http.post<string>(`/nodes/${encodeURIComponent(node)}/qemu/${vmid}/status/shutdown`);
  }

  reboot(node: string, vmid: number) {
    return this.http.post<string>(`/nodes/${encodeURIComponent(node)}/qemu/${vmid}/status/reboot`);
  }

  reset(node: string, vmid: number) {
    return this.http.post<string>(`/nodes/${encodeURIComponent(node)}/qemu/${vmid}/status/reset`);
  }

  suspend(node: string, vmid: number) {
    return this.http.post<string>(`/nodes/${encodeURIComponent(node)}/qemu/${vmid}/status/suspend`);
  }

  resume(node: string, vmid: number) {
    return this.http.post<string>(`/nodes/${encodeURIComponent(node)}/qemu/${vmid}/status/resume`);
  }

  delete(node: string, vmid: number, purge = true) {
    return this.http.del<string>(`/nodes/${encodeURIComponent(node)}/qemu/${vmid}`, {
      purge: purge ? 1 : 0,
    });
  }

  clone(node: string, vmid: number, params: Record<string, unknown>) {
    return this.http.post<string>(`/nodes/${encodeURIComponent(node)}/qemu/${vmid}/clone`, params);
  }

  migrate(node: string, vmid: number, params: Record<string, unknown>) {
    return this.http.post<string>(`/nodes/${encodeURIComponent(node)}/qemu/${vmid}/migrate`, params);
  }

  snapshots(node: string, vmid: number) {
    return this.http.get<Array<Record<string, unknown>>>(
      `/nodes/${encodeURIComponent(node)}/qemu/${vmid}/snapshot`,
    );
  }

  createSnapshot(node: string, vmid: number, snapname: string, description?: string) {
    return this.http.post<string>(`/nodes/${encodeURIComponent(node)}/qemu/${vmid}/snapshot`, {
      snapname,
      description,
    });
  }

  deleteSnapshot(node: string, vmid: number, snapname: string) {
    return this.http.del<string>(
      `/nodes/${encodeURIComponent(node)}/qemu/${vmid}/snapshot/${encodeURIComponent(snapname)}`,
    );
  }

  rollbackSnapshot(node: string, vmid: number, snapname: string) {
    return this.http.post<string>(
      `/nodes/${encodeURIComponent(node)}/qemu/${vmid}/snapshot/${encodeURIComponent(snapname)}/rollback`,
    );
  }

  resize(node: string, vmid: number, disk: string, size: string) {
    return this.http.put<string>(`/nodes/${encodeURIComponent(node)}/qemu/${vmid}/resize`, { disk, size });
  }

  termproxy(node: string, vmid: number) {
    return this.http.post<{ port: string; ticket: string; user: string }>(
      `/nodes/${encodeURIComponent(node)}/qemu/${vmid}/termproxy`,
    );
  }

  vncproxy(node: string, vmid: number) {
    return this.http.post<{ port: string; ticket: string; user: string }>(
      `/nodes/${encodeURIComponent(node)}/qemu/${vmid}/vncproxy`,
      { websocket: 1 },
    );
  }
}
