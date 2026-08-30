import { describe, expect, it } from "vitest";
import {
  disableQemuExtendedKeys,
  isBrowserChromeKey,
  isDomTextField,
  rfbKeysymFromKeyboardEvent,
  shouldCaptureConsoleKey,
} from "@/lib/vnc-input";

describe("vnc input helpers", () => {
  it("returns false without a DOM node", () => {
    expect(isDomTextField(null)).toBe(false);
  });

  it("maps Space, Enter and letters to RFB keysyms", () => {
    expect(rfbKeysymFromKeyboardEvent({ key: " ", code: "Space" })).toBe(0x0020);
    expect(rfbKeysymFromKeyboardEvent({ key: "Enter" })).toBe(0xff0d);
    expect(rfbKeysymFromKeyboardEvent({ key: "a" })).toBe(0x61);
    expect(rfbKeysymFromKeyboardEvent({ key: "A" })).toBe(0x41);
    expect(rfbKeysymFromKeyboardEvent({ key: "ä" })).toBe(0xe4);
  });

  it("captures Space for the guest and leaves F5 to the browser", () => {
    const space = { key: " ", ctrlKey: false, metaKey: false, target: null };
    expect(shouldCaptureConsoleKey(space, true)).toBe(true);
    expect(shouldCaptureConsoleKey(space, false)).toBe(false);
    expect(isBrowserChromeKey({ key: "F5", ctrlKey: false, metaKey: false })).toBe(true);
    expect(shouldCaptureConsoleKey({ key: "F5", ctrlKey: false, metaKey: false, target: null }, true)).toBe(false);
  });

  it("ignores QEMU advertising extended key events", () => {
    const rfb: { _qemuExtKeyEventSupported: boolean } = { _qemuExtKeyEventSupported: true };
    disableQemuExtendedKeys(rfb);
    rfb._qemuExtKeyEventSupported = true;
    expect(rfb._qemuExtKeyEventSupported).toBe(false);
  });
});
