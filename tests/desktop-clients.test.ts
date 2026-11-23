import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  buildMacInstallScript,
  isDesktopPlatform,
  normalizeServerOrigin,
  parseReleaseAssets,
  pickDesktopDownloads,
} from "@/lib/desktop-clients";

const release = {
  assets: [
    { name: "Proxora_2.7.4_amd64.AppImage", browser_download_url: "https://github.com/x/y/a.AppImage", size: 9 },
    { name: "Proxora_2.7.4_x64-setup.exe", browser_download_url: "https://github.com/x/y/setup.exe", size: 5_000_000 },
    { name: "Proxora_2.7.4_x64-setup.exe.sig", browser_download_url: "https://github.com/x/y/setup.exe.sig", size: 400 },
    { name: "Proxora_2.7.4_x64_en-US.msi", browser_download_url: "https://github.com/x/y/p.msi", size: 6_000_000 },
    { name: "Proxora_2.7.4_universal.dmg", browser_download_url: "https://github.com/x/y/p.dmg", size: 12_000_000 },
    { name: "Proxora_2.7.4_universal.app.tar.gz", browser_download_url: "https://github.com/x/y/p.tgz", size: 11_000_000 },
    { name: "Proxora_2.7.4_universal.app.tar.gz.sig", browser_download_url: "https://github.com/x/y/p.tgz.sig", size: 400 },
    { name: "broken", browser_download_url: "http://insecure" },
  ],
};

describe("desktop client downloads", () => {
  it("picks installers per platform and ignores signatures", () => {
    const picked = pickDesktopDownloads(parseReleaseAssets(release));
    expect(picked.windows?.name).toBe("Proxora_2.7.4_x64-setup.exe");
    expect(picked["windows-msi"]?.name).toBe("Proxora_2.7.4_x64_en-US.msi");
    expect(picked.macos?.name).toBe("Proxora_2.7.4_universal.dmg");
    expect(picked["macos-app"]?.name).toBe("Proxora_2.7.4_universal.app.tar.gz");
  });

  it("reports missing platforms as null", () => {
    const picked = pickDesktopDownloads(parseReleaseAssets({ assets: release.assets.slice(0, 2) }));
    expect(picked.macos).toBeNull();
    expect(picked["macos-app"]).toBeNull();
    expect(parseReleaseAssets(null)).toEqual([]);
  });

  it("validates platforms and server origins", () => {
    expect(isDesktopPlatform("windows")).toBe(true);
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
    });
    expect(script).toContain("TAG='v2.7.4'");
    expect(script).toContain("SERVER_URL='http://192.168.178.246:3000'");
    expect(script).toContain('ASSET="Proxora_${VERSION}_universal.app.tar.gz"');
    expect(script).toContain("xattr -dr com.apple.quarantine");
    const dir = mkdtempSync(join(tmpdir(), "proxora-mac-"));
    const file = join(dir, "install.sh");
    writeFileSync(file, script);
    expect(() => execFileSync("bash", ["-n", file])).not.toThrow();
  });

  it("drops unsafe repo, tag and server values", () => {
    const script = buildMacInstallScript({ repo: "a/b; rm -rf /", tag: "v1'; id;'", serverUrl: "file:///etc" });
    expect(script).toContain("REPO='MarcelRuh/proxora'");
    expect(script).toContain("TAG=''");
    expect(script).toContain("SERVER_URL=''");
  });
});
