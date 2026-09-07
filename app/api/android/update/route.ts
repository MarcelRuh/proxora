import { z } from "zod";
import { apiRoute } from "@/server/http/api-route";
import { json } from "@/server/http/respond";
import { DEFAULT_GITHUB_REPO } from "@/lib/version";
import { androidApkUpdateAvailable, parseProxoraAndroidVersion } from "@/lib/android-apk";
import { fetchGithubLatestRelease } from "@/server/services/github-revision";

export const GET = apiRoute(null, async (req) => {
  const current =
    parseProxoraAndroidVersion(req.headers.get("user-agent") ?? "") ??
    z.string().regex(/^\d+\.\d+\.\d+$/).safeParse(req.nextUrl.searchParams.get("current") ?? "").data ??
    null;
  const repo = process.env.PROXORA_REPO ?? DEFAULT_GITHUB_REPO;
  const release = await fetchGithubLatestRelease(repo).catch(() => null);
  const latest = release?.version ?? null;
  const updateAvailable = Boolean(current && androidApkUpdateAvailable(current, latest));
  return json({
    current,
    latest,
    updateAvailable,
    apkPath: updateAvailable ? "/api/android/apk" : null,
  });
});
