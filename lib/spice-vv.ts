export type SpiceProxyResult = {
  type?: string;
  host?: string;
  port?: number | string;
  "tls-port"?: number | string;
  password?: string;
  proxy?: string;
  title?: string;
  ca?: string;
  host_subject?: string;
  "delete-this-proxy"?: number | string;
};

export function spiceViewerFile(proxy: SpiceProxyResult, fallbackHost: string): string {
  const host = String(proxy.host ?? fallbackHost).replace(/^https?:\/\//i, "").split("/")[0] ?? fallbackHost;
  const lines = [
    "[virt-viewer]",
    `type=${proxy.type || "spice"}`,
    `host=${host}`,
  ];
  if (proxy.port != null && String(proxy.port) !== "") lines.push(`port=${proxy.port}`);
  if (proxy["tls-port"] != null && String(proxy["tls-port"]) !== "") lines.push(`tls-port=${proxy["tls-port"]}`);
  if (proxy.password) lines.push(`password=${proxy.password}`);
  if (proxy.proxy) lines.push(`proxy=${proxy.proxy}`);
  if (proxy.title) lines.push(`title=${proxy.title}`);
  if (proxy.host_subject) lines.push(`host-subject=${proxy.host_subject}`);
  if (proxy.ca) lines.push(`ca=${String(proxy.ca).replaceAll("\n", "\\n")}`);
  lines.push("toggle-fullscreen=shift+f11");
  lines.push("release-cursor=ctrl+alt+r");
  lines.push("secure-attention=ctrl+alt+end");
  return `${lines.join("\n")}\n`;
}

export function hostNameFromUrl(url: string): string {
  try {
    return new URL(url.includes("://") ? url : `https://${url}`).hostname;
  } catch {
    return url.replace(/^https?:\/\//i, "").split("/")[0] ?? url;
  }
}
