import { apiRoute } from "@/server/http/api-route";
import { json } from "@/server/http/respond";
import { DEFAULT_GITHUB_REPO } from "@/lib/version";
import { DESKTOP_PLATFORMS, pickDesktopDownloads } from "@/lib/desktop-clients";
import { fetchGithubLatestRelease, fetchGithubReleaseApkUrl, fetchGithubReleaseAssets } from "@/server/services/github-revision";

/** Which client downloads the latest published release offers. */
export const GET = apiRoute(null, async () => {
  const repo = process.env.PROXORA_REPO ?? DEFAULT_GITHUB_REPO;
  const release = await fetchGithubLatestRelease(repo).catch(() => null);
  if (!release) return json({ error: "No release found", code: "NOT_FOUND" }, 404);
  const [assets, apkUrl] = await Promise.all([
    fetchGithubReleaseAssets(repo, release.tag),
    fetchGithubReleaseApkUrl(repo, release.tag).catch(() => null),
  ]);
  const picked = pickDesktopDownloads(assets);
  const platforms = Object.fromEntries(
    DESKTOP_PLATFORMS.map((p) => [p, picked[p] ? { name: picked[p].name, size: picked[p].size } : null]),
  );
  return json({
    version: release.version,
    tag: release.tag,
    releaseUrl: release.htmlUrl,
    platforms,
    android: Boolean(apkUrl),
  });
});
