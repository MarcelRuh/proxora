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
});
