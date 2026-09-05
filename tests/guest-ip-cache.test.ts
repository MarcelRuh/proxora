import { describe, expect, it, vi, beforeEach } from "vitest";
import { applyCachedGuestIps, clearGuestIpCache, rememberGuestIpCache, rememberGuestIps } from "@/server/services/guest-ip-cache";
import type { ProxmoxClient } from "@/server/proxmox/client";
import type { GuestListItem } from "@/server/proxmox/types";

function guest(partial: Partial<GuestListItem> & Pick<GuestListItem, "vmid">): GuestListItem {
  return {
    name: `vm-${partial.vmid}`,
    node: "pve",
    status: "running",
    cpu: 0,
    cpus: 1,
    mem: 0,
    maxmem: 1,
    disk: 0,
    maxdisk: 1,
    uptime: 1,
    template: false,
    ...partial,
  };
}

describe("guest IP cache", () => {
  beforeEach(() => {
    clearGuestIpCache();
  });

  it("applies remembered config IPs without another Proxmox call", () => {
    const client = { http: { baseUrl: "https://pve.test" } } as unknown as ProxmoxClient;
    rememberGuestIpCache(client, "lxc", "pve", 204, ["192.168.178.204"]);
    const [row] = applyCachedGuestIps(client, "lxc", [guest({ vmid: 204 })]);
    expect(row?.ips).toEqual(["192.168.178.204"]);
  });

  it("reads QEMU ipconfig and skips a second fetch", async () => {
    const config = vi.fn(async () => ({ ipconfig0: "ip=10.0.0.50/24,gw=10.0.0.1" }));
    const client = {
      http: { baseUrl: "https://pve.test" },
      vms: { config, agentNetworkInterfaces: vi.fn() },
    } as unknown as ProxmoxClient;
    const first = await rememberGuestIps(client, "vm", [guest({ vmid: 50 })]);
    const second = await rememberGuestIps(client, "vm", [guest({ vmid: 50 })]);
    expect(first[0]?.ips).toEqual(["10.0.0.50"]);
    expect(second[0]?.ips).toEqual(["10.0.0.50"]);
    expect(config).toHaveBeenCalledTimes(1);
  });

  it("reads LXC interfaces when config has DHCP", async () => {
    const config = vi.fn(async () => ({ net0: "name=eth0,bridge=vmbr0,ip=dhcp" }));
    const interfaces = vi.fn(async () => [{ name: "eth0", inet: "192.168.178.88/24" }]);
    const client = {
      http: { baseUrl: "https://pve.test" },
      lxc: { config, interfaces },
    } as unknown as ProxmoxClient;
    const rows = await rememberGuestIps(client, "lxc", [guest({ vmid: 88 })]);
    expect(rows[0]?.ips).toEqual(["192.168.178.88"]);
    expect(interfaces).toHaveBeenCalledTimes(1);
  });

  it("retries empty IP results after a short TTL", async () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date("2026-09-05T20:00:00Z"));
      const client = { http: { baseUrl: "https://pve.test" } } as unknown as ProxmoxClient;
      rememberGuestIpCache(client, "vm", "pve", 10, []);
      expect(applyCachedGuestIps(client, "vm", [guest({ vmid: 10 })])[0]?.ips).toEqual([]);
      vi.setSystemTime(new Date("2026-09-05T20:00:25Z"));
      expect(applyCachedGuestIps(client, "vm", [guest({ vmid: 10 })])[0]?.ips).toBeUndefined();
    } finally {
      vi.useRealTimers();
    }
  });
});
