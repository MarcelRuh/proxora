import { describe, expect, it } from "vitest";
import {
  applyDiskWatchState,
  diskUsagePercent,
  guestDiskKey,
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
});
