#!/usr/bin/env node
/**
 * Bump Proxora app version without corrupting package-lock dependency pins.
 * Usage: node scripts/bump-version.mjs 2.3.3
 */
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const version = process.argv[2]?.trim();
if (!/^\d+\.\d+\.\d+$/.test(version ?? "")) {
  console.error("Usage: node scripts/bump-version.mjs <semver>");
  process.exit(1);
}

const root = resolve(import.meta.dirname, "..");

function write(rel, text) {
  writeFileSync(resolve(root, rel), text);
  console.log("updated", rel);
}

const pkgPath = resolve(root, "package.json");
const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
pkg.version = version;
write("package.json", `${JSON.stringify(pkg, null, 2)}\n`);

const lockPath = resolve(root, "package-lock.json");
const lock = JSON.parse(readFileSync(lockPath, "utf8"));
lock.version = version;
if (lock.packages?.[""]) lock.packages[""].version = version;
write("package-lock.json", `${JSON.stringify(lock, null, 2)}\n`);

write(
  "lib/version.ts",
  readFileSync(resolve(root, "lib/version.ts"), "utf8").replace(
    /export const APP_VERSION = "[^"]+";/,
    `export const APP_VERSION = "${version}";`,
  ),
);

write(
  "docker-compose.prod.yml",
  readFileSync(resolve(root, "docker-compose.prod.yml"), "utf8").replace(
    /PROXORA_VERSION:-\d+\.\d+\.\d+/,
    `PROXORA_VERSION:-${version}`,
  ),
);

write(
  "README.md",
  readFileSync(resolve(root, "README.md"), "utf8").replace(/\*\*v\d+\.\d+\.\d+\*\*/, `**v${version}**`),
);

write(
  "scripts/install.sh",
  readFileSync(resolve(root, "scripts/install.sh"), "utf8")
    .replace(/^PROXORA_VERSION=.*/m, `PROXORA_VERSION=${version}`)
    .replace(/PROXORA_VERSION=\d+\.\d+\.\d+/g, `PROXORA_VERSION=${version}`)
    .replace(/printf 'PROXORA_VERSION=%s\\n' "\d+\.\d+\.\d+"/, `printf 'PROXORA_VERSION=%s\\n' "${version}"`),
);

const desktopPkgPath = resolve(root, "desktop/package.json");
const desktopPkg = JSON.parse(readFileSync(desktopPkgPath, "utf8"));
desktopPkg.version = version;
write("desktop/package.json", `${JSON.stringify(desktopPkg, null, 2)}\n`);

write(
  "desktop/src-tauri/Cargo.toml",
  readFileSync(resolve(root, "desktop/src-tauri/Cargo.toml"), "utf8").replace(
    /^version = "[^"]+"/m,
    `version = "${version}"`,
  ),
);

write(
  "desktop/src-tauri/tauri.conf.json",
  readFileSync(resolve(root, "desktop/src-tauri/tauri.conf.json"), "utf8").replace(
    /"version": "[^"]+"/,
    `"version": "${version}"`,
  ),
);

const [maj, min, pat] = version.split(".").map((n) => Number.parseInt(n, 10));
const versionCode = maj * 1000 + min * 100 + pat;
const androidGradle = resolve(root, "android/app/build.gradle.kts");
write(
  "android/app/build.gradle.kts",
  readFileSync(androidGradle, "utf8")
    .replace(/versionCode\s*=\s*\d+/, `versionCode = ${versionCode}`)
    .replace(/versionName\s*=\s*"[^"]+"/, `versionName = "${version}"`),
);

console.log(`bumped to ${version}`);
