import { describe, expect, it } from "vitest";
import { mergeUsedGuestSets } from "@/lib/next-vmid";

describe("mergeUsedGuestSets", () => {
  it("unions VMIDs and IPs from every host", () => {
    const merged = mergeUsedGuestSets([
      { vmids: [246, 247, 248, 249], ips: ["192.168.178.246"] },
      { vmids: [243, 244, 245], ips: ["192.168.178.243"] },
    ]);
    expect(merged.vmids.sort((a, b) => a - b)).toEqual([243, 244, 245, 246, 247, 248, 249]);
    expect(merged.ips.sort()).toEqual(["192.168.178.243", "192.168.178.246"]);
  });

  it("ignores empty or unreachable hosts", () => {
    const merged = mergeUsedGuestSets([{ vmids: [100] }, { vmids: [], ips: [] }]);
    expect(merged.vmids).toEqual([100]);
    expect(merged.ips).toEqual([]);
  });
});
