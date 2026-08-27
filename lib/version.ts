export const APP_NAME = "Proxora";
export const APP_VERSION = "1.0.41";
export const DEFAULT_GITHUB_REPO = "MarcelRuh/proxora";
export const DEFAULT_GITHUB_BRANCH = "main";

export function compareSemver(a: string, b: string): number {
  const pa = parse(a);
  const pb = parse(b);
  for (let i = 0; i < 3; i++) {
    if (pa[i] !== pb[i]) return pa[i] - pb[i];
  }
  return 0;
}

function parse(v: string): [number, number, number] {
  const clean = v.trim().replace(/^v/i, "").split(/[-+]/)[0] ?? "0.0.0";
  const [maj, min, pat] = clean.split(".").map((n) => Number.parseInt(n, 10) || 0);
  return [maj, min, pat];
}

export function newerVersion(current: string, candidate: string | null | undefined): string | null {
  if (!candidate) return null;
  return compareSemver(candidate, current) > 0 ? candidate : null;
}

export function selfUpdateTargetVersion(
  running: string,
  remote: string | null,
  source: string | null,
): string | null {
  return newerVersion(running, remote) ?? newerVersion(running, source);
}

export function isSelfUpdateAvailable(input: {
  runningVersion: string;
  sourceVersion: string | null;
  remoteVersion: string | null;
}): boolean {
  return Boolean(selfUpdateTargetVersion(input.runningVersion, input.remoteVersion, input.sourceVersion));
}
