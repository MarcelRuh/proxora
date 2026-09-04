import { describe, expect, it, vi, beforeEach } from "vitest";
import { identityConflict } from "@/lib/guest-identity";
import { mergeUsedGuestSets } from "@/lib/next-vmid";
import { collectUsedGuestIps } from "@/server/services/guest-ips";
import { clearGuestIpCache, rememberGuestIpCache } from "@/server/services/guest-ip-cache";
import type { ProxmoxClient } from "@/server/proxmox/client";
import type { GuestListItem } from "@/server/proxmox/types";

describe("mergeUsedGuestSets", () => {
  it("unions VMIDs and IPs from every host", () => {
    const merged = mergeUsedGuestSets([
      { vmids: [246, 247, 248, 249], ips: ["192.168.178.246"] },
      { vmids: [243, 244, 245], ips: ["192.168.178.243"] },
    ]);
    expect(merged.vmids.sort((a, b) => a - b)).toEqual([243, 244, 245, 246, 247, 248, 249]);
    expect(merged.ips.sort()).toEqual(["192.168.178.243", "192.168.178.246"]);
  });

  it("ignores empty or unreachable hosts", () => {
    const merged = mergeUsedGuestSets([{ vmids: [100] }, { vmids: [], ips: [] }]);
    expect(merged.vmids).toEqual([100]);
    expect(merged.ips).toEqual([]);
  });
});

describe("identityConflict", () => {
  it("detects a taken VMID without loading configs", () => {
    expect(identityConflict({ vmids: [100, 101] }, 101)).toBe("vmid");
    expect(identityConflict({ vmids: [100] }, 242)).toBeNull();
  });

  it("detects a taken IP only when one is provided", () => {
    expect(identityConflict({ vmids: [100], ips: ["192.168.178.101"] }, 101, "192.168.178.101")).toBe("ip");
    expect(identityConflict({ vmids: [100], ips: ["192.168.178.101"] }, 101)).toBeNull();
  });
});

function listedGuest(vmid: number): GuestListItem {
  return {
    name: `vm-${vmid}`,
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
    vmid,
  };
}

describe("collectUsedGuestIps cache", () => {
  beforeEach(() => {
    clearGuestIpCache();
  });

  it("reuses cached IPs instead of loading every guest config", async () => {
    const config = vi.fn();
    const client = {
      http: { baseUrl: "https://pve.test" },
      listGuests: async () => ({ vms: [listedGuest(100)], containers: [] }),
      vms: { config },
      lxc: { config },
    } as unknown as ProxmoxClient;
    rememberGuestIpCache(client, "vm", "pve", 100, ["10.0.0.8"]);
    const used = await collectUsedGuestIps(client);
    expect(used.vmids).toEqual([100]);
    expect(used.ips).toEqual(["10.0.0.8"]);
    expect(config).not.toHaveBeenCalled();
  });

  it("loads config only for cache misses", async () => {
    const config = vi.fn(async () => ({ ipconfig0: "ip=10.0.0.9/24,gw=10.0.0.1" }));
    const client = {
      http: { baseUrl: "https://pve.test" },
      listGuests: async () => ({ vms: [listedGuest(100), listedGuest(101)], containers: [] }),
      vms: { config },
      lxc: { config: vi.fn() },
    } as unknown as ProxmoxClient;
    rememberGuestIpCache(client, "vm", "pve", 100, ["10.0.0.8"]);
    const used = await collectUsedGuestIps(client);
    expect(used.ips.sort()).toEqual(["10.0.0.8", "10.0.0.9"]);
    expect(config).toHaveBeenCalledTimes(1);
    expect(config).toHaveBeenCalledWith("pve", 101);
  });
});
