import { describe, expect, it } from "vitest";
import { parseEmbedUrl, readSuiteEmbeds } from "@/lib/suite-embeds";

describe("suite embed urls", () => {
  it("keeps an http address and drops the hash", () => {
    expect(parseEmbedUrl("https://dockora.lan:3000/app#x")).toBe("https://dockora.lan:3000/app");
    expect(parseEmbedUrl("  ")).toBeNull();
    expect(parseEmbedUrl(null)).toBeNull();
  });

  it("rejects passwords and other protocols", () => {
    expect(() => parseEmbedUrl("javascript:alert(1)")).toThrow();
    expect(() => parseEmbedUrl("https://user:secret@dockora.lan")).toThrow();
    expect(() => parseEmbedUrl("not a url")).toThrow();
  });

  it("reads stored values", () => {
    expect(readSuiteEmbeds({ dockora: "https://d.lan", sambora: null })).toEqual({
      dockora: "https://d.lan",
      sambora: null,
    });
    expect(readSuiteEmbeds(null)).toEqual({ dockora: null, sambora: null });
  });
});
