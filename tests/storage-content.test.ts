import { describe, expect, it } from "vitest";
import {
  applyVolumeUsage,
  filterStorageContent,
  normalizeStorageContentRow,
  storageContentDeletePermission,
  storageContentKind,
} from "@/lib/storage-content";
import { configVolumeRole } from "@/lib/volume-usage";

describe("storage content", () => {
  it("normalizes volid, content type and size", () => {
    const iso = normalizeStorageContentRow({
      volid: "local:iso/debian-13.6.0-amd64-netinst.iso",
      content: "iso",
      size: 700_000_000,
    });
    expect(iso).toMatchObject({
      filename: "debian-13.6.0-amd64-netinst.iso",
      content: "iso",
      vmid: null,
    });
    expect(storageContentKind({ volid: "local-lvm:vm-100-disk-0", content: "images" })).toBe("images");
    expect(storageContentKind({ volid: "local:backup/vzdump-qemu-100-2024_01_01-00_00_00.vma.zst" })).toBe("backup");
  });

  it("marks unused disks from unusedN config keys", () => {
    const config = {
      scsi0: "local-lvm:vm-100-disk-0,size=32G",
      unused0: "local-lvm:vm-100-disk-1",
    };
    expect(configVolumeRole(config, "local-lvm:vm-100-disk-0")).toBe("attached");
    expect(configVolumeRole(config, "local-lvm:vm-100-disk-1")).toBe("unused");
    expect(configVolumeRole(config, "local-lvm:vm-100-disk-9")).toBe("none");
  });

  it("filters unused volumes and search", () => {
    const rows = [
      applyVolumeUsage(
        normalizeStorageContentRow({ volid: "local-lvm:vm-100-disk-0", content: "images", vmid: 100 })!,
        { scsi0: "local-lvm:vm-100-disk-0" },
        { name: "web", kind: "vm" },
      ),
      applyVolumeUsage(
        normalizeStorageContentRow({ volid: "local-lvm:vm-100-disk-1", content: "images", vmid: 100 })!,
        { unused0: "local-lvm:vm-100-disk-1" },
        { name: "web", kind: "vm" },
      ),
    ];
    expect(filterStorageContent(rows, { query: "", content: "unused" }).map((r) => r.filename)).toEqual([
      "vm-100-disk-1",
    ]);
    expect(filterStorageContent(rows, { query: "web", content: "all" })).toHaveLength(2);
  });

  it("maps backup files to backup.delete", () => {
    expect(storageContentDeletePermission("backup")).toBe("backup.delete");
    expect(storageContentDeletePermission("iso")).toBe("storage.delete");
    expect(storageContentDeletePermission("images")).toBe("storage.delete");
  });
});
