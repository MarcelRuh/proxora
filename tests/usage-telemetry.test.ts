import { describe, expect, it } from "vitest";
import {
  parseLivePingAt,
  shouldSendLivePing,
  usageAssetUrl,
  usageTelemetryEnabled,
  weeklyActive,
} from "@/lib/usage-telemetry";

describe("usage telemetry", () => {
  it("is off outside production and when opted out", () => {
    expect(usageTelemetryEnabled({ NODE_ENV: "development", PROXORA_TELEMETRY: "1" })).toBe(false);
    expect(usageTelemetryEnabled({ NODE_ENV: "production", PROXORA_TELEMETRY: "0" })).toBe(false);
    expect(usageTelemetryEnabled({ NODE_ENV: "production" })).toBe(true);
  });

  it("points at the stats prerelease assets", () => {
    expect(usageAssetUrl("install", "MarcelRuh/proxora")).toBe(
      "https://github.com/MarcelRuh/proxora/releases/download/stats/install",
    );
  });

  it("sends a live ping at most once per interval", () => {
    expect(shouldSendLivePing(null, 1_000, 100)).toBe(true);
    expect(shouldSendLivePing(1_000, 1_050, 100)).toBe(false);
    expect(shouldSendLivePing(1_000, 1_100, 100)).toBe(true);
    expect(parseLivePingAt({ at: 42 })).toBe(42);
    expect(parseLivePingAt({})).toBeNull();
  });

  it("treats the 7-day live delta as active instances", () => {
    expect(
      weeklyActive(
        [
          { at: "2026-09-01T00:00:00Z", install: 2, live: 10 },
          { at: "2026-09-08T00:00:00Z", install: 3, live: 14 },
        ],
        Date.parse("2026-09-08T00:00:00Z"),
        7 * 24 * 60 * 60 * 1000,
      ),
    ).toBe(4);
  });
});
