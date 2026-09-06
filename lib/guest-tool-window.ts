export type GuestTool = "console" | "files";

export const PROXORA_ANDROID_UA = "ProxoraAndroid";

export function guestToolBase(kind: "vm" | "lxc"): "vms" | "containers" {
  return kind === "vm" ? "vms" : "containers";
}

export function guestToolPath(input: {
  kind: "vm" | "lxc";
  hostId: string;
  node: string;
  vmid: number | string;
  tool: GuestTool;
}): string {
  const base = guestToolBase(input.kind);
  return `/${base}/${encodeURIComponent(input.hostId)}/${encodeURIComponent(input.node)}/${encodeURIComponent(String(input.vmid))}/${input.tool}`;
}

export function guestToolWindowName(input: {
  kind: "vm" | "lxc";
  hostId: string;
  vmid: number | string;
  tool: GuestTool;
}): string {
  const raw = `proxora_${input.kind}_${input.hostId}_${input.vmid}_${input.tool}`;
  return raw.replace(/[^A-Za-z0-9_]/g, "_").slice(0, 80);
}

export function guestToolWindowSize(tool: GuestTool): { width: number; height: number } {
  return tool === "console" ? { width: 1020, height: 720 } : { width: 1100, height: 760 };
}

export function guestToolWindowFeatures(
  tool: GuestTool,
  screen?: { screenX: number; screenY: number; outerWidth: number; outerHeight: number },
): string {
  const { width, height } = guestToolWindowSize(tool);
  const left = screen ? Math.round(Math.max(0, screen.screenX + (screen.outerWidth - width) / 2)) : 80;
  const top = screen ? Math.round(Math.max(0, screen.screenY + (screen.outerHeight - height) / 2)) : 60;
  return `popup=yes,width=${width},height=${height},left=${left},top=${top},menubar=no,toolbar=no,location=no,status=no,scrollbars=yes,resizable=yes`;
}

/** Android app and small screens cannot host a real popup; stay in the same WebView. */
export function shouldOpenGuestToolInPlace(
  userAgent = typeof navigator === "undefined" ? "" : navigator.userAgent,
  innerWidth = typeof window === "undefined" ? 1200 : window.innerWidth,
): boolean {
  if (userAgent.includes(PROXORA_ANDROID_UA)) return true;
  return innerWidth < 768;
}

/** Opens (or focuses) a small tool window. Falls back to same-tab navigation if popups are blocked. */
export function openGuestToolWindow(input: {
  kind: "vm" | "lxc";
  hostId: string;
  node: string;
  vmid: number | string;
  tool: GuestTool;
}): Window | null {
  const url = guestToolPath(input);
  if (shouldOpenGuestToolInPlace()) {
    window.location.assign(url);
    return null;
  }
  const name = guestToolWindowName(input);
  const win = window.open(url, name, guestToolWindowFeatures(input.tool, window));
  if (!win) {
    window.location.assign(url);
    return null;
  }
  win.focus();
  return win;
}
