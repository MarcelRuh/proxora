import { describe, expect, it } from "vitest";
import {
  desktopUpdateAvailable,
  isProxoraDesktopClient,
  parseProxoraDesktopVersion,
} from "@/lib/desktop-shell";

describe("desktop shell helpers", () => {
  it("reads the desktop version from the WebView user agent", () => {
    expect(parseProxoraDesktopVersion("Mozilla/5.0 ProxoraDesktop/2.5.1")).toBe("2.5.1");
    expect(parseProxoraDesktopVersion("Mozilla/5.0 Chrome/120")).toBeNull();
  });

  it("detects the desktop client via UA or chrome marker", () => {
    expect(isProxoraDesktopClient()).toBe(false);
  });

  it("only offers an update when GitHub is newer", () => {
    expect(desktopUpdateAvailable("2.4.19", "2.5.1")).toBe(true);
    expect(desktopUpdateAvailable("2.5.1", "2.5.1")).toBe(false);
    expect(desktopUpdateAvailable("2.5.1", "2.4.19")).toBe(false);
  });
});
