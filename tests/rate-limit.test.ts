import { describe, expect, it } from "vitest";
import { rateLimit } from "@/server/http/rate-limit";

describe("rate limiting", () => {
  it("allows bursts under the limit and then blocks", () => {
    const key = `test-${Date.now()}`;
    expect(rateLimit(key, 3, 60_000)).toBe(true);
    expect(rateLimit(key, 3, 60_000)).toBe(true);
    expect(rateLimit(key, 3, 60_000)).toBe(true);
    expect(rateLimit(key, 3, 60_000)).toBe(false);
  });
});
