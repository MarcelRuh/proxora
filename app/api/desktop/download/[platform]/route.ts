import { apiRoute } from "@/server/http/api-route";
import { json } from "@/server/http/respond";
import { proxyReleaseAsset } from "@/server/http/release-download";
import { DEFAULT_GITHUB_REPO } from "@/lib/version";
import { DESKTOP_CONTENT_TYPES, isDesktopPlatform, pickDesktopDownloads } from "@/lib/desktop-clients";
import { fetchGithubLatestRelease, fetchGithubReleaseAssets } from "@/server/services/github-revision";

/** Streams a desktop installer from the latest GitHub release through Proxora. */
export const GET = apiRoute(null, async (_request, _session, params) => {
  const platform = params.platform ?? "";
  if (!isDesktopPlatform(platform)) return json({ error: "Unknown platform", code: "NOT_FOUND" }, 404);
  const repo = process.env.PROXORA_REPO ?? DEFAULT_GITHUB_REPO;
  const release = await fetchGithubLatestRelease(repo);
  const assets = release ? await fetchGithubReleaseAssets(repo, release.tag) : null;
  if (!assets) {
    return json(
      { error: "GitHub is not reachable or has no published release yet. Try again in a moment.", code: "UNAVAILABLE" },
      503,
    );
  }
  const asset = pickDesktopDownloads(assets)[platform];
  if (!asset) {
    return json({ error: "This client is not on the GitHub release yet. Try again after CI finishes.", code: "NOT_FOUND" }, 404);
  }
  return proxyReleaseAsset({
    url: asset.url,
    filename: asset.name,
    contentType: DESKTOP_CONTENT_TYPES[platform],
    userAgent: "proxora-desktop-download",
  });
});
