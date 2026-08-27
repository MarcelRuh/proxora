import { describe, expect, it } from "vitest";
import {
  APT_REFRESH_INTERVAL_MS,
  aptSummaryFingerprint,
  aptSummaryFromHosts,
  shouldNotifyAptUpdates,
} from "@/lib/apt-updates";

describe("APT update notifications", () => {
  it("refreshes every three hours", () => {
    expect(APT_REFRESH_INTERVAL_MS).toBe(3 * 60 * 60 * 1000);
  });

  it("notifies only when the package count increases", () => {
    expect(shouldNotifyAptUpdates(0, 0)).toBe(false);
    expect(shouldNotifyAptUpdates(0, 4)).toBe(true);
    expect(shouldNotifyAptUpdates(4, 4)).toBe(false);
    expect(shouldNotifyAptUpdates(4, 7)).toBe(true);
    expect(shouldNotifyAptUpdates(7, 2)).toBe(false);
    expect(shouldNotifyAptUpdates(2, 0)).toBe(false);
  });

  it("builds a stable fingerprint and total from cached host counts", () => {
    const summary = aptSummaryFromHosts([
      { id: "b", name: "pve-power", aptUpdateCount: 2, aptCheckedAt: "2026-08-27T10:00:00Z" },
      { id: "a", name: "pve-main", aptUpdateCount: 3, aptCheckedAt: "2026-08-27T12:00:00Z" },
      { id: "c", name: "idle", aptUpdateCount: 0, aptCheckedAt: null },
    ]);
    expect(summary.total).toBe(5);
    expect(summary.checkedAt).toBe("2026-08-27T12:00:00Z");
    expect(aptSummaryFingerprint(summary.hosts)).toBe("a:3|b:2");
  });
});
