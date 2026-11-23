import { apiRoute } from "@/server/http/api-route";
import { DEFAULT_GITHUB_REPO } from "@/lib/version";
import { buildMacInstallScript, normalizeServerOrigin, pickDesktopDownloads } from "@/lib/desktop-clients";
import { fetchGithubLatestRelease, fetchGithubReleaseAssets } from "@/server/services/github-revision";

/** macOS install script, pinned to the latest release and pre-set to this Proxora server. */
export const GET = apiRoute(null, async (request) => {
  const repo = process.env.PROXORA_REPO ?? DEFAULT_GITHUB_REPO;
  const release = await fetchGithubLatestRelease(repo).catch(() => null);
  let tag: string | null = null;
  if (release) {
    const assets = await fetchGithubReleaseAssets(repo, release.tag);
    if (pickDesktopDownloads(assets)["macos-app"]) tag = release.tag;
  }
  // The browser sends the Proxora page as Referer, which is the address the user actually reaches.
  const serverUrl =
    normalizeServerOrigin(request.nextUrl.searchParams.get("server")) ??
    normalizeServerOrigin(request.headers.get("referer")) ??
    normalizeServerOrigin(process.env.APP_URL);
  const script = buildMacInstallScript({ repo, tag, serverUrl });
  return new Response(script, {
    status: 200,
    headers: {
      "Content-Type": "text/x-shellscript; charset=utf-8",
      "Content-Disposition": 'attachment; filename="install-proxora-macos.sh"',
      "Cache-Control": "no-store",
    },
  });
});
