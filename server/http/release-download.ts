import { json } from "@/server/http/respond";

/** How long GitHub gets to start answering; the transfer itself may take as long as it needs. */
const CONNECT_TIMEOUT_MS = 30_000;

/**
 * Streams a GitHub release asset through Proxora, so clients only have to reach this server.
 * Answers 502 when GitHub fails or does not start sending within CONNECT_TIMEOUT_MS.
 */
export async function proxyReleaseAsset(opts: {
  url: string;
  filename: string;
  contentType: string;
  userAgent: string;
}): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), CONNECT_TIMEOUT_MS);
  let upstream: Response | null = null;
  try {
    upstream = await fetch(opts.url, {
      headers: { "User-Agent": opts.userAgent, Accept: "application/octet-stream" },
      redirect: "follow",
      signal: controller.signal,
    });
  } catch {
    upstream = null;
  } finally {
    clearTimeout(timer);
  }
  if (!upstream?.ok || !upstream.body) {
    await upstream?.body?.cancel().catch(() => undefined);
    return json({ error: "Download from GitHub failed. Try again in a moment.", code: "UPSTREAM" }, 502);
  }
  const headers = new Headers({
    "Content-Type": opts.contentType,
    "Content-Disposition": `attachment; filename="${opts.filename.replace(/[^\w.-]/g, "_")}"`,
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
  });
  const length = upstream.headers.get("content-length");
  // fetch() decodes compressed bodies, so the upstream length only fits an uncompressed transfer.
  if (length && /^\d+$/.test(length) && !upstream.headers.get("content-encoding")) headers.set("Content-Length", length);
  return new Response(upstream.body, { status: 200, headers });
}
