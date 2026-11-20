import { describe, expect, it } from "vitest";
import { mergeUsedGuestSets, nextVmidAboveHighest } from "@/lib/next-vmid";

describe("nextVmidAboveHighest", () => {
  it("picks the next ID above the highest used, ignoring gaps below", () => {
    expect(nextVmidAboveHighest([243, 244])).toBe(245);
    expect(nextVmidAboveHighest([243, 244, 245, 246, 247, 248, 249, 250, 251])).toBe(252);
    expect(nextVmidAboveHighest([100, 105, 251])).toBe(252);
  });

  it("starts at 100 when nothing is used", () => {
    expect(nextVmidAboveHighest([])).toBe(100);
  });

  it("ignores IDs below the minimum", () => {
    expect(nextVmidAboveHighest([5, 42])).toBe(100);
  });

  it("skips IDs whose implied IP is already used", () => {
    expect(nextVmidAboveHighest([250, 251], 100, (id) => id === 252 || id === 253)).toBe(254);
  });

  it("uses the union of IDs from multiple hosts", () => {
    const used = mergeUsedGuestSets([{ vmids: [243, 245] }, { vmids: [244, 249] }]);
    expect(nextVmidAboveHighest(used.vmids)).toBe(250);
  });
});
