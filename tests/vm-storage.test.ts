import { describe, expect, it } from "vitest";
import {
  diskExtras,
  storageHoldsVmImages,
  storageIsIscsi,
  vmDiskSpec,
  vmDiskStorages,
} from "@/lib/vm-storage";

describe("vm disk storage", () => {
  it("keeps image storages and iSCSI, skips backup-only", () => {
    const list = [
      { storage: "backup", type: "dir", content: "backup", active: 1, enabled: 1 },
      { storage: "apps", type: "lvm", content: "images,rootdir", active: 1, enabled: 1 },
      { storage: "san", type: "iscsi", content: "none", active: 1, enabled: 1 },
      { storage: "off", type: "zfspool", content: "images", active: 0, enabled: 1 },
    ];
    expect(vmDiskStorages(list).map((s) => s.storage)).toEqual(["apps", "san"]);
    expect(storageIsIscsi({ type: "iscsi" })).toBe(true);
    expect(storageHoldsVmImages({ storage: "local", content: "iso,vztmpl" })).toBe(false);
  });

  it("builds new images and existing iSCSI LUNs", () => {
    expect(vmDiskSpec({ diskStorage: "apps", diskSize: "64", extras: ["discard=on"] })).toBe(
      "apps:64,discard=on",
    );
    expect(
      vmDiskSpec({
        diskStorage: "san",
        diskVolume: "san:0.0.1.lun0",
        extras: ["iothread=1"],
      }),
    ).toBe("san:0.0.1.lun0,iothread=1");
  });

  it("enables iothread on VirtIO SCSI Single", () => {
    expect(diskExtras({ discard: true, scsihw: "virtio-scsi-single", diskBus: "scsi" })).toEqual([
      "discard=on",
      "iothread=1",
    ]);
    expect(diskExtras({ scsihw: "virtio-scsi", diskBus: "scsi" })).toEqual([]);
  });
});
