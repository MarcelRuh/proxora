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
    expect(vms[0]?.cpus).toBe(2);
    expect(vms[0]?.maxmem).toBe(2);
    const [url, init] = vi.mocked(undiciFetch).mock.calls[0] ?? [];
    expect(String(url)).toContain("/cluster/resources");
    expect(String((init as { headers?: Record<string, string> })?.headers?.Authorization)).toContain(
      "PVEAPIToken=root@pam!manager=",
    );
  });

  it("maps LXC maxcpu and memory from cluster resources", async () => {
    vi.mocked(undiciFetch).mockResolvedValueOnce(
      jsonResponse([
        {
          type: "lxc",
          vmid: 200,
          name: "db",
          node: "pve",
          status: "running",
          cpu: 0.2,
          maxcpu: 2,
          mem: 512 * 1024 * 1024,
          maxmem: 2 * 1024 * 1024 * 1024,
          disk: 1024 * 1024 * 1024,
          maxdisk: 8 * 1024 * 1024 * 1024,
          uptime: 90,
        },
      ]) as never,
    );
    const cts = await client.listContainers();
    expect(cts).toHaveLength(1);
    expect(cts[0]?.cpus).toBe(2);
    expect(cts[0]?.mem).toBe(512 * 1024 * 1024);
    expect(cts[0]?.maxmem).toBe(2 * 1024 * 1024 * 1024);
    expect(cts[0]?.maxdisk).toBe(8 * 1024 * 1024 * 1024);
    expect(cts[0]?.uptime).toBe(90);
  });

  it("splits nodes and guests from one cluster/resources call", async () => {
    vi.mocked(undiciFetch).mockResolvedValueOnce(
      jsonResponse([
        { type: "node", node: "pve1", status: "online", cpu: 0.2, maxcpu: 8, mem: 1, maxmem: 2, disk: 1, maxdisk: 4, uptime: 100 },
        { type: "node", node: "pve2", status: "online", cpu: 0.4, maxcpu: 8, mem: 1, maxmem: 2, disk: 1, maxdisk: 4, uptime: 50 },
        { type: "qemu", vmid: 100, name: "web", node: "pve1", status: "running" },
        { type: "lxc", vmid: 200, name: "db", node: "pve2", status: "running", maxcpu: 2 },
        { type: "storage", storage: "local" },
      ]) as never,
    );
    const inv = await client.listInventory();
    expect(inv.nodes).toHaveLength(2);
    expect(inv.vms).toHaveLength(1);
    expect(inv.containers).toHaveLength(1);
    expect(inv.containers[0]?.cpus).toBe(2);
    expect(vi.mocked(undiciFetch).mock.calls).toHaveLength(1);
    expect(String(vi.mocked(undiciFetch).mock.calls[0]?.[0])).toContain("/cluster/resources");
    expect(String(vi.mocked(undiciFetch).mock.calls[0]?.[0])).not.toContain("type=");
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
    const upid = await client.lxc.create("pve", {
      vmid: 201,
      ostemplate: "local:vztmpl/debian-12-standard_12.2-1_amd64.tar.zst",
      hostname: "web",
      rootfs: "local-lvm:8",
    });
    expect(upid).toBe("UPID:pve:lxc");
    const [url, init] = vi.mocked(undiciFetch).mock.calls[0] ?? [];
    expect(String(url)).toContain("/nodes/pve/lxc");
    expect((init as { method?: string })?.method).toBe("POST");
  });

  it("downloads an LXC template from the appliance catalog", async () => {
    vi.mocked(undiciFetch).mockResolvedValueOnce(jsonResponse("UPID:pve:download") as never);
    const upid = await client.nodes.downloadAppliance("pve", "local", "debian-12-standard_12.7-1_amd64.tar.zst");
    expect(upid).toBe("UPID:pve:download");
    const [url, init] = vi.mocked(undiciFetch).mock.calls[0] ?? [];
    expect(String(url)).toContain("/nodes/pve/aplinfo");
    expect((init as { method?: string })?.method).toBe("POST");
    expect(String((init as { body?: string })?.body)).toContain("storage=local");
    expect(String((init as { body?: string })?.body)).toContain("template=debian-12-standard_12.7-1_amd64.tar.zst");
  });

  it("refreshes the APT package list, not a nonexistent /apt/upgrade path", async () => {
    vi.mocked(undiciFetch).mockResolvedValueOnce(jsonResponse("UPID:pve:apt") as never);
    const upid = await client.updates.refresh("pve");
    expect(upid).toBe("UPID:pve:apt");
    const [url, init] = vi.mocked(undiciFetch).mock.calls[0] ?? [];
    expect(String(url)).toContain("/nodes/pve/apt/update");
    expect(String(url)).not.toContain("/apt/upgrade");
    expect((init as { method?: string })?.method).toBe("POST");
    expect(String((init as { body?: string })?.body)).toContain("quiet=1");
  });

  it("waits until a Proxmox task stops with OK", async () => {
    vi.mocked(undiciFetch)
      .mockResolvedValueOnce(jsonResponse({ status: "running", upid: "UPID:1", starttime: 1, node: "pve", user: "root@pam", type: "aptupdate" }) as never)
      .mockResolvedValueOnce(jsonResponse({ status: "stopped", exitstatus: "OK", upid: "UPID:1", starttime: 1, node: "pve", user: "root@pam", type: "aptupdate" }) as never);
    const st = await client.tasks.wait("pve", "UPID:1", 5_000, 1);
    expect(st.exitstatus).toBe("OK");
  });

  it("fails wait when the task exitstatus is not OK", async () => {
    vi.mocked(undiciFetch).mockResolvedValueOnce(
      jsonResponse({
        status: "stopped",
        exitstatus: "command failed",
        upid: "UPID:1",
        starttime: 1,
        node: "pve",
        user: "root@pam",
        type: "aptupdate",
      }) as never,
    );
    await expect(client.tasks.wait("pve", "UPID:1", 5_000, 1)).rejects.toThrow(/command failed/);
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
