const ID = "([a-z0-9](?:[a-z0-9-]{0,38}[a-z0-9])?)";
const PROXY_PATH = new RegExp(`^/ora/${ID}(/.*)?$`);

const STATIC_ROOTS = ["/_next/", "/static/", "/assets/", "/favicon", "/icon-"];
const API_ROOTS = ["/api/"];

export type SuiteProxyTarget = {
  id: string;
  pathname: string;
  search: string;
  bare: boolean;
};

export type RewriteKind = "html" | "css" | "js";

export function suiteProxyPrefix(id: string): string {
  return `/ora/${id}`;
}

export function suiteAssetPath(mount: string, path: string): string {
  if (STATIC_ROOTS.some((root) => path.startsWith(root))) return `${mount}/r${path}`;
  return `${mount}${path}`;
}

export function stripAssetBump(pathname: string): string {
  if (pathname === "/r") return "/";
  if (pathname.startsWith("/r/")) return pathname.slice(2);
  return pathname;
}

export function parseSuiteProxyUrl(raw: string): SuiteProxyTarget | null {
  const queryAt = raw.indexOf("?");
  const path = (queryAt >= 0 ? raw.slice(0, queryAt) : raw).split("#")[0] ?? "";
  const search = queryAt >= 0 ? raw.slice(queryAt) : "";
  const match = PROXY_PATH.exec(path);
  const id = match?.[1];
  if (!id) return null;
  const extra = match[2];
  return {
    id,
    pathname: extra && extra.length > 0 ? extra : "/",
    search,
    bare: !extra,
  };
}

export function upstreamTarget(base: string, pathname: string, search: string): URL {
  const root = new URL(base);
  const basePath = root.pathname.replace(/\/+$/, "");
  const suffix = pathname === "/" ? "" : pathname;
  const joined = `${basePath}${suffix}`;
  root.pathname = joined === "" ? "/" : joined;
  root.search = search;
  root.hash = "";
  return root;
}

export function rewriteKind(contentType: string | null): RewriteKind | null {
  if (!contentType) return null;
  const value = contentType.toLowerCase();
  if (value.includes("text/event-stream") || value.includes("multipart/")) return null;
  if (value.includes("text/html")) return "html";
  if (value.includes("text/css")) return "css";
  if (value.includes("javascript") || value.includes("ecmascript")) return "js";
  return null;
}

export function rewriteEmbedBody(body: string, kind: RewriteKind, mount: string): string {
  let out = kind === "html" ? rewriteHtmlAttributes(body, mount) : body;
  if (kind === "html" || kind === "js") out = rewriteJsHrefs(out, mount);
  out = rewriteRoots(out, mount);
  if (kind === "html" || kind === "css" || kind === "js") out = rewriteCssUrls(out, mount);
  if (kind === "html") out = injectImageProxy(out, mount);
  return out;
}

export function isExternalImagePath(pathname: string): boolean {
  return pathname === "/ext-img" || pathname === "/ext-img/";
}

export function externalImageTarget(raw: string, allowHttps = false): URL | null {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (url.protocol !== "http:" && !(allowHttps && url.protocol === "https:")) return null;
  if (url.username || url.password) return null;
  if (isBlockedImageHost(url.hostname)) return null;
  url.hash = "";
  return url;
}

export function isProxyImageType(contentType: string): boolean {
  const type = contentType.split(";")[0]?.trim().toLowerCase() ?? "";
  return (
    type === "image/png" ||
    type === "image/jpeg" ||
    type === "image/gif" ||
    type === "image/webp" ||
    type === "image/avif" ||
    type === "image/bmp" ||
    type === "image/x-icon" ||
    type === "image/vnd.microsoft.icon" ||
    type === "image/svg+xml"
  );
}

function injectImageProxy(html: string, mount: string): string {
  const tag = imageProxyBootstrap(mount);
  const head = /<head[^>]*>/i.exec(html);
  if (!head || head.index == null) return tag + html;
  const at = head.index + head[0].length;
  return html.slice(0, at) + tag + html.slice(at);
}

function imageProxyBootstrap(mount: string): string {
  const prefix = JSON.stringify(mount);
  return `<script>(function(){var m=${prefix};function r(v){if(typeof v!=="string"||v.slice(0,5)!=="http:")return v;try{var u=new URL(v);if(u.protocol!=="http:"||u.username||u.password)return v;return m+"/ext-img?u="+encodeURIComponent(u.href)}catch(e){return v}}var d=Object.getOwnPropertyDescriptor(HTMLImageElement.prototype,"src");if(d&&d.set&&d.get){var set=d.set;Object.defineProperty(HTMLImageElement.prototype,"src",{configurable:!0,enumerable:d.enumerable,get:d.get,set:function(v){set.call(this,r(String(v)))}})}var raw=Element.prototype.setAttribute;Element.prototype.setAttribute=function(n,v){if(this.tagName==="IMG"&&String(n).toLowerCase()==="src")v=r(String(v));return raw.call(this,n,v)}})()</script>`;
}

function isBlockedImageHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (host === "localhost" || host.endsWith(".localhost") || host === "0.0.0.0" || host === "::1") return true;
  if (host === "metadata.google.internal") return true;
  const parts = host.split(".").map((part) => Number(part));
  if (parts.length === 4 && parts.every((part) => Number.isInteger(part) && part >= 0 && part <= 255)) {
    const a = parts[0] ?? 0;
    const b = parts[1] ?? 0;
    if (a === 0 || a === 127 || a >= 224) return true;
    if (a === 169 && b === 254) return true;
  }
  return false;
}

export function rewriteLocation(location: string, upstream: URL, mount: string): string {
  if (location.startsWith("/") && !location.startsWith("//")) {
    if (location === mount || location.startsWith(`${mount}/`) || location.startsWith(`${mount}?`)) return location;
    return suiteAssetPath(mount, location);
  }
  try {
    const absolute = new URL(location, upstream);
    if (absolute.origin !== upstream.origin) return location;
    const path = `${absolute.pathname}${absolute.search}${absolute.hash}`;
    if (path === mount || path.startsWith(`${mount}/`)) return path;
    return suiteAssetPath(mount, path);
  } catch {
    return location;
  }
}

export function rewriteLinkHeader(value: string, mount: string): string {
  return value.replace(/<(\/(?!\/)[^>]*)>/g, (full, path: string) => {
    if (path === mount || path.startsWith(`${mount}/`)) return full;
    return `<${suiteAssetPath(mount, path)}>`;
  });
}

export function rewriteCookie(cookie: string, mount: string, secure: boolean): string {
  let out = cookie.replace(/;\s*Domain=[^;]*/gi, "");
  if (/;\s*Path=/i.test(out)) {
    out = out.replace(/;\s*Path=\s*([^;]*)/i, (_match, raw: string) => {
      const path = raw.trim() || "/";
      if (path === mount || path.startsWith(`${mount}/`)) return `; Path=${path}`;
      if (path === "/") return `; Path=${mount}/`;
      if (path.startsWith("/")) return `; Path=${mount}${path}`;
      return `; Path=${mount}/${path}`;
    });
  } else {
    out += `; Path=${mount}/`;
  }
  if (secure && !/;\s*Secure\b/i.test(out)) out += "; Secure";
  return out;
}

export function forwardCookie(header: string | undefined): string | undefined {
  if (!header) return undefined;
  const kept = header
    .split(";")
    .map((part) => part.trim())
    .filter((part) => part.length > 0 && !/^pm_session=/i.test(part));
  return kept.length > 0 ? kept.join("; ") : undefined;
}

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

export function forwardedHost(hostHeader: string | undefined): string {
  return (hostHeader ?? "").split(",")[0]?.trim() ?? "";
}

export function forwardedScheme(protoHeader: string | undefined): "http" | "https" {
  const parts = (protoHeader ?? "")
    .split(",")
    .map((part) => part.trim().toLowerCase())
    .filter((part): part is "http" | "https" => part === "http" || part === "https");
  return parts.at(-1) ?? "http";
}

export function allowsInsecureTls(insecureTls: boolean | undefined, protocol: string): boolean {
  return protocol === "https:" && insecureTls === true;
}

export function embedContentSecurityPolicy(origin: string, mount: string): string {
  const base = origin.replace(/\/$/, "");
  const root = `${base}${mount}/`;
  const wsBase = base.startsWith("https://") ? `wss://${base.slice("https://".length)}` : `ws://${base.slice("http://".length)}`;
  const ws = `${wsBase}${mount}/`;
  return [
    "default-src 'none'",
    "base-uri 'none'",
    `form-action ${root}`,
    `connect-src ${root} ${ws}`,
    `script-src ${root} 'unsafe-inline' 'unsafe-eval'`,
    `style-src ${root} 'unsafe-inline'`,
    `img-src ${root} data: blob: https: http:`,
    `font-src ${root} data:`,
    `media-src ${root} blob:`,
    "worker-src blob:",
    `frame-src ${root}`,
    "frame-ancestors 'self'",
    "object-src 'none'",
  ].join("; ");
}

export function buildUpstreamHeaders(input: {
  headers: Record<string, string | undefined>;
  target: URL;
  mount: string;
  appUrl: string;
  forwardedProto: string;
  forwardedHost: string;
  keepUpgrade?: boolean;
}): Record<string, string> {
  const headers: Record<string, string> = {};
  const cookie = headerOf(input.headers, "cookie");
  const referer = headerOf(input.headers, "referer");
  for (const [key, value] of Object.entries(input.headers)) {
    if (!value) continue;
    const lower = key.toLowerCase();
    if (lower === "cookie" || lower === "origin" || lower === "referer") continue;
    if (lower === "x-forwarded-host" || lower === "x-forwarded-proto") continue;
    if (HOP.has(lower) && (!input.keepUpgrade || (lower !== "connection" && lower !== "upgrade"))) continue;
    headers[lower] = value;
  }
  headers.host = input.target.host;
  if (!input.keepUpgrade) headers["accept-encoding"] = "identity";
  headers.origin = input.target.origin;
  const forwarded = forwardCookie(cookie);
  if (forwarded) headers.cookie = forwarded;
  const nextReferer = rewriteReferer(referer ?? "", input.mount, input.appUrl);
  if (nextReferer) headers.referer = nextReferer;
  headers["x-forwarded-proto"] = input.forwardedProto === "https" ? "https" : "http";
  headers["x-forwarded-host"] = input.forwardedHost;
  return headers;
}

function headerOf(headers: Record<string, string | undefined>, name: string): string | undefined {
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() === name) return value;
  }
  return undefined;
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

export function targetsSelf(target: URL, requestHost: string, id: string): boolean {
  const host = requestHost.split(",")[0]?.trim().split(":")[0]?.toLowerCase() ?? "";
  if (!host || target.hostname.toLowerCase() !== host) return false;
  const mount = suiteProxyPrefix(id);
  return target.pathname === mount || target.pathname.startsWith(`${mount}/`);
}

function rewriteHtmlAttributes(body: string, mount: string): string {
  return body.replace(
    /\b(href|src|action|poster|formaction|data-src)\s*=\s*(["'])(\/(?!\/)[^"']*)\2/gi,
    (full, name: string, quote: string, path: string) => {
      if (path === mount || path.startsWith(`${mount}/`) || path.startsWith(`${mount}?`)) return full;
      return `${name}=${quote}${suiteAssetPath(mount, path)}${quote}`;
    },
  );
}

function rewriteJsHrefs(body: string, mount: string): string {
  const token = 'href:"/';
  const already = mount.slice(1);
  let out = "";
  let cursor = 0;
  while (cursor < body.length) {
    const at = body.indexOf(token, cursor);
    if (at < 0) {
      out += body.slice(cursor);
      break;
    }
    const rest = body.slice(at + token.length);
    out += body.slice(cursor, at);
    if (rest.startsWith("/") || rest.startsWith(already)) {
      out += token;
    } else {
      out += `href:"${mount}/`;
    }
    cursor = at + token.length;
  }
  return out;
}

function rewriteRoots(body: string, mount: string): string {
  let out = body;
  for (const root of [...STATIC_ROOTS, ...API_ROOTS]) {
    const next = suiteAssetPath(mount, root);
    out = spliceOnce(out, `"${root}`, `"${next}`);
    out = spliceOnce(out, `'${root}`, `'${next}`);
    out = spliceOnce(out, `\\"${root}`, `\\"${next}`);
  }
  return out;
}

function spliceOnce(body: string, token: string, replacement: string): string {
  if (!body.includes(token) || token === replacement) return body;
  return body.split(token).join(replacement);
}

function rewriteCssUrls(body: string, mount: string): string {
  return body.replace(/url\(\s*(['"]?)(\/(?!\/)[^)'"]*)/g, (full, quote: string, path: string) => {
    if (path === mount || path.startsWith(`${mount}/`)) return full;
    return `url(${quote}${suiteAssetPath(mount, path)}`;
  });
}
