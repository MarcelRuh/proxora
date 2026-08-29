import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { APP_VERSION, compareSemver } from "@/lib/version";

const execFileAsync = promisify(execFile);

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

export async function fetchGithubChangelog(
  repo: string,
  ref: string,
  currentVersion: string,
): Promise<string | null> {
  const url = `https://raw.githubusercontent.com/${repo}/${ref}/CHANGELOG.md`;
  const res = await fetch(url, { headers: { "User-Agent": "proxora-self-update" } });
  if (!res.ok) return null;
  const text = await res.text();
  return extractNewerChangelog(text, currentVersion);
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

export async function fetchGithubLatestRelease(repo: string): Promise<GithubRelease | null> {
  const res = await fetch(`https://api.github.com/repos/${repo}/releases/latest`, { headers: githubHeaders() });
  if (!res.ok) return null;
  return parseGithubRelease(await res.json());
}
