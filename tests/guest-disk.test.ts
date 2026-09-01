import { describe, expect, it, vi, beforeEach } from "vitest";
import { applyCachedVmDisks, attachVmAgentDisks, clearVmDiskCache, vmDiskFromAgent } from "@/server/services/guest-disk";
import type { ProxmoxClient } from "@/server/proxmox/client";
import type { GuestListItem } from "@/server/proxmox/types";

const GB = 1024 * 1024 * 1024;

function guest(partial: Partial<GuestListItem> & Pick<GuestListItem, "vmid">): GuestListItem {
  return {
    name: `vm-${partial.vmid}`,
    node: "pve",
    status: "running",
    cpu: 0,
    cpus: 2,
    mem: 0,
    maxmem: 1,
    disk: 0,
    maxdisk: 0,
    uptime: 10,
    template: false,
    ...partial,
  };
}

function clientWithFs(fs: unknown, calls?: { n: number }): ProxmoxClient {
  return {
    http: { baseUrl: "https://pve.test" },
    vms: {
      agentFsInfo: vi.fn(async () => {
        if (calls) calls.n += 1;
        return fs;
      }),
    },
  } as unknown as ProxmoxClient;
}

describe("attachVmAgentDisks", () => {
  beforeEach(() => {
    clearVmDiskCache();
  });

  it("fills running VM disk from guest agent fsinfo", async () => {
    const client = clientWithFs({
      result: [{ mountpoint: "/", type: "ext4", "used-bytes": 20 * GB, "total-bytes": 100 * GB }],
    });
    const [vm] = await attachVmAgentDisks(client, [guest({ vmid: 100 })]);
    expect(vm?.disk).toBe(20 * GB);
    expect(vm?.maxdisk).toBe(100 * GB);
  });

  it("skips stopped guests and uses cache on the second pass", async () => {
    const calls = { n: 0 };
    const client = clientWithFs(
      { result: [{ mountpoint: "/", type: "ext4", "used-bytes": 4 * GB, "total-bytes": 40 * GB }] },
      calls,
    );
    const stopped = guest({ vmid: 101, status: "stopped" });
    const first = await attachVmAgentDisks(client, [guest({ vmid: 100 }), stopped]);
    expect(first[0]?.maxdisk).toBe(40 * GB);
    expect(first[1]?.maxdisk).toBe(0);
    const second = await attachVmAgentDisks(client, [guest({ vmid: 100 })]);
    expect(second[0]?.maxdisk).toBe(40 * GB);
    expect(calls.n).toBe(1);
  });

  it("applies cache without calling the agent", async () => {
    const calls = { n: 0 };
    const client = clientWithFs(
      { result: [{ mountpoint: "/", type: "ext4", "used-bytes": 4 * GB, "total-bytes": 40 * GB }] },
      calls,
    );
    await vmDiskFromAgent(client, "pve", 100);
    expect(calls.n).toBe(1);
    const [vm] = applyCachedVmDisks(client, [guest({ vmid: 100 })]);
    expect(vm?.maxdisk).toBe(40 * GB);
    expect(calls.n).toBe(1);
  });

  it("returns null from the agent when fsinfo is empty", async () => {
    const client = clientWithFs({ result: [] });
    expect(await vmDiskFromAgent(client, "pve", 100)).toBeNull();
  });
});
