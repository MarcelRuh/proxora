import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import {
  buildMacInstallScript,
  isDesktopPlatform,
  normalizeServerOrigin,
  parseReleaseAssets,
  pickAndroidApk,
  pickDesktopDownloads,
} from "@/lib/desktop-clients";

const SHA = "a".repeat(64);

const release = {
  assets: [
    { name: "Proxora_2.7.4_amd64.AppImage", browser_download_url: "https://github.com/x/y/a.AppImage", size: 9 },
    { name: "Proxora_2.7.4_amd64.AppImage.sig", browser_download_url: "https://github.com/x/y/a.AppImage.sig", size: 400 },
    { name: "Proxora_2.7.4_amd64.deb", browser_download_url: "https://github.com/x/y/p.deb", size: 8 },
    { name: "Proxora-2.7.4-1.x86_64.rpm", browser_download_url: "https://github.com/x/y/p.rpm", size: 7 },
    { name: "Proxora_2.7.4_x64-setup.exe", browser_download_url: "https://github.com/x/y/setup.exe", size: 5_000_000 },
    { name: "Proxora_2.7.4_x64-setup.exe.sig", browser_download_url: "https://github.com/x/y/setup.exe.sig", size: 400 },
    { name: "Proxora_2.7.4_x64_en-US.msi", browser_download_url: "https://github.com/x/y/p.msi", size: 6_000_000 },
    { name: "Proxora_2.7.4_universal.dmg", browser_download_url: "https://github.com/x/y/p.dmg", size: 12_000_000 },
    {
      name: "Proxora_2.7.4_universal.app.tar.gz",
      browser_download_url: "https://github.com/x/y/p.tgz",
      size: 11_000_000,
      digest: `sha256:${SHA.toUpperCase()}`,
    },
    { name: "Proxora_2.7.4_universal.app.tar.gz.sig", browser_download_url: "https://github.com/x/y/p.tgz.sig", size: 400 },
    { name: "proxora-2.7.4.apk", browser_download_url: "https://github.com/x/y/p.apk", size: 3, digest: "md5:abc" },
    { name: "broken", browser_download_url: "http://insecure" },
  ],
};

const dirs: string[] = [];
afterAll(() => {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
});

function writeScript(script: string): string {
  const dir = mkdtempSync(join(tmpdir(), "proxora-mac-"));
  dirs.push(dir);
  const file = join(dir, "install.sh");
  writeFileSync(file, script);
  return file;
}

describe("desktop client downloads", () => {
  it("picks installers per platform and ignores signatures", () => {
    const picked = pickDesktopDownloads(parseReleaseAssets(release));
    expect(picked.windows?.name).toBe("Proxora_2.7.4_x64-setup.exe");
    expect(picked["windows-msi"]?.name).toBe("Proxora_2.7.4_x64_en-US.msi");
    expect(picked.macos?.name).toBe("Proxora_2.7.4_universal.dmg");
    expect(picked["macos-app"]?.name).toBe("Proxora_2.7.4_universal.app.tar.gz");
    expect(picked["linux-appimage"]?.name).toBe("Proxora_2.7.4_amd64.AppImage");
    expect(picked["linux-deb"]?.name).toBe("Proxora_2.7.4_amd64.deb");
    expect(picked["linux-rpm"]?.name).toBe("Proxora-2.7.4-1.x86_64.rpm");
    expect(pickAndroidApk(parseReleaseAssets(release))?.url).toBe("https://github.com/x/y/p.apk");
  });

  it("reads SHA-256 digests and ignores other digests", () => {
    const assets = parseReleaseAssets(release);
    expect(assets.find((a) => a.name.endsWith(".app.tar.gz"))?.sha256).toBe(SHA);
    expect(assets.find((a) => a.name.endsWith(".apk"))?.sha256).toBeNull();
    expect(assets.find((a) => a.name.endsWith(".deb"))?.sha256).toBeNull();
    expect(assets.some((a) => a.name === "broken")).toBe(false);
  });

  it("reports missing platforms as null", () => {
    const picked = pickDesktopDownloads(parseReleaseAssets({ assets: release.assets.slice(0, 2) }));
    expect(picked.macos).toBeNull();
    expect(picked["macos-app"]).toBeNull();
    expect(picked["linux-deb"]).toBeNull();
    expect(pickAndroidApk([])).toBeNull();
    expect(parseReleaseAssets(null)).toEqual([]);
  });

  it("validates platforms and server origins", () => {
    expect(isDesktopPlatform("windows")).toBe(true);
    expect(isDesktopPlatform("linux-rpm")).toBe(true);
    expect(isDesktopPlatform("../etc")).toBe(false);
    expect(normalizeServerOrigin("https://proxora.home.arpa/proxora?x=1")).toBe("https://proxora.home.arpa");
    expect(normalizeServerOrigin("http://192.168.178.246:3000")).toBe("http://192.168.178.246:3000");
    expect(normalizeServerOrigin("javascript:alert(1)")).toBeNull();
    expect(normalizeServerOrigin("not a url")).toBeNull();
  });

  it("builds a valid macOS install script pinned to the release", () => {
    const script = buildMacInstallScript({
      repo: "MarcelRuh/proxora",
      tag: "v2.7.4",
      serverUrl: "http://192.168.178.246:3000/x",
      sha256: SHA.toUpperCase(),
    });
    expect(script).toContain("TAG='v2.7.4'");
    expect(script).toContain("PINNED_TAG='v2.7.4'");
    expect(script).toContain(`EXPECTED_SHA256='${SHA}'`);
    expect(script).toContain("SERVER_URL='http://192.168.178.246:3000'");
    expect(script).toContain('ASSET="Proxora_${VERSION}_universal.app.tar.gz"');
    expect(script).toContain('shasum -a 256 "$TMP/proxora.tar.gz"');
    expect(script).toContain('tell application id \\"$BUNDLE_ID\\" to quit');
    expect(script).toContain('sudo chown -R "$(id -un):$(id -gn)" "$APP"');
    expect(script).toContain("xattr -dr com.apple.quarantine");
    expect(script).toContain("%{url_effective}");
    expect(() => execFileSync("bash", ["-n", writeScript(script)])).not.toThrow();
  });

  it("runs the argument handling and refuses to install outside macOS", () => {
    const file = writeScript(buildMacInstallScript({ repo: "MarcelRuh/proxora", tag: "2.7.4", serverUrl: null }));
    const help = spawnSync("bash", [file, "--help"], { encoding: "utf8" });
    expect(help.status).toBe(0);
    expect(help.stdout).toContain("--server URL");
    expect(spawnSync("bash", [file, "--tag"], { encoding: "utf8" }).status).toBe(2);
    expect(spawnSync("bash", [file, "--nope"], { encoding: "utf8" }).status).toBe(2);
    if (process.platform !== "darwin") {
      const run = spawnSync("bash", [file], { encoding: "utf8" });
      expect(run.status).toBe(1);
      expect(run.stderr).toContain("macOS only");
    }
  });

  it("drops unsafe repo, tag, server and checksum values", () => {
    const script = buildMacInstallScript({
      repo: "a/b; rm -rf /",
      tag: "v1'; id;'",
      serverUrl: "file:///etc",
      sha256: SHA,
    });
    expect(script).toContain("REPO='MarcelRuh/proxora'");
    expect(script).toContain("TAG=''");
    expect(script).toContain("SERVER_URL=''");
    expect(script).toContain("PINNED_TAG=''");
    expect(script).toContain("EXPECTED_SHA256=''");
    const badSha = buildMacInstallScript({ repo: "MarcelRuh/proxora", tag: "v2.7.4", serverUrl: null, sha256: "abc'; id" });
    expect(badSha).toContain("EXPECTED_SHA256=''");
    expect(badSha).toContain("PINNED_TAG=''");
  });
});
