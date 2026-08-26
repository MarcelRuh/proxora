import type { ProxmoxHttpClient } from "@/server/proxmox/http";
import type { ProxmoxAptUpdate, ProxmoxTask } from "@/server/proxmox/types";

export class TaskApi {
  constructor(private readonly http: ProxmoxHttpClient) {}

  list(node: string, extra?: Record<string, string | number>) {
    return this.http.get<ProxmoxTask[]>(`/nodes/${encodeURIComponent(node)}/tasks`, extra);
  }

  status(node: string, upid: string) {
    return this.http.get<ProxmoxTask>(
      `/nodes/${encodeURIComponent(node)}/tasks/${encodeURIComponent(upid)}/status`,
    );
  }

  log(node: string, upid: string, start = 0, limit = 500) {
    return this.http.get<Array<{ n: number; t: string }>>(
      `/nodes/${encodeURIComponent(node)}/tasks/${encodeURIComponent(upid)}/log`,
      { start, limit },
    );
  }

  stop(node: string, upid: string) {
    return this.http.del<null>(
      `/nodes/${encodeURIComponent(node)}/tasks/${encodeURIComponent(upid)}`,
    );
  }
}

export class UpdateApi {
  constructor(private readonly http: ProxmoxHttpClient) {}

  list(node: string) {
    return this.http.get<ProxmoxAptUpdate[]>(`/nodes/${encodeURIComponent(node)}/apt/update`);
  }

  refresh(node: string) {
    return this.http.post<string>(`/nodes/${encodeURIComponent(node)}/apt/update`);
  }

  upgrade(node: string) {
    return this.http.post<string>(`/nodes/${encodeURIComponent(node)}/apt/upgrade`, undefined, {
      quiet: 1,
    });
  }

  changelog(node: string, name: string) {
    return this.http.get<string>(`/nodes/${encodeURIComponent(node)}/apt/changelog`, { name });
  }

  version(node: string) {
    return this.http.get<{ version: string }>(`/nodes/${encodeURIComponent(node)}/apt/versions`);
  }
}

export class ClusterApi {
  constructor(private readonly http: ProxmoxHttpClient) {}

  status() {
    return this.http.get<Array<Record<string, unknown>>>("/cluster/status");
  }

  resources(type?: string) {
    return this.http.get<Array<Record<string, unknown>>>(
      "/cluster/resources",
      type ? { type } : undefined,
    );
  }

  nextId() {
    return this.http.get<number>("/cluster/nextid");
  }

  options() {
    return this.http.get<Record<string, unknown>>("/cluster/options");
  }
}
