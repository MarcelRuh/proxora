import { parseProxoraAndroidVersion } from "@/lib/android-apk";
import { parseProxoraDesktopVersion } from "@/lib/desktop-shell";

export type ProxoraDesktopBridge = {
  version?: string;
  openExternal?: (url: string) => void;
};

declare global {
  interface Window {
    ProxoraDesktop?: ProxoraDesktopBridge;
  }
}

/** True when running inside the Android or Desktop Proxora shell. */
export function isProxoraAppShell(): boolean {
  if (typeof window === "undefined") return false;
  if (window.ProxoraAndroid || window.ProxoraDesktop) return true;
  const ua = typeof navigator !== "undefined" ? navigator.userAgent : "";
  return Boolean(parseProxoraAndroidVersion(ua) || parseProxoraDesktopVersion(ua));
}

/** True when the shell can open https links without navigating the Proxora UI away. */
export function canOpenExternalNatively(): boolean {
  if (typeof window === "undefined") return false;
  if (typeof window.ProxoraAndroid?.openExternal === "function") return true;
  if (typeof window.ProxoraDesktop?.openExternal === "function") return true;
  // Desktop/Android intercept main-frame navigation to foreign hosts.
  return isProxoraAppShell();
}

/**
 * Open an external https URL.
 * Prefers native bridges; otherwise uses main-frame navigation so Android/Tauri
 * can intercept and open the system browser (or a normal browser navigates there).
 */
export function openExternalUrl(url: string): boolean {
  if (typeof window === "undefined") return false;
  const trimmed = url.trim();
  if (!trimmed) return false;

  try {
    const android = window.ProxoraAndroid;
    if (android && typeof android.openExternal === "function") {
      android.openExternal(trimmed);
      return true;
    }
    const desktop = window.ProxoraDesktop;
    if (desktop && typeof desktop.openExternal === "function") {
      desktop.openExternal(trimmed);
      return true;
    }
  } catch {
    /* fall through */
  }

  try {
    window.location.assign(trimmed);
    return true;
  } catch {
    return false;
  }
}
