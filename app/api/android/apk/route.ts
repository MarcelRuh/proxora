import { apiRoute } from "@/server/http/api-route";
import { json } from "@/server/http/respond";
import { DEFAULT_GITHUB_REPO } from "@/lib/version";
import { fetchGithubLatestRelease, fetchGithubReleaseApkUrl } from "@/server/services/github-revision";

export const GET = apiRoute(null, async () => {
  const repo = process.env.PROXORA_REPO ?? DEFAULT_GITHUB_REPO;
  const release = await fetchGithubLatestRelease(repo).catch(() => null);
  if (!release) return json({ error: "No Android release found", code: "NOT_FOUND" }, 404);
  const apkUrl = await fetchGithubReleaseApkUrl(repo, release.tag);
  if (!apkUrl) {
    return json({ error: "APK is not on this GitHub release yet. Try again after CI finishes.", code: "NOT_FOUND" }, 404);
  }
  const upstream = await fetch(apkUrl, {
    headers: {
      "User-Agent": "proxora-android-update",
      Accept: "application/octet-stream",
    },
    redirect: "follow",
  });
  if (!upstream.ok || !upstream.body) {
    return json({ error: "APK download failed", code: "UPSTREAM" }, 502);
  }
  const filename = `proxora-${release.version}.apk`;
  return new Response(upstream.body, {
    status: 200,
    headers: {
      "Content-Type": "application/vnd.android.package-archive",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
    },
  });
});
