import { NextRequest } from "next/server";
import { requireSession } from "@/server/auth/session";
import { ForbiddenError, ValidationError } from "@/lib/errors";
import { isCommunityScriptLogoProxyHost } from "@/lib/community-scripts";
import { assertSameOrigin, handleRouteError } from "@/server/http/respond";

const CACHE_TTL_MS = 12 * 60 * 60_000;
const logoCache = new Map<string, { at: number; status: number; contentType: string; body: ArrayBuffer }>();

function isAllowedLogoUrl(raw: string): URL | null {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (url.protocol !== "https:") return null;
  if (!isCommunityScriptLogoProxyHost(url.hostname)) return null;
  return url;
}

export async function GET(request: NextRequest) {
  try {
    assertSameOrigin(request);
    await requireSession();
    const raw = request.nextUrl.searchParams.get("u")?.trim() ?? "";
    if (!raw || raw.length > 500) throw new ValidationError("Invalid logo URL");
    const target = isAllowedLogoUrl(raw);
    if (!target) throw new ValidationError("Logo host not allowed");

    const key = target.toString();
    const cached = logoCache.get(key);
    if (cached && Date.now() - cached.at < CACHE_TTL_MS) {
      if (cached.status !== 200) {
        return new Response(null, { status: cached.status === 404 ? 404 : 502 });
      }
      return new Response(cached.body, {
        status: 200,
        headers: {
          "Content-Type": cached.contentType,
          "Cache-Control": "public, max-age=43200",
        },
      });
    }

    const upstream = await fetch(key, {
      headers: {
        Accept: "image/*,*/*;q=0.8",
        "User-Agent": "Proxora/community-scripts-logo",
      },
      signal: AbortSignal.timeout(12_000),
      redirect: "follow",
    });
    if (!upstream.ok) {
      logoCache.set(key, {
        at: Date.now(),
        status: upstream.status,
        contentType: "application/octet-stream",
        body: new ArrayBuffer(0),
      });
      return new Response(null, { status: upstream.status === 404 ? 404 : 502 });
    }
    const contentType = upstream.headers.get("content-type") || "application/octet-stream";
    if (!contentType.startsWith("image/") && !contentType.includes("svg")) {
      return new Response(null, { status: 502 });
    }
    const body = await upstream.arrayBuffer();
    if (body.byteLength > 2_000_000) {
      return new Response(null, { status: 502 });
    }
    logoCache.set(key, { at: Date.now(), status: 200, contentType, body });
    // Bound memory: drop oldest when large.
    if (logoCache.size > 400) {
      const first = logoCache.keys().next().value;
      if (first) logoCache.delete(first);
    }
    return new Response(body, {
      status: 200,
      headers: {
        "Content-Type": contentType,
        "Cache-Control": "public, max-age=43200",
      },
    });
  } catch (error) {
    if (error instanceof ForbiddenError) return handleRouteError(error);
    return handleRouteError(error);
  }
}
