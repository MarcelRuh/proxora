import { ProxmoxApiError } from "@/lib/errors";
import type { ProxmoxHttpClient } from "@/server/proxmox/http";
import type { ProxmoxAptUpdate, ProxmoxTask } from "@/server/proxmox/types";

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

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

  async wait(node: string, upid: string, timeoutMs = 180_000, intervalMs = 1_500) {
    const started = Date.now();
    while (Date.now() - started < timeoutMs) {
      const st = await this.status(node, upid);
      if (st.status && st.status !== "running") {
        const exit = st.exitstatus ?? "OK";
        if (exit === "OK") return st;
        throw new ProxmoxApiError(`Proxmox-Task fehlgeschlagen: ${exit}`, 502);
      }
      await sleep(intervalMs);
    }
    throw new ProxmoxApiError("Zeitüberschreitung beim Warten auf den Proxmox-Task", 504);
  }
}

export class UpdateApi {
  constructor(private readonly http: ProxmoxHttpClient) {}

  async list(node: string) {
    const data = await this.http.get<ProxmoxAptUpdate[] | null>(
      `/nodes/${encodeURIComponent(node)}/apt/update`,
    );
    return Array.isArray(data) ? data : [];
  }

  refresh(node: string) {
    return this.http.post<string>(`/nodes/${encodeURIComponent(node)}/apt/update`, { quiet: 1 });
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
