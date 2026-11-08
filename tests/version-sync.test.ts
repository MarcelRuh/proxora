import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { APP_VERSION } from "@/lib/version";

describe("APP_VERSION sync", () => {
  it("matches package.json version so self-update can land", () => {
    const pkg = JSON.parse(readFileSync(path.join(process.cwd(), "package.json"), "utf8")) as {
      version: string;
    };
    expect(APP_VERSION).toBe(pkg.version);
  });

  it("keeps the Android app versionName in sync", () => {
    const gradle = readFileSync(path.join(process.cwd(), "android/app/build.gradle.kts"), "utf8");
    const name = /versionName\s*=\s*"([^"]+)"/.exec(gradle)?.[1];
    expect(name).toBe(APP_VERSION);
    const [maj, min, pat] = APP_VERSION.split(".").map((n) => Number.parseInt(n, 10));
    const expectedCode = maj * 1000 + min * 100 + pat;
    const code = Number(/versionCode\s*=\s*(\d+)/.exec(gradle)?.[1]);
    expect(code).toBe(expectedCode);
  });
});
