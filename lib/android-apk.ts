import { compareSemver } from "@/lib/version";

export function githubApkDownloadUrl(repo: string, tag: string): string {
  const version = tag.replace(/^v/i, "");
  const normalized = /^v/i.test(tag) ? tag : `v${version}`;
  return `https://github.com/${repo}/releases/download/${normalized}/proxora-${version}.apk`;
}

export function parseProxoraAndroidVersion(ua: string): string | null {
  const match = /ProxoraAndroid\/(\d+\.\d+\.\d+)/i.exec(ua);
  return match?.[1] ?? null;
}

export function androidApkUpdateAvailable(current: string, latest: string | null | undefined): boolean {
  if (!current || !latest) return false;
  return compareSemver(latest, current) > 0;
}
