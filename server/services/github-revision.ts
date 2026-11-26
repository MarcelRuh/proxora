import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { compareSemver } from "@/lib/version";
import { parseReleaseAssets, pickAndroidApk, type ReleaseAsset } from "@/lib/desktop-clients";

const execFileAsync = promisify(execFile);

/** Upper bound for a single GitHub metadata request, so a hanging GitHub never blocks a page. */
const GITHUB_TIMEOUT_MS = 10_000;
/** Failed lookups are retried after this long instead of being cached like successful ones. */
const FAILURE_CACHE_MS = 30_000;

function githubHeaders(): Record<string, string> {
  const token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN;
  const headers: Record<string, string> = {
    "User-Agent": "proxora-self-update",
    Accept: "application/vnd.github+json",
  };
  if (token) headers.Authorization = `Bearer ${token}`;
  return headers;
}

export async function fetchGithubCommitSha(repo: string, branch: string): Promise<string> {
  const cloneUrl = `https://github.com/${repo}.git`;
  try {
    const { stdout } = await execFileAsync("git", ["ls-remote", cloneUrl, `refs/heads/${branch}`], {
      timeout: 15_000,
    });
    const sha = stdout.trim().split(/\s+/)[0];
    if (sha && /^[a-f0-9]{40}$/.test(sha)) return sha;
  } catch {
    /* fall through */
  }

  try {
    const res = await fetch(`https://github.com/${repo}.git/info/refs?service=git-upload-pack`, {
      headers: { "User-Agent": "git/2.43.0" },
    });
    const text = await res.text();
    const match = text.match(new RegExp(`([0-9a-f]{40})\\s+refs/heads/${branch}`));
    if (match?.[1]) return match[1];
  } catch {
    /* fall through */
  }

  try {
    const res = await fetch(`https://github.com/${repo}/commits/${branch}.atom`, {
      headers: { "User-Agent": "proxora-self-update" },
    });
    const text = await res.text();
    const match = text.match(/Grit::Commit\/([a-f0-9]{40})/);
    if (match?.[1]) return match[1];
  } catch {
    /* fall through */
  }

  const res = await fetch(`https://api.github.com/repos/${repo}/commits/${branch}`, {
    headers: githubHeaders(),
  });
  if (!res.ok) {
    throw new Error(`GitHub commit lookup failed (${res.status})`);
  }
  const json = (await res.json()) as { sha?: string };
  if (!json.sha) throw new Error("GitHub commit SHA missing");
  return json.sha;
}

export async function fetchGithubPackageVersion(repo: string, ref: string): Promise<string | null> {
  const url = `https://raw.githubusercontent.com/${repo}/${ref}/package.json`;
  const res = await fetch(url, { headers: { "User-Agent": "proxora-self-update" } });
  if (!res.ok) return null;
  const json = (await res.json()) as { version?: string };
  return json.version ?? null;
}

const CHANGELOG_CACHE_MS = 5 * 60_000;
let changelogCache: { at: number; key: string; value: string | null } | null = null;

export async function fetchGithubChangelog(
  repo: string,
  ref: string,
  currentVersion: string,
): Promise<string | null> {
  const key = `${repo}:${ref}:${currentVersion}`;
  if (changelogCache && changelogCache.key === key && Date.now() - changelogCache.at < CHANGELOG_CACHE_MS) {
    return changelogCache.value;
  }
  const url = `https://raw.githubusercontent.com/${repo}/${ref}/CHANGELOG.md`;
  const res = await fetch(url, { headers: { "User-Agent": "proxora-self-update" } });
  if (!res.ok) return null;
  const text = await res.text();
  const value = extractNewerChangelog(text, currentVersion);
  changelogCache = { at: Date.now(), key, value };
  return value;
}

export function extractNewerChangelog(markdown: string, currentVersion: string): string {
  const blocks = markdown.split(/^## /m).slice(1);
  const notes: string[] = [];
  for (const block of blocks) {
    const first = block.split("\n")[0] ?? "";
    const match = first.match(/\[?v?(\d+\.\d+\.\d+)/i);
    if (!match?.[1]) continue;
    if (compareSemver(match[1], currentVersion) <= 0) continue;
    notes.push(`## ${block.trim()}`);
  }
  return notes.join("\n\n").trim();
}

export type GithubRelease = {
  tag: string;
  version: string;
  sha: string | null;
  htmlUrl: string | null;
};

export function parseGithubRelease(json: unknown): GithubRelease | null {
  if (!json || typeof json !== "object") return null;
  const raw = json as { tag_name?: unknown; target_commitish?: unknown; html_url?: unknown };
  const tag = String(raw.tag_name ?? "").trim();
  if (!tag) return null;
  const version = tag.replace(/^v/i, "");
  if (!/^\d+\.\d+\.\d+/.test(version)) return null;
  const sha = typeof raw.target_commitish === "string" && /^[a-f0-9]{40}$/i.test(raw.target_commitish) ? raw.target_commitish : null;
  return { tag, version, sha, htmlUrl: typeof raw.html_url === "string" ? raw.html_url : null };
}

export function pickGithubReleaseApkUrl(json: unknown): string | null {
  if (!json || typeof json !== "object") return null;
  const assets = (json as { assets?: unknown }).assets;
  if (!Array.isArray(assets)) return null;
  for (const asset of assets) {
    if (!asset || typeof asset !== "object") continue;
    const name = String((asset as { name?: unknown }).name ?? "");
    const url = String((asset as { browser_download_url?: unknown }).browser_download_url ?? "");
    if (/\.apk$/i.test(name) && /^https:\/\//i.test(url)) return url;
  }
  return null;
}

/** APK download URL of a release tag (null when there is none or GitHub is unreachable). */
export async function fetchGithubReleaseApkUrl(repo: string, tag: string): Promise<string | null> {
  const assets = await fetchGithubReleaseAssets(repo, tag);
  return assets ? (pickAndroidApk(assets)?.url ?? null) : null;
}

const assetCache = new Map<string, { at: number; ttl: number; value: ReleaseAsset[] | null }>();
const assetInflight = new Map<string, Promise<ReleaseAsset[] | null>>();

/**
 * All downloadable assets of a release tag, or null when GitHub cannot be asked right now
 * (unreachable, timeout, rate limit). Shared by the desktop, macOS script and Android routes,
 * so a page load costs at most one GitHub API request per tag every few minutes.
 */
export async function fetchGithubReleaseAssets(repo: string, tag: string): Promise<ReleaseAsset[] | null> {
  const version = tag.replace(/^v/i, "");
  const normalized = /^v/i.test(tag) ? tag : `v${version}`;
  const key = `${repo}@${normalized}`;
  const cached = assetCache.get(key);
  if (cached && Date.now() - cached.at < cached.ttl) return cached.value;
  const running = assetInflight.get(key);
  if (running) return running;
  const request = (async () => {
    let value: ReleaseAsset[] | null = null;
    try {
      const res = await fetch(`https://api.github.com/repos/${repo}/releases/tags/${encodeURIComponent(normalized)}`, {
        headers: githubHeaders(),
        signal: AbortSignal.timeout(GITHUB_TIMEOUT_MS),
      });
      if (res.ok) value = parseReleaseAssets(await res.json());
      // 404: the tag has no published release (yet). Rate limits and outages stay null = unknown.
      else if (res.status === 404) value = [];
    } catch {
      value = null;
    }
    // Empty or unknown results are asked again soon: CI may still be uploading the files.
    assetCache.set(key, { at: Date.now(), ttl: value?.length ? RELEASE_CACHE_MS : FAILURE_CACHE_MS, value });
    return value;
  })().finally(() => assetInflight.delete(key));
  assetInflight.set(key, request);
  return request;
}

export function parseReleaseTagFromUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  const match = url.match(/\/releases\/tag\/(v?\d+\.\d+\.\d+)/i);
  if (!match?.[1]) return null;
  const raw = match[1];
  return raw.startsWith("v") || raw.startsWith("V") ? raw : `v${raw}`;
}

export function pickLatestSemverTag(tags: string[]): string | null {
  let best: string | null = null;
  let bestMaj = -1;
  let bestMin = -1;
  let bestPat = -1;
  for (const raw of tags) {
    const trimmed = raw.trim();
    const version = trimmed.replace(/^v/i, "");
    if (!/^\d+\.\d+\.\d+$/.test(version)) continue;
    const [maj, min, pat] = version.split(".").map((n) => Number.parseInt(n, 10) || 0);
    if (maj > bestMaj || (maj === bestMaj && min > bestMin) || (maj === bestMaj && min === bestMin && pat > bestPat)) {
      bestMaj = maj;
      bestMin = min;
      bestPat = pat;
      best = trimmed.startsWith("v") || trimmed.startsWith("V") ? trimmed : `v${version}`;
    }
  }
  return best;
}

async function fetchGithubLatestReleaseFromHtml(repo: string): Promise<GithubRelease | null> {
  try {
    // HEAD is enough: only the final URL (…/releases/tag/vX.Y.Z) matters, not the HTML page.
    const res = await fetch(`https://github.com/${repo}/releases/latest`, {
      method: "HEAD",
      headers: { "User-Agent": "proxora-self-update" },
      redirect: "follow",
      signal: AbortSignal.timeout(GITHUB_TIMEOUT_MS),
    });
    if (!res.ok) return null;
    const tag = parseReleaseTagFromUrl(res.url);
    if (!tag) return null;
    return {
      tag,
      version: tag.replace(/^v/i, ""),
      sha: null,
      htmlUrl: res.url,
    };
  } catch {
    return null;
  }
}

async function fetchGithubLatestReleaseFromGit(repo: string): Promise<GithubRelease | null> {
  try {
    const { stdout } = await execFileAsync("git", ["ls-remote", "--tags", "--refs", `https://github.com/${repo}.git`], {
      timeout: 15_000,
    });
    const tags = stdout
      .split("\n")
      .map((line) => line.replace(/^.*refs\/tags\//, "").trim())
      .filter(Boolean);
    const tag = pickLatestSemverTag(tags);
    if (!tag) return null;
    return {
      tag,
      version: tag.replace(/^v/i, ""),
      sha: null,
      htmlUrl: `https://github.com/${repo}/releases/tag/${tag}`,
    };
  } catch {
    return null;
  }
}

const RELEASE_CACHE_MS = 5 * 60_000;
let releaseCache: { at: number; repo: string; value: GithubRelease | null } | null = null;
let releaseInflight: { repo: string; promise: Promise<GithubRelease | null> } | null = null;

async function fetchGithubLatestReleaseUncached(repo: string): Promise<GithubRelease | null> {
  const fromHtml = await fetchGithubLatestReleaseFromHtml(repo);
  if (fromHtml) return fromHtml;
  const fromGit = await fetchGithubLatestReleaseFromGit(repo);
  if (fromGit) return fromGit;
  try {
    const res = await fetch(`https://api.github.com/repos/${repo}/releases/latest`, {
      headers: githubHeaders(),
      signal: AbortSignal.timeout(GITHUB_TIMEOUT_MS),
    });
    if (!res.ok) return null;
    return parseGithubRelease(await res.json());
  } catch {
    return null;
  }
}

export async function fetchGithubLatestRelease(repo: string): Promise<GithubRelease | null> {
  if (releaseCache && releaseCache.repo === repo) {
    const ttl = releaseCache.value ? RELEASE_CACHE_MS : FAILURE_CACHE_MS;
    if (Date.now() - releaseCache.at < ttl) return releaseCache.value;
  }
  if (releaseInflight && releaseInflight.repo === repo) return releaseInflight.promise;
  const promise = fetchGithubLatestReleaseUncached(repo)
    .catch(() => null)
    .then((value) => {
      releaseCache = { at: Date.now(), repo, value };
      return value;
    })
    .finally(() => {
      if (releaseInflight?.promise === promise) releaseInflight = null;
    });
  releaseInflight = { repo, promise };
  return promise;
}
