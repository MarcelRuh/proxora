import { apiRoute } from "@/server/http/api-route";
import { json } from "@/server/http/respond";
import { DEFAULT_GITHUB_REPO } from "@/lib/version";
import { DESKTOP_PLATFORMS, pickAndroidApk, pickDesktopDownloads } from "@/lib/desktop-clients";
import { fetchGithubLatestRelease, fetchGithubReleaseAssets } from "@/server/services/github-revision";

/** Which client downloads the latest published release offers. */
export const GET = apiRoute(null, async () => {
  const repo = process.env.PROXORA_REPO ?? DEFAULT_GITHUB_REPO;
  const release = await fetchGithubLatestRelease(repo);
  if (!release) {
    return json({ error: "GitHub is not reachable or has no published release yet.", code: "UNAVAILABLE" }, 503);
  }
  // null = GitHub could not be asked right now; the page then says so instead of "not in this release".
  const assets = await fetchGithubReleaseAssets(repo, release.tag);
  const picked = pickDesktopDownloads(assets ?? []);
  const platforms = Object.fromEntries(
    DESKTOP_PLATFORMS.map((p) => [p, picked[p] ? { name: picked[p].name, size: picked[p].size } : null]),
  );
  return json({
    version: release.version,
    tag: release.tag,
    releaseUrl: release.htmlUrl,
    platforms,
    android: Boolean(assets && pickAndroidApk(assets)),
    assetsUnavailable: assets === null,
  });
});
