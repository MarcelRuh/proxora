import type { NextRequest } from "next/server";
import { apiRoute } from "@/server/http/api-route";
import { isAllowedOrigin } from "@/server/http/respond";
import { DEFAULT_GITHUB_REPO } from "@/lib/version";
import { buildMacInstallScript, normalizeServerOrigin, pickDesktopDownloads } from "@/lib/desktop-clients";
import { fetchGithubLatestRelease, fetchGithubReleaseAssets } from "@/server/services/github-revision";

/** Only addresses of this Proxora instance, so a link from elsewhere cannot preset a foreign server. */
function ownOrigin(request: NextRequest, value: string | null | undefined): string | null {
  const origin = normalizeServerOrigin(value);
  return origin && isAllowedOrigin(request, origin) ? origin : null;
}

/** macOS install script, pinned to the latest release (with its SHA-256) and preset to this Proxora server. */
export const GET = apiRoute(null, async (request) => {
  const repo = process.env.PROXORA_REPO ?? DEFAULT_GITHUB_REPO;
  const release = await fetchGithubLatestRelease(repo);
  let tag: string | null = null;
  let sha256: string | null = null;
  if (release) {
    const app = pickDesktopDownloads((await fetchGithubReleaseAssets(repo, release.tag)) ?? [])["macos-app"];
    // Without the asset (GitHub unreachable, CI still running) the script looks up the latest release itself.
    if (app) {
      tag = release.tag;
      sha256 = app.sha256;
    }
  }
  // The page passes its own address (the one the user actually reaches); the Referer is the fallback.
  const serverUrl =
    ownOrigin(request, request.nextUrl.searchParams.get("server")) ??
    ownOrigin(request, request.headers.get("referer")) ??
    normalizeServerOrigin(process.env.APP_URL);
  const script = buildMacInstallScript({ repo, tag, serverUrl, sha256 });
  return new Response(script, {
    status: 200,
    headers: {
      "Content-Type": "text/x-shellscript; charset=utf-8",
      "Content-Disposition": 'attachment; filename="install-proxora-macos.sh"',
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
});
