import { parseProxoraAndroidVersion } from "@/lib/android-apk";
import { parseProxoraDesktopVersion } from "@/lib/desktop-shell";
import { canOpenExternalNatively, isProxoraAppShell } from "@/lib/open-external-url";

export type AppShellKind = "android" | "desktop" | "browser";

export function detectAppShellKind(ua = typeof navigator !== "undefined" ? navigator.userAgent : ""): AppShellKind {
  if (parseProxoraAndroidVersion(ua) || (typeof window !== "undefined" && window.ProxoraAndroid)) {
    return "android";
  }
  if (parseProxoraDesktopVersion(ua) || (typeof window !== "undefined" && window.ProxoraDesktop)) {
    return "desktop";
  }
  return "browser";
}

/** Old Android APKs expose ProxoraAndroid without openExternal. */
export function androidShellNeedsUpdate(): boolean {
  if (typeof window === "undefined") return false;
  const version = parseProxoraAndroidVersion(navigator.userAgent);
  if (!version) return false;
  if (!window.ProxoraAndroid) return true;
  return typeof window.ProxoraAndroid.openExternal !== "function";
}

export function shellExternalOpenReady(): boolean {
  if (!isProxoraAppShell()) return true;
  return canOpenExternalNatively();
}
