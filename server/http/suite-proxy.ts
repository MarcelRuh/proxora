import type { IncomingMessage, ServerResponse } from "node:http";
import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import type { Duplex } from "node:stream";
import { text as readText } from "node:stream/consumers";
import { Agent, request as undiciRequest } from "undici";
import { SESSION_COOKIE } from "@/lib/env";
import { logger } from "@/lib/logger";
import {
  allowsInsecureTls,
  buildUpstreamHeaders,
  embedContentSecurityPolicy,
  forwardedHost,
  forwardedScheme,
  resolveExternalImageTarget,
  isExternalImagePath,
  isProxyImageType,
  parseSuiteProxyUrl,
  rewriteCookie,
  rewriteEmbedBody,
  rewriteKind,
  rewriteLinkHeader,
  rewriteLocation,
  stripAssetBump,
  suiteProxyPrefix,
  targetsSelf,
  upstreamTarget,
} from "@/lib/suite-proxy";
import { INVENTORY_VIEW_PERMISSIONS, userHasAnyPermission, userHasPermission } from "@/lib/permissions";
import { getSessionFromToken } from "@/server/auth/session-core";
import { loadSuiteEmbeds } from "@/server/services/suite-embeds";

function canUseSuite(user: Parameters<typeof userHasPermission>[0]) {
  return userHasAnyPermission(user, INVENTORY_VIEW_PERMISSIONS) || userHasPermission(user, "settings.view");
}

const insecureAgent = new Agent({
  connect: { rejectUnauthorized: false },
  headersTimeout: 60_000,
  bodyTimeout: 0,
});

const STRIP = new Set([
  "content-security-policy",
  "content-security-policy-report-only",
  "x-frame-options",
  "content-length",
  "content-encoding",
  "transfer-encoding",
  "connection",
  "keep-alive",
  "strict-transport-security",
]);

const BODYLESS = new Set(["GET", "HEAD"]);
const TEXT_LIMIT = 8_000_000;

let embedCache: { at: number; apps: Awaited<ReturnType<typeof loadSuiteEmbeds>>["apps"] } | null = null;

function cookieValue(req: IncomingMessage, name: string): string | undefined {
  const raw = req.headers.cookie ?? "";
  for (const part of raw.split(";")) {
    const [key, ...rest] = part.trim().split("=");
    if (key === name) return decodeURIComponent(rest.join("="));
  }
  return undefined;
}

function headerText(value: string | string[] | undefined): string {
  if (!value) return "";
  return Array.isArray(value) ? value.join(", ") : value;
}

function requestHost(req: IncomingMessage): string {
  return forwardedHost(headerText(req.headers.host));
}

function requestProto(req: IncomingMessage): "http" | "https" {
  return forwardedScheme(headerText(req.headers["x-forwarded-proto"]));
}

function publicOrigin(req: IncomingMessage): string {
  return `${requestProto(req)}://${requestHost(req)}`;
}

function flatHeaders(req: IncomingMessage): Record<string, string | undefined> {
  const headers: Record<string, string | undefined> = {};
  for (const [key, value] of Object.entries(req.headers)) {
    if (value == null) continue;
    headers[key] = headerText(value);
  }
  return headers;
}

async function findApp(id: string) {
  const now = Date.now();
  if (!embedCache || now - embedCache.at > 2000) {
    embedCache = { at: now, apps: (await loadSuiteEmbeds()).apps };
  }
  return embedCache.apps.find((app) => app.id === id) ?? null;
}

const IMAGE_BYTES = 2_000_000;

async function writeExternalImage(res: ServerResponse, search: string) {
  const raw = new URLSearchParams(search.startsWith("?") ? search.slice(1) : search).get("u") ?? "";
  let current = await resolveExternalImageTarget(raw);
  if (!current) {
    send(res, 400, "Bildadresse ungültig");
    return;
  }
  let hops = 0;
  while (hops <= 3) {
    const upstream = await undiciRequest(current, {
      method: "GET",
      headers: { accept: "image/*,*/*;q=0.1" },
      headersTimeout: 10_000,
      bodyTimeout: 10_000,
    });
    if (upstream.statusCode >= 300 && upstream.statusCode < 400) {
      const next = await resolveExternalImageTarget(
        new URL(headerText(upstream.headers.location), current).toString(),
        true,
      );
      upstream.body.destroy();
      if (!next) {
        send(res, 502, "Bildadresse ungültig");
        return;
      }
      current = next;
      hops += 1;
      continue;
    }
    if (upstream.statusCode !== 200) {
      upstream.body.destroy();
      send(res, upstream.statusCode === 404 ? 404 : 502, "Bild nicht erreichbar");
      return;
    }
    const type = headerText(upstream.headers["content-type"]);
    if (!isProxyImageType(type)) {
      upstream.body.destroy();
      send(res, 415, "Kein Bild");
      return;
    }
    const body = await readLimited(upstream.body, IMAGE_BYTES);
    if (!body) {
      send(res, 413, "Bild zu groß");
      return;
    }
    res.writeHead(200, {
      "content-type": type.split(";")[0]?.trim() || "application/octet-stream",
      "content-length": String(body.length),
      "cache-control": "private, max-age=3600",
      "x-content-type-options": "nosniff",
      "content-security-policy": "default-src 'none'; sandbox",
    });
    res.end(body);
    return;
  }
  send(res, 502, "Bildadresse ungültig");
}

async function readLimited(body: AsyncIterable<Uint8Array> & { destroy: () => void }, max: number) {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of body) {
    const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buf.length;
    if (size > max) {
      body.destroy();
      return null;
    }
    chunks.push(buf);
  }
  return Buffer.concat(chunks);
}

function send(res: ServerResponse, status: number, body: string) {
  if (res.headersSent) return;
  res.writeHead(status, { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" });
  res.end(body);
}

export async function handleSuiteProxy(req: IncomingMessage, res: ServerResponse): Promise<boolean> {
  const parsed = parseSuiteProxyUrl(req.url ?? "");
  if (!parsed) return false;
  const mount = suiteProxyPrefix(parsed.id);
  try {
    const session = await getSessionFromToken(cookieValue(req, SESSION_COOKIE));
    if (!session) {
      res.writeHead(302, { Location: "/login", "Cache-Control": "no-store" });
      res.end();
      return true;
    }
    if (!canUseSuite(session.user)) {
      send(res, 403, "Keine Berechtigung");
      return true;
    }
    if (parsed.bare) {
      res.writeHead(308, { Location: `${mount}/${parsed.search}`, "Cache-Control": "no-store" });
      res.end();
      return true;
    }
    const app = await findApp(parsed.id);
    if (!app) {
      send(res, 404, "App nicht gefunden");
      return true;
    }
    if (isExternalImagePath(parsed.pathname)) {
      await writeExternalImage(res, parsed.search);
      return true;
    }
    const target = upstreamTarget(app.url, stripAssetBump(parsed.pathname), parsed.search);
    if (targetsSelf(target, requestHost(req), parsed.id)) {
      send(res, 508, "Die Adresse zeigt auf Proxora selbst");
      return true;
    }
    const method = (req.method ?? "GET").toUpperCase();
    const headers = upstreamHeaders(req, target, mount, app.url, false);
    const upstream = await undiciRequest(target, {
      method,
      headers,
      body: BODYLESS.has(method) ? undefined : req,
      dispatcher: allowsInsecureTls(app.insecureTls, target.protocol) ? insecureAgent : undefined,
    });
    await writeUpstream(req, res, upstream, target, mount, publicOrigin(req));
  } catch (error) {
    logger.warn({ err: error, id: parsed.id }, "Suite proxy failed");
    send(res, 502, "Die App ist nicht erreichbar");
  }
  return true;
}

export async function handleSuiteProxyUpgrade(req: IncomingMessage, socket: Duplex, head: Buffer): Promise<boolean> {
  const parsed = parseSuiteProxyUrl(req.url ?? "");
  if (!parsed) return false;
  try {
    const session = await getSessionFromToken(cookieValue(req, SESSION_COOKIE));
    const app = session && canUseSuite(session.user) ? await findApp(parsed.id) : null;
    if (!session || !app) {
      socket.destroy();
      return true;
    }
    const mount = suiteProxyPrefix(parsed.id);
    const target = upstreamTarget(app.url, stripAssetBump(parsed.pathname), parsed.search);
    if (targetsSelf(target, requestHost(req), parsed.id)) {
      socket.destroy();
      return true;
    }
    const secure = target.protocol === "https:";
    const headers = upstreamHeaders(req, target, mount, app.url, true);
    const call = secure ? httpsRequest : httpRequest;
    const upstream = call({
      hostname: target.hostname,
      port: target.port || (secure ? 443 : 80),
      path: `${target.pathname}${target.search}`,
      method: "GET",
      headers,
      rejectUnauthorized: !allowsInsecureTls(app.insecureTls, target.protocol),
    });
    upstream.on("upgrade", (response, remote, remoteHead) => {
      const lines = [`HTTP/1.1 ${response.statusCode ?? 101} ${response.statusMessage || "Switching Protocols"}`];
      for (const [key, value] of Object.entries(response.headers)) {
        if (!value || STRIP.has(key.toLowerCase())) continue;
        const list = Array.isArray(value) ? value : [value];
        for (const item of list) lines.push(`${key}: ${item}`);
      }
      socket.write(`${lines.join("\r\n")}\r\n\r\n`);
      if (remoteHead.length > 0) socket.write(remoteHead);
      if (head.length > 0) remote.write(head);
      remote.pipe(socket);
      socket.pipe(remote);
      remote.on("error", () => socket.destroy());
      socket.on("error", () => remote.destroy());
    });
    upstream.on("error", () => socket.destroy());
    upstream.on("response", () => socket.destroy());
    upstream.end();
  } catch (error) {
    logger.warn({ err: error }, "Suite websocket proxy failed");
    socket.destroy();
  }
  return true;
}

function upstreamHeaders(
  req: IncomingMessage,
  target: URL,
  mount: string,
  appUrl: string,
  keepUpgrade: boolean,
): Record<string, string> {
  return buildUpstreamHeaders({
    headers: flatHeaders(req),
    target,
    mount,
    appUrl,
    forwardedProto: requestProto(req),
    forwardedHost: requestHost(req),
    keepUpgrade,
  });
}

async function writeUpstream(
  req: IncomingMessage,
  res: ServerResponse,
  upstream: Awaited<ReturnType<typeof undiciRequest>>,
  target: URL,
  mount: string,
  origin: string,
) {
  const contentType = headerText(upstream.headers["content-type"]);
  const kind = rewriteKind(contentType);
  const secure = requestProto(req) === "https";
  const headers: Record<string, string | string[]> = {
    "Cache-Control": "no-store",
    "content-security-policy": embedContentSecurityPolicy(origin, mount),
  };
  for (const [key, value] of Object.entries(upstream.headers)) {
    const lower = key.toLowerCase();
    if (!value || STRIP.has(lower) || lower === "set-cookie" || lower === "cache-control" || lower === "expires") continue;
    if (lower === "location") {
      const location = headerText(value);
      headers.location = rewriteLocation(location, target, mount);
      continue;
    }
    if (lower === "link") {
      headers.link = rewriteLinkHeader(headerText(value), mount);
      continue;
    }
    headers[lower] = value;
  }
  const cookies = upstream.headers["set-cookie"];
  if (cookies) {
    const list = Array.isArray(cookies) ? cookies : [cookies];
    headers["set-cookie"] = list.map((cookie) => rewriteCookie(cookie, mount, secure));
  }

  if (!kind || (req.method ?? "GET").toUpperCase() === "HEAD") {
    res.writeHead(upstream.statusCode, headers);
    if ((req.method ?? "GET").toUpperCase() === "HEAD") {
      upstream.body.destroy();
      res.end();
      return;
    }
    upstream.body.pipe(res);
    upstream.body.on("error", () => res.destroy());
    return;
  }

  const declared = Number(headerText(upstream.headers["content-length"]));
  if (Number.isFinite(declared) && declared > TEXT_LIMIT) {
    upstream.body.destroy();
    send(res, 502, "Antwort der App ist zu groß");
    return;
  }

  const payload = await readText(upstream.body);
  if (payload.length > TEXT_LIMIT) {
    send(res, 502, "Antwort der App ist zu groß");
    return;
  }
  const rewritten = rewriteEmbedBody(payload, kind, mount);
  delete headers["content-length"];
  res.writeHead(upstream.statusCode, headers);
  res.end(rewritten);
}
