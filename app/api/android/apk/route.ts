import { apiRoute } from "@/server/http/api-route";
import { json } from "@/server/http/respond";
import { proxyReleaseAsset } from "@/server/http/release-download";
import { DEFAULT_GITHUB_REPO } from "@/lib/version";
import { pickAndroidApk } from "@/lib/desktop-clients";
import { fetchGithubLatestRelease, fetchGithubReleaseAssets } from "@/server/services/github-revision";

/** Streams the Android APK of the latest GitHub release through Proxora. */
export const GET = apiRoute(null, async () => {
  const repo = process.env.PROXORA_REPO ?? DEFAULT_GITHUB_REPO;
  const release = await fetchGithubLatestRelease(repo);
  const assets = release ? await fetchGithubReleaseAssets(repo, release.tag) : null;
  if (!release || !assets) {
    return json(
      { error: "GitHub is not reachable or has no published release yet. Try again in a moment.", code: "UNAVAILABLE" },
      503,
    );
  }
  const apk = pickAndroidApk(assets);
  if (!apk) {
    return json({ error: "APK is not on this GitHub release yet. Try again after CI finishes.", code: "NOT_FOUND" }, 404);
  }
  return proxyReleaseAsset({
    url: apk.url,
    filename: `proxora-${release.version}.apk`,
    contentType: "application/vnd.android.package-archive",
    userAgent: "proxora-android-update",
  });
});
