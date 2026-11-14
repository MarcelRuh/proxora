import type { ProxmoxHttpClient } from "@/server/proxmox/http";
import type { ProxmoxStorage, ProxmoxZfsPool } from "@/server/proxmox/types";

export class StorageApi {
  constructor(private readonly http: ProxmoxHttpClient) {}

  list(node?: string) {
    if (node) {
      return this.http.get<ProxmoxStorage[]>(`/nodes/${encodeURIComponent(node)}/storage`);
    }
    return this.http.get<ProxmoxStorage[]>("/storage");
  }

  status(node: string, storage: string) {
    return this.http.get<ProxmoxStorage>(
      `/nodes/${encodeURIComponent(node)}/storage/${encodeURIComponent(storage)}/status`,
    );
  }

  content(node: string, storage: string, content?: string) {
    return this.http.get<Array<Record<string, unknown>>>(
      `/nodes/${encodeURIComponent(node)}/storage/${encodeURIComponent(storage)}/content`,
      content ? { content } : undefined,
    );
  }

  deleteContent(node: string, storage: string, volume: string) {
    return this.http.del<null>(
      `/nodes/${encodeURIComponent(node)}/storage/${encodeURIComponent(storage)}/content/${encodeURIComponent(volume)}`,
    );
  }

  /** Adds a storage to the datacenter config (Datacenter → Storage → Add). */
  create(body: Record<string, string | number>) {
    return this.http.post<null>("/storage", body);
  }

  /** Discovery helpers: /nodes/{node}/scan/{nfs|cifs|pbs|lvm|lvmthin|zfs}. */
  scan(node: string, kind: "nfs" | "cifs" | "pbs" | "lvm" | "lvmthin" | "zfs", params?: Record<string, string | number>) {
    return this.http.get<Array<Record<string, unknown>>>(
      `/nodes/${encodeURIComponent(node)}/scan/${kind}`,
      params,
      20_000,
    );
  }

  downloadUrl(node: string, storage: string, params: { content: "iso" | "vztmpl"; url: string; filename: string }) {
    return this.http.post<string>(
      `/nodes/${encodeURIComponent(node)}/storage/${encodeURIComponent(storage)}/download-url`,
      params,
    );
  }
}

export class ZfsApi {
  constructor(private readonly http: ProxmoxHttpClient) {}

  pools(node: string) {
    return this.http.get<ProxmoxZfsPool[]>(`/nodes/${encodeURIComponent(node)}/disks/zfs`);
  }

  poolDetail(node: string, name: string) {
    return this.http.get<Record<string, unknown>>(
      `/nodes/${encodeURIComponent(node)}/disks/zfs/${encodeURIComponent(name)}`,
    );
  }

  disks(node: string) {
    return this.http.get<Array<Record<string, unknown>>>(
      `/nodes/${encodeURIComponent(node)}/disks/list`,
    );
  }
}
