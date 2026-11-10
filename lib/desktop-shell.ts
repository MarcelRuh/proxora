import { compareSemver } from "@/lib/version";

export const PROXORA_DESKTOP_UA = "ProxoraDesktop";

export function parseProxoraDesktopVersion(ua: string): string | null {
  const match = /ProxoraDesktop\/(\d+\.\d+\.\d+)/i.exec(ua);
  return match?.[1] ?? null;
}

/** True inside the Tauri Proxora desktop WebView (custom chrome / UA bridge). */
export function isProxoraDesktopClient(): boolean {
  if (typeof window === "undefined") return false;
  if (window.ProxoraDesktop) return true;
  if (typeof document !== "undefined" && document.documentElement.hasAttribute("data-desktop-chrome")) {
    return true;
  }
  const ua = typeof navigator !== "undefined" ? navigator.userAgent : "";
  return Boolean(parseProxoraDesktopVersion(ua));
}

export function desktopUpdateAvailable(current: string, latest: string | null | undefined): boolean {
  if (!current || !latest) return false;
  return compareSemver(latest, current) > 0;
}
