const ID = "([a-z0-9](?:[a-z0-9-]{0,38}[a-z0-9])?)";
const PROXY_PATH = new RegExp(`^/ora/${ID}(/.*)?$`);

const ROOTS = ["/_next/", "/api/", "/static/", "/assets/", "/favicon", "/icon-"];

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
  return out;
}

export function rewriteLocation(location: string, upstream: URL, mount: string): string {
  if (location.startsWith("/") && !location.startsWith("//")) {
    if (location === mount || location.startsWith(`${mount}/`) || location.startsWith(`${mount}?`)) return location;
    return `${mount}${location}`;
  }
  try {
    const absolute = new URL(location, upstream);
    if (absolute.origin !== upstream.origin) return location;
    const path = `${absolute.pathname}${absolute.search}${absolute.hash}`;
    if (path === mount || path.startsWith(`${mount}/`)) return path;
    return `${mount}${path.startsWith("/") ? path : `/${path}`}`;
  } catch {
    return location;
  }
}

export function rewriteLinkHeader(value: string, mount: string): string {
  return value.replace(/<(\/(?!\/)[^>]*)>/g, (full, path: string) => {
    if (path === mount || path.startsWith(`${mount}/`)) return full;
    return `<${mount}${path}>`;
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
      return `${name}=${quote}${mount}${path}${quote}`;
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
  for (const root of ROOTS) {
    out = spliceOnce(out, `"${root}`, `"${mount}${root}`);
    out = spliceOnce(out, `'${root}`, `'${mount}${root}`);
    out = spliceOnce(out, `\\"${root}`, `\\"${mount}${root}`);
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
    return `url(${quote}${mount}${path}`;
  });
}
