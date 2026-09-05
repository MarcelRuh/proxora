import { describe, expect, it } from "vitest";
import { mapPool } from "@/lib/async-pool";

describe("mapPool", () => {
  it("returns results in input order with bounded concurrency", async () => {
    let live = 0;
    let max = 0;
    const out = await mapPool([1, 2, 3, 4, 5], 2, async (n) => {
      live += 1;
      max = Math.max(max, live);
      await new Promise((resolve) => setTimeout(resolve, 15));
      live -= 1;
      return n * 2;
    });
    expect(out).toEqual([2, 4, 6, 8, 10]);
    expect(max).toBeLessThanOrEqual(2);
  });

  it("returns an empty array for no items", async () => {
    expect(await mapPool([], 4, async (n: number) => n)).toEqual([]);
  });
});
