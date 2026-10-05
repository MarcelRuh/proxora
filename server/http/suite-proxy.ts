import type { IncomingMessage, ServerResponse } from "node:http";
import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import type { Duplex } from "node:stream";
import { text as readText } from "node:stream/consumers";
import { Agent, request as undiciRequest } from "undici";
import { SESSION_COOKIE } from "@/lib/env";
import { logger } from "@/lib/logger";
import {
  forwardCookie,
  parseSuiteProxyUrl,
  rewriteCookie,
  rewriteEmbedBody,
  rewriteKind,
  rewriteLinkHeader,
  rewriteLocation,
  suiteProxyPrefix,
  targetsSelf,
  upstreamTarget,
} from "@/lib/suite-proxy";
import { getSessionFromToken } from "@/server/auth/session-core";
import { loadSuiteEmbeds } from "@/server/services/suite-embeds";

const insecureAgent = new Agent({
  connect: { rejectUnauthorized: false },
  headersTimeout: 60_000,
  bodyTimeout: 0,
});

const HOP = new Set([
  "host",
  "connection",
  "keep-alive",
  "transfer-encoding",
  "upgrade",
  "proxy-connection",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailer",
  "content-length",
]);

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
  return headerText(req.headers["x-forwarded-host"] || req.headers.host).split(",")[0]?.trim() ?? "";
}

function requestProto(req: IncomingMessage): string {
  const forwarded = headerText(req.headers["x-forwarded-proto"]).split(",")[0]?.trim();
  if (forwarded) return forwarded;
  return "http";
}

async function findApp(id: string) {
  const now = Date.now();
  if (!embedCache || now - embedCache.at > 2000) {
    embedCache = { at: now, apps: (await loadSuiteEmbeds()).apps };
  }
  return embedCache.apps.find((app) => app.id === id) ?? null;
}

function rewriteReferer(referer: string, mount: string, base: string): string | undefined {
  if (!referer) return undefined;
  try {
    const url = new URL(referer);
    if (url.pathname !== mount && !url.pathname.startsWith(`${mount}/`)) return undefined;
    const rest = url.pathname.slice(mount.length) || "/";
    return upstreamTarget(base, rest, url.search).toString();
  } catch {
    return undefined;
  }
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
    const target = upstreamTarget(app.url, parsed.pathname, parsed.search);
    if (targetsSelf(target, requestHost(req), parsed.id)) {
      send(res, 508, "Die Adresse zeigt auf Proxora selbst");
      return true;
    }
    const method = (req.method ?? "GET").toUpperCase();
    const headers = upstreamHeaders(req, target, mount, app.url);
    const upstream = await undiciRequest(target, {
      method,
      headers,
      body: BODYLESS.has(method) ? undefined : req,
      dispatcher: target.protocol === "https:" ? insecureAgent : undefined,
    });
    await writeUpstream(req, res, upstream, target, mount);
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
    const app = session ? await findApp(parsed.id) : null;
    if (!session || !app) {
      socket.destroy();
      return true;
    }
    const target = upstreamTarget(app.url, parsed.pathname, parsed.search);
    if (targetsSelf(target, requestHost(req), parsed.id)) {
      socket.destroy();
      return true;
    }
    const secure = target.protocol === "https:";
    const headers: Record<string, string | string[] | undefined> = { ...req.headers, host: target.host };
    const cookie = forwardCookie(headerText(req.headers.cookie) || undefined);
    if (cookie) headers.cookie = cookie;
    else delete headers.cookie;
    const call = secure ? httpsRequest : httpRequest;
    const upstream = call({
      hostname: target.hostname,
      port: target.port || (secure ? 443 : 80),
      path: `${target.pathname}${target.search}`,
      method: "GET",
      headers,
      rejectUnauthorized: false,
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

function upstreamHeaders(req: IncomingMessage, target: URL, mount: string, appUrl: string): Record<string, string> {
  const headers: Record<string, string> = {};
  for (const [key, value] of Object.entries(req.headers)) {
    if (!value || HOP.has(key.toLowerCase())) continue;
    if (key.toLowerCase() === "cookie" || key.toLowerCase() === "origin" || key.toLowerCase() === "referer") continue;
    headers[key] = headerText(value);
  }
  headers.host = target.host;
  headers["accept-encoding"] = "identity";
  headers.origin = target.origin;
  const cookie = forwardCookie(headerText(req.headers.cookie) || undefined);
  if (cookie) headers.cookie = cookie;
  const referer = rewriteReferer(headerText(req.headers.referer), mount, appUrl);
  if (referer) headers.referer = referer;
  headers["x-forwarded-proto"] = requestProto(req);
  headers["x-forwarded-host"] = requestHost(req);
  return headers;
}

async function writeUpstream(
  req: IncomingMessage,
  res: ServerResponse,
  upstream: Awaited<ReturnType<typeof undiciRequest>>,
  target: URL,
  mount: string,
) {
  const contentType = headerText(upstream.headers["content-type"]);
  const kind = rewriteKind(contentType);
  const secure = requestProto(req) === "https";
  const headers: Record<string, string | string[]> = { "Cache-Control": "no-store" };
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

  const payload = await readText(upstream.body);
  const rewritten = payload.length > TEXT_LIMIT ? payload : rewriteEmbedBody(payload, kind, mount);
  delete headers["content-length"];
  res.writeHead(upstream.statusCode, headers);
  res.end(rewritten);
}
