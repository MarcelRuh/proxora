import { describe, expect, it } from "vitest";
import { formatMemoryMib, isMemoryPreset, MEMORY_PRESETS_MIB } from "@/lib/guest-memory";

describe("guest memory presets", () => {
  it("lists 128 MiB through 64 GiB", () => {
    expect(MEMORY_PRESETS_MIB[0]).toBe(128);
    expect(MEMORY_PRESETS_MIB.at(-1)).toBe(65536);
    expect(MEMORY_PRESETS_MIB).toHaveLength(10);
  });

  it("formats GiB only for multiples of 1024", () => {
    expect(formatMemoryMib(128)).toBe("128 MiB");
    expect(formatMemoryMib(1024)).toBe("1 GiB");
    expect(formatMemoryMib(1536)).toBe("1536 MiB");
    expect(formatMemoryMib(65536)).toBe("64 GiB");
  });

  it("recognizes preset values", () => {
    expect(isMemoryPreset(2048)).toBe(true);
    expect(isMemoryPreset(1536)).toBe(false);
  });
});
