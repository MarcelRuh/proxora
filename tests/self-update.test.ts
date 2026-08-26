import { describe, expect, it } from "vitest";
import { compareSemver, isSelfUpdateAvailable, newerVersion, selfUpdateTargetVersion } from "@/lib/version";
import { extractNewerChangelog } from "@/server/services/github-revision";
import { mergeProgress, parseProgressFile, parseUpdaterLogs } from "@/server/services/self-update-progress";

describe("semver", () => {
  it("orders versions", () => {
    expect(compareSemver("1.0.0", "1.0.1")).toBeLessThan(0);
    expect(compareSemver("1.2.0", "1.1.9")).toBeGreaterThan(0);
    expect(newerVersion("1.0.0", "1.1.0")).toBe("1.1.0");
    expect(newerVersion("1.1.0", "1.0.9")).toBeNull();
  });

  it("picks a target version from remote/source", () => {
    expect(selfUpdateTargetVersion("1.0.0", "1.2.0", "1.1.0")).toBe("1.2.0");
    expect(selfUpdateTargetVersion("1.2.0", "1.2.0", "1.2.0")).toBeNull();
  });

  it("does not treat git SHA drift as an update when versions match", () => {
    expect(
      isSelfUpdateAvailable({
        runningVersion: "1.0.7",
        sourceVersion: "1.0.7",
        remoteVersion: "1.0.7",
      }),
    ).toBe(false);
  });

  it("detects a newer remote version", () => {
    expect(
      isSelfUpdateAvailable({
        runningVersion: "1.0.7",
        sourceVersion: "1.0.7",
        remoteVersion: "1.0.8",
      }),
    ).toBe(true);
  });
});

describe("changelog extract", () => {
  it("keeps only versions newer than current", () => {
    const md = `# Changelog\n\n## [1.1.0] – 2026-08-26\n\n- New\n\n## [1.0.0] – 2026-08-01\n\n- Initial\n`;
    const out = extractNewerChangelog(md, "1.0.0");
    expect(out).toContain("1.1.0");
    expect(out).not.toContain("Initial");
  });
});

describe("progress parser", () => {
  it("reads the progress file", () => {
    const parsed = parseProgressFile("percent=42\nstep=buildWeb\ndetail=Building\n");
    expect(parsed).toEqual({ percent: 42, step: "buildWeb", detail: "Building" });
  });

  it("parses compose logs and never goes backwards", () => {
    const logs = "==> Proxora self-update\nCompiled successfully\nContainer proxora Started\n";
    const p = parseUpdaterLogs(logs);
    expect(p?.percent).toBeGreaterThanOrEqual(90);
    expect(mergeProgress({ percent: 100, step: "done", detail: null }, { percent: 12, step: "resolve", detail: null })?.percent).toBe(12);
  });
});
