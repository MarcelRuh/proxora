import { describe, expect, it } from "vitest";
import { withTimeoutFallback } from "@/lib/promise-timeout";

describe("withTimeoutFallback", () => {
  it("returns the promise when it finishes in time", async () => {
    await expect(withTimeoutFallback(Promise.resolve("ok"), 50, () => "late")).resolves.toBe("ok");
  });

  it("returns the fallback when the promise is too slow", async () => {
    const slow = new Promise<string>((resolve) => {
      setTimeout(() => resolve("done"), 80);
    });
    await expect(withTimeoutFallback(slow, 10, () => "timeout")).resolves.toBe("timeout");
  });

  it("rethrows if the promise fails before the timeout", async () => {
    await expect(withTimeoutFallback(Promise.reject(new Error("boom")), 50, () => "timeout")).rejects.toThrow("boom");
  });
});
