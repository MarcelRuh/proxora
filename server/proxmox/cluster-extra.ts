import type { ProxmoxHttpClient } from "@/server/proxmox/http";

export class HaApi {
  constructor(private readonly http: ProxmoxHttpClient) {}

  resources() {
    return this.http.get<Array<Record<string, unknown>>>("/cluster/ha/resources");
  }

  groups() {
    return this.http.get<Array<Record<string, unknown>>>("/cluster/ha/groups");
  }

  get(sid: string) {
    return this.http.get<Record<string, unknown>>(`/cluster/ha/resources/${encodeURIComponent(sid)}`);
  }

  create(body: Record<string, unknown>) {
    return this.http.post<null>("/cluster/ha/resources", body);
  }

  update(sid: string, body: Record<string, unknown>) {
    return this.http.put<null>(`/cluster/ha/resources/${encodeURIComponent(sid)}`, body);
  }

  delete(sid: string) {
    return this.http.del<null>(`/cluster/ha/resources/${encodeURIComponent(sid)}`);
  }
}

export class ReplicationApi {
  constructor(private readonly http: ProxmoxHttpClient) {}

  list() {
    return this.http.get<Array<Record<string, unknown>>>("/cluster/replication");
  }
}

export class GuestFirewallApi {
  constructor(private readonly http: ProxmoxHttpClient) {}

  private prefix(kind: "vm" | "lxc", node: string, vmid: number) {
    const type = kind === "lxc" ? "lxc" : "qemu";
    return `/nodes/${encodeURIComponent(node)}/${type}/${vmid}/firewall`;
  }

  options(kind: "vm" | "lxc", node: string, vmid: number) {
    return this.http.get<Record<string, unknown>>(`${this.prefix(kind, node, vmid)}/options`);
  }

  setOptions(kind: "vm" | "lxc", node: string, vmid: number, body: Record<string, unknown>) {
    return this.http.put<null>(`${this.prefix(kind, node, vmid)}/options`, body);
  }

  rules(kind: "vm" | "lxc", node: string, vmid: number) {
    return this.http.get<Array<Record<string, unknown>>>(`${this.prefix(kind, node, vmid)}/rules`);
  }

  createRule(kind: "vm" | "lxc", node: string, vmid: number, body: Record<string, unknown>) {
    return this.http.post<null>(`${this.prefix(kind, node, vmid)}/rules`, body);
  }

  deleteRule(kind: "vm" | "lxc", node: string, vmid: number, pos: number) {
    return this.http.del<null>(`${this.prefix(kind, node, vmid)}/rules/${pos}`);
  }
}
