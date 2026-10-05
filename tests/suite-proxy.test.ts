import { describe, expect, it } from "vitest";
import {
  buildUpstreamHeaders,
  embedContentSecurityPolicy,
  forwardCookie,
  forwardedScheme,
  parseSuiteProxyUrl,
  rewriteCookie,
  rewriteEmbedBody,
  rewriteLinkHeader,
  rewriteLocation,
  stripAssetBump,
  targetsSelf,
  upstreamTarget,
  allowsInsecureTls,
  externalImageTarget,
  isProxyImageType,
} from "@/lib/suite-proxy";

const mount = "/ora/dockora";

describe("suite proxy paths", () => {
  it("reads the app id and keeps the upstream path", () => {
    expect(parseSuiteProxyUrl("/ora/dockora/api/v1/auth/status?x=1")).toEqual({
      id: "dockora",
      pathname: "/api/v1/auth/status",
      search: "?x=1",
      bare: false,
    });
    expect(parseSuiteProxyUrl("/ora/sambora")?.bare).toBe(true);
    expect(parseSuiteProxyUrl("/stack/dockora")).toBeNull();
  });

  it("joins the saved address with the request path", () => {
    expect(upstreamTarget("http://10.0.0.8:8080/", "/api/v1/auth/status", "").toString()).toBe(
      "http://10.0.0.8:8080/api/v1/auth/status",
    );
    expect(upstreamTarget("https://10.0.0.9:8443/app/", "/login", "?next=/").toString()).toBe(
      "https://10.0.0.9:8443/app/login?next=/",
    );
  });

  it("refuses to proxy a saved address back into itself", () => {
    const loop = new URL("https://proxora.example/ora/dockora/");
    expect(targetsSelf(loop, "proxora.example", "dockora")).toBe(true);
    expect(targetsSelf(new URL("http://10.0.0.8:8080/"), "proxora.example", "dockora")).toBe(false);
  });
});

describe("suite proxy rewriting", () => {
  it("prefixes a page once and leaves concatenated api suffixes alone", () => {
    const source = 'fetch("".concat("/api/v1").concat(e));if("/auth/status"!==e);let h=[{href:"/containers"}]';
    const out = rewriteEmbedBody(source, "js", mount);
    expect(stripAssetBump("/r/_next/static/a.js")).toBe("/_next/static/a.js");
    expect(out).toContain('"/ora/dockora/api/v1"');
    expect(out).toContain('"/auth/status"');
    expect(out).not.toContain("/ora/dockora/auth");
    expect(out).toContain('href:"/ora/dockora/containers"');
    expect(out).not.toContain("/ora/dockora/ora/dockora");
  });

  it("prefixes html links and leaves markup closers intact", () => {
    const source =
      '<meta charset="utf-8"/><link href="/static/css/style.css"><form action="/login"><img src="/static/img/logo.jpg">';
    const out = rewriteEmbedBody(source, "html", "/ora/sambora");
    expect(out).toContain('charset="utf-8"/>');
    expect(out).toContain('href="/ora/sambora/r/static/css/style.css"');
    expect(out).toContain('action="/ora/sambora/login"');
    expect(out).toContain('src="/ora/sambora/r/static/img/logo.jpg"');
  });

  it("prefixes css roots and keeps relative fonts", () => {
    const source = "url(/_next/static/a.css);url(../fonts/a.woff2)";
    const out = rewriteEmbedBody(source, "css", mount);
    expect(out).toContain("url(/ora/dockora/r/_next/static/a.css)");
    expect(out).toContain("url(../fonts/a.woff2)");
  });

  it("rewrites redirects, preload links and cookie paths", () => {
    const upstream = new URL("https://10.0.0.9:8443/");
    expect(rewriteLocation("/login?next=/", upstream, "/ora/sambora")).toBe("/ora/sambora/login?next=/");
    expect(rewriteLocation("https://10.0.0.9:8443/shares", upstream, "/ora/sambora")).toBe("/ora/sambora/shares");
    expect(rewriteLocation("https://other.example/x", upstream, "/ora/sambora")).toBe("https://other.example/x");
    expect(rewriteLinkHeader("</_next/static/a.css>; rel=preload", mount)).toBe(
      "</ora/dockora/r/_next/static/a.css>; rel=preload",
    );
    expect(rewriteCookie("session=abc; Path=/; Secure; HttpOnly; SameSite=Strict", "/ora/sambora", true)).toContain(
      "Path=/ora/sambora/",
    );
    expect(forwardCookie("pm_session=secret; session=abc")).toBe("session=abc");
  });

  it("limits the embedded app to its own path and rewrites the upstream origin", () => {
    const policy = embedContentSecurityPolicy("https://proxora.example", "/ora/dockora");
    expect(policy).toContain("connect-src https://proxora.example/ora/dockora/ wss://proxora.example/ora/dockora/");
    expect(policy).toContain("img-src https://proxora.example/ora/dockora/ data: blob: https: http:");
    expect(policy).not.toContain("connect-src https://proxora.example ");
    expect(policy).toContain("frame-ancestors 'self'");
    expect(forwardedScheme("http, https")).toBe("https");
    expect(allowsInsecureTls(true, "https:")).toBe(true);
    expect(allowsInsecureTls(true, "http:")).toBe(false);
    expect(allowsInsecureTls(undefined, "https:")).toBe(false);
    const headers = buildUpstreamHeaders({
      headers: {
        origin: "https://proxora.example",
        "x-forwarded-host": "evil.example",
        host: "proxora.example",
        cookie: "pm_session=secret; dockora=abc",
        upgrade: "websocket",
        connection: "Upgrade",
        "sec-websocket-key": "abc",
      },
      target: new URL("https://10.0.0.8:8443/"),
      mount: "/ora/sambora",
      appUrl: "https://10.0.0.8:8443/",
      forwardedProto: "https",
      forwardedHost: "proxora.example",
      keepUpgrade: true,
    });
    expect(headers.origin).toBe("https://10.0.0.8:8443");
    expect(headers["x-forwarded-host"]).toBe("proxora.example");
    expect(headers["x-forwarded-proto"]).toBe("https");
    expect(headers.cookie).toBe("dockora=abc");
    expect(headers.upgrade).toBe("websocket");
    expect(headers.host).toBe("10.0.0.8:8443");
  });

  it("proxies only plain http images and installs that rewrite in html", () => {
    expect(externalImageTarget("http://192.168.178.20/icon.png")?.href).toBe("http://192.168.178.20/icon.png");
    expect(externalImageTarget("https://cdn.example/icon.png")).toBeNull();
    expect(externalImageTarget("https://cdn.example/icon.png", true)?.protocol).toBe("https:");
    expect(externalImageTarget("http://127.0.0.1/icon.png")).toBeNull();
    expect(externalImageTarget("http://169.254.169.254/latest")).toBeNull();
    expect(externalImageTarget("http://user:secret@10.0.0.8/icon.png")).toBeNull();
    expect(isProxyImageType("image/png; charset=binary")).toBe(true);
    expect(isProxyImageType("text/html")).toBe(false);
    const html = rewriteEmbedBody("<html><head><meta charset=\"utf-8\"/></head><body></body></html>", "html", mount);
    expect(html.indexOf("<script>")).toBeLessThan(html.indexOf("</head>"));
    expect(html).toContain('m="/ora/dockora"');
    expect(html).toContain("/ext-img?u=");
  });
});
