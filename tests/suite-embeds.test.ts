import { describe, expect, it } from "vitest";
import { parseEmbedUrl, parseSuiteApps, readSuiteEmbeds, suiteAppId } from "@/lib/suite-embeds";

describe("suite embed urls", () => {
  it("keeps an http address and drops the hash", () => {
    expect(parseEmbedUrl("https://app.lan:3000/app#x")).toBe("https://app.lan:3000/app");
    expect(parseEmbedUrl("  ")).toBeNull();
    expect(parseEmbedUrl(null)).toBeNull();
  });

  it("rejects passwords and other protocols", () => {
    expect(() => parseEmbedUrl("javascript:alert(1)")).toThrow();
    expect(() => parseEmbedUrl("https://user:secret@app.lan")).toThrow();
    expect(() => parseEmbedUrl("not a url")).toThrow();
  });

  it("reads a list and the older fixed entries", () => {
    expect(readSuiteEmbeds({ apps: [{ id: "dockora", name: "Dockora", url: "https://d.lan" }] })).toEqual({
      apps: [{ id: "dockora", name: "Dockora", url: "https://d.lan/" }],
    });
    expect(readSuiteEmbeds({ dockora: "https://d.lan", sambora: null })).toEqual({
      apps: [{ id: "dockora", name: "Dockora", url: "https://d.lan/" }],
    });
    expect(readSuiteEmbeds({ apps: [{ id: "bad", name: "Bad", url: "javascript:alert(1)" }] })).toEqual({ apps: [] });
    expect(readSuiteEmbeds(null)).toEqual({ apps: [] });
  });

  it("builds a stable id and skips empty rows", () => {
    const taken = new Set<string>();
    expect(suiteAppId("Mölla", taken)).toBe("molla");
    expect(suiteAppId("Molla", taken)).toBe("molla-2");
    expect(
      parseSuiteApps([
        { name: "Dockora", url: "https://d.lan" },
        { name: "", url: "" },
      ]),
    ).toEqual([{ id: "dockora", name: "Dockora", url: "https://d.lan/" }]);
  });
});
