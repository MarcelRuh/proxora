import { describe, expect, it } from "vitest";
import { isClusterNodeOnline, minPositiveUptime, uniqueNonEmpty, weightedCpuRatio } from "@/lib/cluster-metrics";

describe("weightedCpuRatio", () => {
  it("weights node CPU by core count", () => {
    expect(weightedCpuRatio([
      { cpu: 0.5, maxcpu: 8 },
      { cpu: 0.1, maxcpu: 16 },
    ])).toBeCloseTo((0.5 * 8 + 0.1 * 16) / 24);
  });

  it("averages ratios when core counts are missing", () => {
    expect(weightedCpuRatio([{ cpu: 0.2 }, { cpu: 0.4 }])).toBeCloseTo(0.3);
  });
});

describe("minPositiveUptime", () => {
  it("returns the shortest live uptime", () => {
    expect(minPositiveUptime([{ uptime: 100 }, { uptime: 40 }, { uptime: 0 }])).toBe(40);
  });
});

describe("uniqueNonEmpty", () => {
  it("dedupes versions", () => {
    expect(uniqueNonEmpty(["8.4", null, "8.4", "9.0", ""])).toEqual(["8.4", "9.0"]);
  });
});

describe("isClusterNodeOnline", () => {
  it("treats missing status as online", () => {
    expect(isClusterNodeOnline("online")).toBe(true);
    expect(isClusterNodeOnline(undefined)).toBe(true);
    expect(isClusterNodeOnline("offline")).toBe(false);
  });
});
