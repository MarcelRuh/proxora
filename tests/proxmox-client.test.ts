import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("undici", () => {
  return {
    Agent: class Agent {},
    fetch: vi.fn(),
  };
});

import { fetch as undiciFetch } from "undici";
import { ProxmoxClient } from "@/server/proxmox/client";

function jsonResponse(data: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => JSON.stringify({ data }),
    json: async () => ({ data }),
  };
}

describe("ProxmoxClient", () => {
  const client = new ProxmoxClient({
    url: "https://pve.example:8006",
    authType: "API_TOKEN",
    username: "root@pam",
    tokenId: "manager",
    secret: "secret",
    allowInsecureTls: true,
  });

  beforeEach(() => {
    vi.mocked(undiciFetch).mockReset();
  });

  it("normalizes host URLs to HTTPS", () => {
    const c = new ProxmoxClient({
      url: "192.168.1.10:8006",
      authType: "API_TOKEN",
      username: "root@pam",
      tokenId: "manager",
      secret: "secret",
    });
    expect(c.http.baseUrl).toBe("https://192.168.1.10:8006");
  });

  it("lists VMs from cluster resources", async () => {
    vi.mocked(undiciFetch).mockResolvedValueOnce(
      jsonResponse([
        { type: "qemu", vmid: 100, name: "web", node: "pve", status: "running", cpu: 0.1, cpus: 2, mem: 1, maxmem: 2, disk: 1, maxdisk: 2, uptime: 10 },
        { type: "lxc", vmid: 200, name: "db", node: "pve", status: "stopped" },
      ]) as never,
    );
    const vms = await client.listVms();
    expect(vms).toHaveLength(1);
    expect(vms[0]?.name).toBe("web");
    const [url, init] = vi.mocked(undiciFetch).mock.calls[0] ?? [];
    expect(String(url)).toContain("/cluster/resources");
    expect(String((init as { headers?: Record<string, string> })?.headers?.Authorization)).toContain(
      "PVEAPIToken=root@pam!manager=",
    );
  });

  it("logs in with root password via /access/ticket", async () => {
    const passwordClient = new ProxmoxClient({
      url: "https://pve.example:8006",
      authType: "PASSWORD",
      username: "root",
      secret: "pve-root-pw",
      allowInsecureTls: true,
    });
    vi.mocked(undiciFetch)
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ data: { ticket: "PVE:ticket", CSRFPreventionToken: "CSRF" } }),
        text: async () => JSON.stringify({ data: { ticket: "PVE:ticket", CSRFPreventionToken: "CSRF" } }),
      } as never)
      .mockResolvedValueOnce(jsonResponse({ version: "8.4" }) as never);
    const version = await passwordClient.http.get<{ version: string }>("/version");
    expect(version.version).toBe("8.4");
    const [ticketUrl, ticketInit] = vi.mocked(undiciFetch).mock.calls[0] ?? [];
    expect(String(ticketUrl)).toContain("/access/ticket");
    expect(String((ticketInit as { body?: string })?.body)).toContain("username=root%40pam");
    const [, versionInit] = vi.mocked(undiciFetch).mock.calls[1] ?? [];
    expect((versionInit as { headers?: Record<string, string> })?.headers?.Cookie).toBe("PVEAuthCookie=PVE:ticket");
  });

  it("starts a VM via the QEMU status API", async () => {
    vi.mocked(undiciFetch).mockResolvedValueOnce(jsonResponse("UPID:pve:000") as never);
    const upid = await client.vms.start("pve", 100);
    expect(upid).toBe("UPID:pve:000");
    const [url, init] = vi.mocked(undiciFetch).mock.calls[0] ?? [];
    expect(String(url)).toContain("/nodes/pve/qemu/100/status/start");
    expect((init as { method?: string })?.method).toBe("POST");
  });

  it("creates an LXC container", async () => {
    vi.mocked(undiciFetch).mockResolvedValueOnce(jsonResponse("UPID:pve:lxc") as never);
    await client.lxc.create("pve", {
      vmid: 201,
      ostemplate: "local:vztmpl/debian-12-standard_12.2-1_amd64.tar.zst",
      hostname: "web",
      rootfs: "local-lvm:8",
    });
    const [url] = vi.mocked(undiciFetch).mock.calls[0] ?? [];
    expect(String(url)).toContain("/nodes/pve/lxc");
  });

  it("lists storage", async () => {
    vi.mocked(undiciFetch).mockResolvedValueOnce(
      jsonResponse([{ storage: "local", type: "dir", total: 100, used: 40, avail: 60 }]) as never,
    );
    const storage = await client.storage.list("pve");
    expect(storage[0]?.storage).toBe("local");
  });

  it("tests a connection and reports cluster/standalone", async () => {
    vi.mocked(undiciFetch)
      .mockResolvedValueOnce(jsonResponse({ version: "9.0.3", release: "9" }) as never)
      .mockResolvedValueOnce(jsonResponse([{ type: "node", id: "node/pve" }]) as never)
      .mockResolvedValueOnce(jsonResponse([{ node: "pve", status: "online" }]) as never)
      .mockResolvedValueOnce(jsonResponse({}) as never);
    const result = await client.testConnection();
    expect(result.ok).toBe(true);
    expect(result.cluster?.isCluster).toBe(false);
    expect(result.version?.version).toBe("9.0.3");
  });
});
