/**
 * Open an external https URL.
 *
 * Android/Desktop WebView shells block window.open and synthetic <a>.click().
 * Main-frame navigation is intercepted there and opened in the system browser
 * (Proxora stays put). In a normal browser this navigates to the site.
 */
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
      /* fall through */
    }
  }

  window.location.assign(trimmed);
}
