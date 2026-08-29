import { describe, expect, it } from "vitest";
import { mergeUsedGuestSets, nextSmallerVmid } from "@/lib/next-vmid";

describe("nextSmallerVmid", () => {
  it("picks the next free ID below the highest used, across nodes", () => {
    expect(nextSmallerVmid([243, 244])).toBe(242);
    expect(nextSmallerVmid([244, 243, 242])).toBe(241);
  });

  it("skips IDs that are already taken", () => {
    expect(nextSmallerVmid([240, 242, 243, 244])).toBe(241);
  });

  it("starts at 100 when nothing is used", () => {
    expect(nextSmallerVmid([])).toBe(100);
  });

  it("goes above max when everything below is taken", () => {
    const used = Array.from({ length: 145 }, (_, i) => 100 + i); // 100..244
    expect(nextSmallerVmid(used)).toBe(245);
  });

  it("skips IDs whose implied IP is already used", () => {
    expect(nextSmallerVmid([243, 244], 100, (id) => id === 242)).toBe(241);
  });

  it("uses the union of IDs from multiple hosts", () => {
    const pvePower = Array.from({ length: 146 }, (_, i) => 100 + i); // 100..245 → next would be 246
    const pveMain = Array.from({ length: 150 }, (_, i) => 100 + i); // 100..249 → next would be 250
    const used = mergeUsedGuestSets([{ vmids: pvePower }, { vmids: pveMain }]);
    expect(nextSmallerVmid(used.vmids)).toBe(250);
  });
});
