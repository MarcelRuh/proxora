import { describe, expect, it } from "vitest";
import {
  applyDiskWatchState,
  diskUsagePercent,
  guestDiskKey,
  guestFilesystemPercent,
  isStorageMonitored,
  parseDiskAlertSettings,
  storageDiskKey,
} from "@/lib/disk-alerts";

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
        { mountpoint: "/", type: "ext4", "used-bytes": 80, "total-bytes": 100 },
      ]),
    ).toBe(80);
    expect(guestFilesystemPercent([])).toBeNull();
  });

  it("clamps alert settings and keeps clear below alert", () => {
    expect(parseDiskAlertSettings({ alertPercent: 95, clearPercent: 99 })).toEqual({
      alertPercent: 95,
      clearPercent: 90,
    });
  });
});
