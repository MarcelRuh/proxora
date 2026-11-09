import { describe, expect, it } from "vitest";
import { desktopUpdateAvailable, parseProxoraDesktopVersion } from "@/lib/desktop-shell";

describe("desktop shell helpers", () => {
  it("reads the desktop version from the WebView user agent", () => {
    expect(parseProxoraDesktopVersion("Mozilla/5.0 ProxoraDesktop/2.4.18")).toBe("2.4.18");
    expect(parseProxoraDesktopVersion("Mozilla/5.0 Chrome/120")).toBeNull();
  });

  it("only offers an update when GitHub is newer", () => {
    expect(desktopUpdateAvailable("2.4.17", "2.4.18")).toBe(true);
    expect(desktopUpdateAvailable("2.4.18", "2.4.18")).toBe(false);
    expect(desktopUpdateAvailable("2.4.18", "2.4.17")).toBe(false);
  });
});
