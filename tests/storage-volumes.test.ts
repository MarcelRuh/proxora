import { afterEach, describe, expect, it, vi } from "vitest";
import type { ProxmoxClient } from "@/server/proxmox/client";
import { clearVolumeListCache, collectStorageVolumes } from "@/server/services/storage-content";

describe("collectStorageVolumes", () => {
  afterEach(() => {
    clearVolumeListCache();
  });

  it("lists shared stores once and local stores per node", async () => {
    const list = vi.fn(async (node?: string) => {
      if (node) throw new Error("per-node storage list should be skipped");
      return [
        { storage: "nfs", type: "nfs", content: "iso,backup", shared: 1 },
        { storage: "local", type: "dir", content: "iso,vztmpl", shared: 0 },
      ];
    });
    const content = vi.fn(async (node: string, storage: string) => {
      if (storage === "nfs") return [{ volid: "nfs:iso/a.iso", content: "iso" }];
      return [{ volid: `local:iso/${node}.iso`, content: "iso" }];
    });
    const client = {
      http: { baseUrl: "https://pve.test" },
      storage: { list, content },
    } as unknown as ProxmoxClient;

    const result = await collectStorageVolumes(client, ["pve1", "pve2"], "iso");
    expect(list).toHaveBeenCalledTimes(1);
    expect(content).toHaveBeenCalledTimes(3);
    expect(content).toHaveBeenCalledWith("pve1", "nfs", "iso");
    expect(content).toHaveBeenCalledWith("pve1", "local", "iso");
    expect(content).toHaveBeenCalledWith("pve2", "local", "iso");
    expect(result.volids.sort()).toEqual(["local:iso/pve1.iso", "local:iso/pve2.iso", "nfs:iso/a.iso"]);
    expect(result.storages.sort()).toEqual(["local", "nfs"]);
  });

  it("reuses the 20s volume list cache", async () => {
    const list = vi.fn(async () => [{ storage: "local", type: "dir", content: "iso", shared: 0 }]);
    const content = vi.fn(async () => [{ volid: "local:iso/a.iso", content: "iso" }]);
    const client = {
      http: { baseUrl: "https://pve.cache" },
      storage: { list, content },
    } as unknown as ProxmoxClient;
    await collectStorageVolumes(client, ["pve"], "iso");
    await collectStorageVolumes(client, ["pve"], "iso");
    expect(list).toHaveBeenCalledTimes(1);
    expect(content).toHaveBeenCalledTimes(1);
  });
});
