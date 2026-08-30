import { describe, expect, it } from "vitest";
import {
  clipboardCharsToKeysyms,
  disableQemuExtendedKeys,
  isBrowserChromeKey,
  isClipboardPasteKey,
  isDomTextField,
  rfbKeysymFromKeyboardEvent,
  sendClipboardAsKeys,
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

  it("types clipboard text as RFB keys after releasing modifiers", () => {
    expect(isClipboardPasteKey({ key: "v", ctrlKey: true, metaKey: false })).toBe(true);
    expect(isClipboardPasteKey({ key: "v", ctrlKey: false, metaKey: true })).toBe(true);
    expect(isClipboardPasteKey({ key: "v", ctrlKey: true, metaKey: false, shiftKey: true })).toBe(false);
    expect(clipboardCharsToKeysyms("ab\n\tc").keysyms).toEqual([0x61, 0x62, 0xff0d, 0xff09, 0x63]);
    expect(clipboardCharsToKeysyms("ä").keysyms).toEqual([0xe4]);
    const sent: Array<[number, string | null, boolean]> = [];
    const { truncated } = sendClipboardAsKeys((keysym, code, down) => sent.push([keysym, code, down]), "Hi");
    expect(truncated).toBe(false);
    expect(sent[0]).toEqual([0xffe3, "ControlLeft", false]);
    expect(sent.slice(-4)).toEqual([
      [0x48, null, true],
      [0x48, null, false],
      [0x69, null, true],
      [0x69, null, false],
    ]);
  });

  it("ignores QEMU advertising extended key events", () => {
    const rfb: { _qemuExtKeyEventSupported: boolean } = { _qemuExtKeyEventSupported: true };
    disableQemuExtendedKeys(rfb);
    rfb._qemuExtKeyEventSupported = true;
    expect(rfb._qemuExtKeyEventSupported).toBe(false);
  });
});
