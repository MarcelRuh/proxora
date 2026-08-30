import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  isUpdateBusyFromSignal,
  resolveUpdateSignalDir,
  UPDATE_LOCK_FILE,
  UPDATE_REQUEST_FILE,
  UPDATE_TARGET_FILE,
  writeUpdateRequest,
  writeUpdateTarget,
} from "@/lib/self-update-signal";
import { compareSemver, isSelfUpdateAvailable, newerVersion, selfUpdateTargetVersion } from "@/lib/version";
import {
  extractNewerChangelog,
  parseGithubRelease,
  parseReleaseTagFromUrl,
  pickLatestSemverTag,
} from "@/server/services/github-revision";
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

describe("github release parse", () => {
  it("reads tag_name as semver", () => {
    expect(parseGithubRelease({ tag_name: "v1.0.64", html_url: "https://example" })).toEqual({
      tag: "v1.0.64",
      version: "1.0.64",
      sha: null,
      htmlUrl: "https://example",
    });
    expect(parseGithubRelease({ tag_name: "nightly" })).toBeNull();
  });

  it("reads the latest tag from a GitHub release URL", () => {
    expect(parseReleaseTagFromUrl("https://github.com/MarcelRuh/proxora/releases/tag/v1.0.73")).toBe("v1.0.73");
    expect(parseReleaseTagFromUrl("/MarcelRuh/proxora/releases/tag/1.0.74")).toBe("v1.0.74");
    expect(parseReleaseTagFromUrl("https://github.com/MarcelRuh/proxora/releases")).toBeNull();
  });

  it("picks the highest semver tag, not lexicographic order", () => {
    expect(pickLatestSemverTag(["v1.0.9", "v1.0.73", "v1.0.8", "nightly"])).toBe("v1.0.73");
    expect(pickLatestSemverTag([])).toBeNull();
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

describe("update signal files", () => {
  const dirs: string[] = [];

  afterEach(() => {
    for (const dir of dirs.splice(0)) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("treats request and lock as busy and writes only a timestamp", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "proxora-signal-"));
    dirs.push(dir);
    expect(isUpdateBusyFromSignal(dir)).toBe(false);
    writeUpdateRequest(dir, "2026-08-29T12:00:00.000Z");
    expect(readFileSync(path.join(dir, UPDATE_REQUEST_FILE), "utf8")).toBe("2026-08-29T12:00:00.000Z\n");
    expect(isUpdateBusyFromSignal(dir)).toBe(true);
    writeFileSync(path.join(dir, UPDATE_LOCK_FILE), "");
    expect(isUpdateBusyFromSignal(dir)).toBe(true);
  });

  it("writes the target tag before a request and can clear a leftover pin", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "proxora-signal-"));
    dirs.push(dir);
    writeUpdateTarget(dir, "v1.0.71");
    expect(readFileSync(path.join(dir, UPDATE_TARGET_FILE), "utf8")).toBe("v1.0.71\n");
    writeUpdateTarget(dir, "v1.0.73");
    expect(readFileSync(path.join(dir, UPDATE_TARGET_FILE), "utf8")).toBe("v1.0.73\n");
    writeUpdateTarget(dir, null);
    expect(existsSync(path.join(dir, UPDATE_TARGET_FILE))).toBe(false);
  });

  it("reads PROXORA_UPDATE_SIGNAL_DIR", () => {
    expect(resolveUpdateSignalDir({})).toBeNull();
    expect(resolveUpdateSignalDir({ PROXORA_UPDATE_SIGNAL_DIR: " /update-signal " })).toBe("/update-signal");
  });
});
