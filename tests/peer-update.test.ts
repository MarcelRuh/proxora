import { describe, expect, it } from "vitest";
import {
  formatPeerUpdateRange,
  isPeerUpdating,
  PEER_UPDATE_TTL_MS,
  peerUpdateDeadline,
  peerUpdateRangeSuffix,
  shouldSkipPeerOfflineNotify,
} from "@/lib/peer-update";

describe("peer update window", () => {
  it("treats a future deadline as updating", () => {
    const now = new Date("2026-09-06T20:00:00.000Z");
    expect(isPeerUpdating(new Date("2026-09-06T20:10:00.000Z"), now)).toBe(true);
    expect(isPeerUpdating(now, now)).toBe(false);
    expect(isPeerUpdating(null, now)).toBe(false);
  });

  it("skips offline alerts only for peer hosts inside the window", () => {
    const until = peerUpdateDeadline(new Date("2026-09-06T20:00:00.000Z"));
    expect(
      shouldSkipPeerOfflineNotify({
        origin: "PEER",
        updatingUntil: until,
        now: new Date("2026-09-06T20:05:00.000Z"),
      }),
    ).toBe(true);
    expect(
      shouldSkipPeerOfflineNotify({
        origin: "LOCAL",
        updatingUntil: until,
        now: new Date("2026-09-06T20:05:00.000Z"),
      }),
    ).toBe(false);
    expect(
      shouldSkipPeerOfflineNotify({
        origin: "PEER",
        updatingUntil: until,
        now: new Date(until.getTime() + 1),
      }),
    ).toBe(false);
  });

  it("formats version ranges and keeps a 20 minute ttl", () => {
    expect(PEER_UPDATE_TTL_MS).toBe(20 * 60 * 1000);
    expect(formatPeerUpdateRange("1.7.0", "1.7.1")).toBe("1.7.0 → 1.7.1");
    expect(peerUpdateRangeSuffix("1.7.0", "1.7.1")).toBe(" (1.7.0 → 1.7.1)");
    expect(peerUpdateRangeSuffix("1.7.1", "1.7.1")).toBe(" (1.7.1)");
    expect(peerUpdateRangeSuffix(null, null)).toBe("");
  });
});
