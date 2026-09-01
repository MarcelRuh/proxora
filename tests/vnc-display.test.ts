import { describe, expect, it } from "vitest";
import { applyVncView, parseVncView, vncViewSettings } from "@/lib/vnc-display";

describe("vnc display", () => {
  it("falls back to fit and maps remote presets to resizeSession", () => {
    expect(parseVncView(null)).toBe("fit");
    expect(parseVncView("nope")).toBe("fit");
    expect(vncViewSettings("fit")).toEqual({ scaleViewport: true, resizeSession: false, clipViewport: false });
    expect(vncViewSettings("native")).toEqual({ scaleViewport: false, resizeSession: false, clipViewport: true });
    expect(vncViewSettings("1920x1080")).toMatchObject({
      scaleViewport: false,
      resizeSession: true,
      width: 1920,
      height: 1080,
    });
  });

  it("writes the requested size onto the screen element", () => {
    const rfb = { scaleViewport: true, resizeSession: false, clipViewport: false };
    const screen = { style: { width: "", height: "" }, dataset: {} as Record<string, string> };
    applyVncView(rfb, screen as unknown as HTMLElement, "1280x720");
    expect(rfb.resizeSession).toBe(true);
    expect(screen.style.width).toBe("1280px");
    expect(screen.style.height).toBe("720px");
    expect(screen.dataset.view).toBe("1280x720");
    applyVncView(rfb, screen as unknown as HTMLElement, "fit");
    expect(rfb.scaleViewport).toBe(true);
    expect(screen.style.width).toBe("");
  });
});
