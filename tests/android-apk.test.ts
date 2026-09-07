import { describe, expect, it } from "vitest";
import { androidApkUpdateAvailable, githubApkDownloadUrl, parseProxoraAndroidVersion } from "@/lib/android-apk";

describe("android apk helpers", () => {
  it("builds the GitHub asset URL from a release tag", () => {
    expect(githubApkDownloadUrl("MarcelRuh/proxora", "v1.7.15")).toBe(
      "https://github.com/MarcelRuh/proxora/releases/download/v1.7.15/proxora-1.7.15.apk",
    );
    expect(githubApkDownloadUrl("MarcelRuh/proxora", "1.7.16")).toBe(
      "https://github.com/MarcelRuh/proxora/releases/download/v1.7.16/proxora-1.7.16.apk",
    );
  });

  it("reads the APK version from the WebView user agent", () => {
    expect(parseProxoraAndroidVersion("Mozilla/5.0 ProxoraAndroid/1.7.15")).toBe("1.7.15");
    expect(parseProxoraAndroidVersion("Mozilla/5.0 Chrome/120")).toBeNull();
  });

  it("only offers an update when GitHub is newer", () => {
    expect(androidApkUpdateAvailable("1.7.15", "1.7.16")).toBe(true);
    expect(androidApkUpdateAvailable("1.7.16", "1.7.16")).toBe(false);
    expect(androidApkUpdateAvailable("1.7.16", "1.7.15")).toBe(false);
    expect(androidApkUpdateAvailable("1.7.15", null)).toBe(false);
  });
});
