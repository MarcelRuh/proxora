/** Anonymous GHCR manifest probe (public packages). */

const ACCEPT =
  "application/vnd.oci.image.index.v1+json, application/vnd.oci.image.manifest.v1+json, application/vnd.docker.distribution.manifest.v2+json, application/vnd.docker.distribution.manifest.list.v2+json";

type CacheEntry = { at: number; ok: boolean };
const cache = new Map<string, CacheEntry>();
const CACHE_MS = 30_000;

async function anonymousPullToken(repository: string): Promise<string | null> {
  const url = `https://ghcr.io/token?service=ghcr.io&scope=repository:${encodeURIComponent(repository)}:pull`;
  const res = await fetch(url, {
    headers: { Accept: "application/json", "User-Agent": "proxora-self-update" },
    signal: AbortSignal.timeout(8_000),
  });
  if (!res.ok) return null;
  const json = (await res.json().catch(() => null)) as { token?: string } | null;
  return typeof json?.token === "string" && json.token ? json.token : null;
}

/**
 * True when `ghcr.io/<repository>:<tag>` has a published manifest.
 * `repository` is owner/name without registry, e.g. `marcelruh/proxora`.
 */
export async function ghcrImageTagExists(repository: string, tag: string): Promise<boolean> {
  const repo = repository.trim().replace(/^ghcr\.io\//i, "").toLowerCase();
  const version = tag.trim().replace(/^v/i, "");
  if (!repo || !version) return false;
  const key = `${repo}:${version}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.ok;

  const token = await anonymousPullToken(repo);
  if (!token) {
    cache.set(key, { at: Date.now(), ok: false });
    return false;
  }
  const res = await fetch(`https://ghcr.io/v2/${repo}/manifests/${encodeURIComponent(version)}`, {
    method: "HEAD",
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: ACCEPT,
      "User-Agent": "proxora-self-update",
    },
    signal: AbortSignal.timeout(8_000),
  });
  const ok = res.ok;
  cache.set(key, { at: Date.now(), ok });
  return ok;
}

/** Test helper. */
export function clearGhcrManifestCache() {
  cache.clear();
}
