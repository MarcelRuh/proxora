import { describe, expect, it } from "vitest";
import {
  applyDiskWatchState,
  diskUsagePercent,
  guestClusterDiskPercent,
  guestDiskKey,
  guestFilesystemPercent,
  isStorageMonitored,
  parseDiskAlertSettings,
  storageDiskKey,
} from "@/lib/disk-alerts";

const GiB = 1024 * 1024 * 1024;

describe("disk usage alerts", () => {
  it("ignores missing totals (no guest agent / empty storage)", () => {
    expect(diskUsagePercent(10, 0)).toBeNull();
    expect(diskUsagePercent(undefined, 100)).toBeNull();
    expect(diskUsagePercent(90, 100)).toBe(90);
  });

  it("notifies once above 90% and resets below 85%", () => {
    expect(applyDiskWatchState(false, 89)).toEqual({ notify: false, notified: false });
    expect(applyDiskWatchState(false, 90)).toEqual({ notify: true, notified: true });
    expect(applyDiskWatchState(true, 95)).toEqual({ notify: false, notified: true });
    expect(applyDiskWatchState(true, 87)).toEqual({ notify: false, notified: true });
    expect(applyDiskWatchState(true, 84)).toEqual({ notify: false, notified: false });
  });

  it("keeps storage and guest keys distinct", () => {
    expect(storageDiskKey("h1", "pve", "local-lvm")).toBe("storage:h1:pve:local-lvm");
    expect(guestDiskKey("h1", "vm", 100)).toBe("guest:h1:vm:100");
  });

  it("skips disabled or empty storage", () => {
    expect(isStorageMonitored({ enabled: 0, active: 1, total: 100 })).toBe(false);
    expect(isStorageMonitored({ enabled: 1, active: 0, total: 100 })).toBe(false);
    expect(isStorageMonitored({ active: 1, total: 0 })).toBe(false);
    expect(isStorageMonitored({ active: 1, total: 100 })).toBe(true);
  });

  it("uses guest-agent filesystem usage and ignores tmpfs", () => {
    expect(
      guestFilesystemPercent([
        { mountpoint: "/run", type: "tmpfs", "used-bytes": 9, "total-bytes": 10 },
        { mountpoint: "/", type: "ext4", "used-bytes": 8 * GiB * 0.8, "total-bytes": 8 * GiB },
      ]),
    ).toBe(80);
    expect(guestFilesystemPercent([])).toBeNull();
  });

  it("does not treat unreadable VM disks as full", () => {
    expect(
      guestFilesystemPercent([
        { mountpoint: "/", type: "ext4", "used-bytes": 0, "total-bytes": 0 },
        { mountpoint: "/boot", type: "vfat", "used-bytes": 64 * 1024 * 1024, "total-bytes": 64 * 1024 * 1024 },
      ]),
    ).toBeNull();
    expect(
      guestFilesystemPercent([
        { mountpoint: "/", type: "ext4" },
        { mountpoint: "/boot/efi", type: "vfat", "used-bytes": 100, "total-bytes": 100 },
      ]),
    ).toBeNull();
    expect(guestClusterDiskPercent(0, 32 * 1024 * 1024 * 1024)).toBeNull();
    expect(guestClusterDiskPercent(undefined, 8 * 1024 * 1024 * 1024)).toBeNull();
  });

  it("reads nested qemu-ga disk bytes and prefers the largest Windows volume", () => {
    expect(
      guestFilesystemPercent([
        {
          mountpoint: "/",
          type: "ext4",
          disk: [{ "used-bytes": 4 * GiB, "total-bytes": 8 * GiB }],
        },
      ]),
    ).toBe(50);
    expect(
      guestFilesystemPercent([
        { mountpoint: "C:\\", type: "NTFS", "used-bytes": 40 * GiB, "total-bytes": 80 * GiB },
        { mountpoint: "D:\\", type: "NTFS", "used-bytes": 1 * GiB, "total-bytes": 1 * GiB },
      ]),
    ).toBe(50);
  });

  it("clamps alert settings and keeps clear below alert", () => {
    expect(parseDiskAlertSettings({ alertPercent: 95, clearPercent: 99 })).toEqual({
      alertPercent: 95,
      clearPercent: 90,
    });
  });
});
