import { afterEach, describe, expect, it, vi } from "vitest";
import { vmidFromVolid } from "@/lib/volume-usage";
import type { ProxmoxClient } from "@/server/proxmox/client";
import type { GuestListItem } from "@/server/proxmox/types";
import { clearInventoryCache } from "@/server/services/inventory-cache";
import { collectVolumeUsers } from "@/server/services/volume-usage";

function guest(vmid: number, extra: Partial<GuestListItem> = {}): GuestListItem {
  return {
    vmid,
    name: `g-${vmid}`,
    node: "pve",
    status: "running",
    cpu: 0,
    cpus: 1,
    mem: 0,
    maxmem: 0,
    disk: 0,
    maxdisk: 0,
    uptime: 0,
    template: false,
    ...extra,
  };
}

describe("vmidFromVolid", () => {
  it("reads backup, PBS and disk volids", () => {
    expect(vmidFromVolid("local:backup/vzdump-qemu-100-2024_01_01-00_00_00.vma.zst")).toBe(100);
    expect(vmidFromVolid("pbs:backup/ct/90/2024-01-01T00:00:00Z")).toBe(90);
    expect(vmidFromVolid("local-lvm:vm-110-disk-0")).toBe(110);
    expect(vmidFromVolid("local-lvm:base-200-disk-0")).toBe(200);
    expect(vmidFromVolid("local-lvm:subvol-204-disk-0")).toBe(204);
  });

  it("returns null for ISO and template files", () => {
    expect(vmidFromVolid("local:iso/debian-13.6.0-amd64-netinst.iso")).toBeNull();
    expect(vmidFromVolid("local:vztmpl/debian-13-standard_13.1-2_amd64.tar.zst")).toBeNull();
  });
});

describe("collectVolumeUsers", () => {
  afterEach(() => {
    clearInventoryCache();
  });

  it("only fetches configs for guests whose VMID is in the volids", async () => {
    const vmsConfig = vi.fn(async (_node: string, vmid: number) => ({
      scsi0: `local-lvm:vm-${vmid}-disk-0`,
    }));
    const lxcConfig = vi.fn(async () => ({}));
    const client = {
      http: { baseUrl: "https://pve.test" },
      listInventory: async () => ({
        nodes: [],
        vms: [guest(100), guest(200), guest(300)],
        containers: [guest(400)],
        storage: [],
      }),
      vms: { config: vmsConfig },
      lxc: { config: lxcConfig },
    } as unknown as ProxmoxClient;

    const used = await collectVolumeUsers(
      client,
      "h1",
      ["local-lvm:vm-100-disk-0", "local-lvm:vm-200-disk-0"],
      { kind: "vm" },
    );
    expect(vmsConfig).toHaveBeenCalledTimes(2);
    expect(vmsConfig).toHaveBeenCalledWith("pve", 100);
    expect(vmsConfig).toHaveBeenCalledWith("pve", 200);
    expect(lxcConfig).not.toHaveBeenCalled();
    expect(used["local-lvm:vm-100-disk-0"]?.map((u) => u.vmid)).toEqual([100]);
  });

  it("scans only VMs for ISO usage and skips templates", async () => {
    const vmsConfig = vi.fn(async () => ({ ide2: "local:iso/debian.iso,media=cdrom" }));
    const lxcConfig = vi.fn(async () => ({}));
    const client = {
      http: { baseUrl: "https://pve.test" },
      listInventory: async () => ({
        nodes: [],
        vms: [guest(100), guest(101, { template: true })],
        containers: [guest(200)],
        storage: [],
      }),
      vms: { config: vmsConfig },
      lxc: { config: lxcConfig },
    } as unknown as ProxmoxClient;

    await collectVolumeUsers(client, "h1", ["local:iso/debian.iso"], { kind: "vm" });
    expect(vmsConfig).toHaveBeenCalledTimes(1);
    expect(vmsConfig).toHaveBeenCalledWith("pve", 100);
    expect(lxcConfig).not.toHaveBeenCalled();
  });
});
