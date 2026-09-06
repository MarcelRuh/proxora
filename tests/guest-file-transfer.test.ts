import { describe, expect, it } from "vitest";
import { createRateTracker, formatByteRate, formatEtaSeconds } from "@/lib/guest-file-transfer";
import { translate } from "@/lib/i18n/messages";

function tDe(key: Parameters<typeof translate>[1], vars?: Record<string, string | number>) {
  return translate("de", key, vars);
}

describe("createRateTracker", () => {
  it("needs a short window before reporting a rate", () => {
    const rate = createRateTracker();
    expect(rate.update(0, 8_000_000, 0)).toEqual({ bytesPerSec: 0, etaSeconds: null });
    expect(rate.update(100_000, 8_000_000, 200).bytesPerSec).toBe(0);
  });

  it("computes MB/s and remaining time from the sliding window", () => {
    const rate = createRateTracker(2500);
    rate.update(0, 8 * 1024 * 1024, 0);
    const sample = rate.update(2 * 1024 * 1024, 8 * 1024 * 1024, 1000);
    expect(sample.bytesPerSec).toBe(2 * 1024 * 1024);
    expect(sample.etaSeconds).toBe(3);
  });

  it("drops samples outside the window", () => {
    const rate = createRateTracker(2500);
    rate.update(0, 10_000, 0);
    rate.update(1_000, 10_000, 1_000);
    const sample = rate.update(8_000, 10_000, 4_000);
    expect(sample.bytesPerSec).toBeCloseTo(7000 / 3, 6);
    expect(sample.etaSeconds).toBeCloseTo(2000 / (7000 / 3), 6);
  });
});

describe("formatByteRate", () => {
  it("shows per-second sizes", () => {
    expect(formatByteRate(0)).toBe("0 B/s");
    expect(formatByteRate(512)).toBe("512 B/s");
    expect(formatByteRate(2.5 * 1024 * 1024)).toBe("2,5 MB/s");
  });
});

describe("formatEtaSeconds", () => {
  it("formats remaining time in German", () => {
    expect(formatEtaSeconds(null, tDe)).toBe("…");
    expect(formatEtaSeconds(2, tDe)).toBe("< 3 s");
    expect(formatEtaSeconds(45, tDe)).toBe("45 s");
    expect(formatEtaSeconds(180, tDe)).toBe("3 min");
    expect(formatEtaSeconds(3661, tDe)).toBe("1 h 1 min");
  });
});
