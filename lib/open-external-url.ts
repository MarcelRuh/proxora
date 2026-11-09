/** Open https links outside Proxora (system browser on Android, new tab on desktop). */
export function openExternalUrl(url: string): void {
  if (typeof window === "undefined") return;
  const trimmed = url.trim();
  if (!trimmed) return;

  const bridge = window.ProxoraAndroid;
  if (bridge && typeof bridge.openExternal === "function") {
    try {
      bridge.openExternal(trimmed);
      return;
    } catch {
      /* fall through to DOM navigation */
    }
  }

  // Prefer a real <a> click over window.open: Android WebView often creates a blank
  // multi-window popup for window.open(..., "noopener"), especially inside dialogs.
  const anchor = document.createElement("a");
  anchor.href = trimmed;
  anchor.target = "_blank";
  anchor.rel = "noopener noreferrer";
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
}
