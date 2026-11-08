import { afterEach, describe, expect, it, vi } from "vitest";
import { clearGhcrManifestCache, ghcrImageTagExists } from "@/lib/ghcr";

describe("ghcrImageTagExists", () => {
  afterEach(() => {
    clearGhcrManifestCache();
    vi.unstubAllGlobals();
  });

  it("returns true when the anonymous manifest HEAD is ok", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ token: "t" }),
      })
      .mockResolvedValueOnce({ ok: true });
    vi.stubGlobal("fetch", fetchMock);
    await expect(ghcrImageTagExists("marcelruh/proxora", "v2.4.6")).resolves.toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const manifestUrl = String(fetchMock.mock.calls[1]?.[0] ?? "");
    expect(manifestUrl).toContain("/v2/marcelruh/proxora/manifests/2.4.6");
  });

  it("returns false for missing tags", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ token: "t" }),
      })
      .mockResolvedValueOnce({ ok: false, status: 404 });
    vi.stubGlobal("fetch", fetchMock);
    await expect(ghcrImageTagExists("marcelruh/proxora", "9.9.9")).resolves.toBe(false);
  });
});
