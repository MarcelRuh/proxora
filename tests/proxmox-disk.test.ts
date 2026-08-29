import { describe, expect, it } from "vitest";
import {
  canResizeDisk,
  diskSizeDeltaGiB,
  formatDiskGiB,
  parseDiskSpec,
  setDiskSize,
  sizeToGiB,
} from "@/lib/proxmox-disk";

describe("proxmox disk specs", () => {
  it("reads LXC rootfs size", () => {
    expect(parseDiskSpec("local-lvm:vm-246-disk-0,size=8G")).toEqual({
      volume: "local-lvm:vm-246-disk-0",
      sizeGiB: 8,
      rest: ["size=8G"],
    });
    expect(sizeToGiB("8192M")).toBe(8);
    expect(formatDiskGiB(16)).toBe("16G");
  });

  it("sets a larger size without dropping other options", () => {
    expect(setDiskSize("local-lvm:vm-246-disk-0,size=8G,backup=1", 16)).toBe(
      "local-lvm:vm-246-disk-0,size=16G,backup=1",
    );
    expect(diskSizeDeltaGiB("local-lvm:vm-246-disk-0,size=8G", "local-lvm:vm-246-disk-0,size=16G")).toBe(8);
  });

  it("does not resize cdrom or efi disks", () => {
    expect(canResizeDisk("ide2", "local:iso/debian.iso,media=cdrom")).toBe(false);
    expect(canResizeDisk("rootfs", "local-lvm:vm-246-disk-0,size=8G")).toBe(true);
  });
});
