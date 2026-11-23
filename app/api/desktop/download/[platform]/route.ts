import { apiRoute } from "@/server/http/api-route";
import { json } from "@/server/http/respond";
import { DEFAULT_GITHUB_REPO } from "@/lib/version";
import { DESKTOP_CONTENT_TYPES, isDesktopPlatform, pickDesktopDownloads } from "@/lib/desktop-clients";
import { fetchGithubLatestRelease, fetchGithubReleaseAssets } from "@/server/services/github-revision";

/** Streams a desktop installer from the latest GitHub release through Proxora. */
export const GET = apiRoute(null, async (_request, _session, params) => {
  const platform = params.platform ?? "";
  if (!isDesktopPlatform(platform)) return json({ error: "Unknown platform", code: "NOT_FOUND" }, 404);
  const repo = process.env.PROXORA_REPO ?? DEFAULT_GITHUB_REPO;
  const release = await fetchGithubLatestRelease(repo).catch(() => null);
  if (!release) return json({ error: "No release found", code: "NOT_FOUND" }, 404);
  const asset = pickDesktopDownloads(await fetchGithubReleaseAssets(repo, release.tag))[platform];
  if (!asset) {
    return json({ error: "This client is not on the GitHub release yet. Try again after CI finishes.", code: "NOT_FOUND" }, 404);
  }
  const upstream = await fetch(asset.url, {
    headers: { "User-Agent": "proxora-desktop-download", Accept: "application/octet-stream" },
    redirect: "follow",
  });
  if (!upstream.ok || !upstream.body) return json({ error: "Download failed", code: "UPSTREAM" }, 502);
  const headers: Record<string, string> = {
    "Content-Type": DESKTOP_CONTENT_TYPES[platform],
    "Content-Disposition": `attachment; filename="${asset.name.replace(/[^\w.-]/g, "_")}"`,
    "Cache-Control": "no-store",
  };
  const length = upstream.headers.get("content-length");
  if (length) headers["Content-Length"] = length;
  return new Response(upstream.body, { status: 200, headers });
});
