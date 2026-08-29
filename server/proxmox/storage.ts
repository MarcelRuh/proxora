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
