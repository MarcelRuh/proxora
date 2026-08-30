import { existsSync, mkdirSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import path from "node:path";

export const UPDATE_REQUEST_FILE = "request";
export const UPDATE_LOCK_FILE = ".proxora-update.lock";
export const UPDATE_TARGET_FILE = "target";

export function resolveUpdateSignalDir(env: NodeJS.Dict<string | undefined> = process.env): string | null {
  const dir = env.PROXORA_UPDATE_SIGNAL_DIR?.trim();
  return dir || null;
}

export function isSignalDirReady(dir: string | null | undefined): dir is string {
  return Boolean(dir && existsSync(dir));
}

export function isUpdateBusyFromSignal(dir: string): boolean {
  return existsSync(path.join(dir, UPDATE_REQUEST_FILE)) || existsSync(path.join(dir, UPDATE_LOCK_FILE));
}

export function hasDockerSocket(sock = "/var/run/docker.sock"): boolean {
  return existsSync(sock);
}

/** Sidecar ignores the payload; only the file's existence is the trigger. */
export function writeUpdateRequest(dir: string, now: string = new Date().toISOString()): void {
  mkdirSync(dir, { recursive: true });
  const tmp = path.join(dir, `${UPDATE_REQUEST_FILE}.tmp`);
  const dest = path.join(dir, UPDATE_REQUEST_FILE);
  writeFileSync(tmp, `${now}\n`, { encoding: "utf8" });
  renameSync(tmp, dest);
}

/** Pin the tag for this run. Pass null to drop a leftover pin from a previous update. */
export function writeUpdateTarget(dir: string, tag: string | null): void {
  mkdirSync(dir, { recursive: true });
  const dest = path.join(dir, UPDATE_TARGET_FILE);
  if (!tag?.trim()) {
    try {
      unlinkSync(dest);
    } catch {
      /* missing */
    }
    return;
  }
  const tmp = path.join(dir, `${UPDATE_TARGET_FILE}.tmp`);
  writeFileSync(tmp, `${tag.trim()}\n`, { encoding: "utf8" });
  renameSync(tmp, dest);
}
