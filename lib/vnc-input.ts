/** Form fields and dialogs must keep the browser keyboard. */
export function isDomTextField(target: EventTarget | null): boolean {
  if (target == null || typeof HTMLElement === "undefined") return false;
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;
  if (target.isContentEditable) return true;
  return Boolean(target.closest('[role="dialog"]'));
}

/** Let the browser keep reload/devtools/new-tab shortcuts. */
export function isBrowserChromeKey(e: { key: string; ctrlKey: boolean; metaKey: boolean }): boolean {
  if (e.key === "F5" || e.key === "F12" || e.key === "F11") return true;
  if (!(e.ctrlKey || e.metaKey)) return false;
  return ["r", "w", "t", "n", "l"].includes(e.key.toLowerCase());
}

/** Host clipboard paste into the VGA guest (Ctrl/Cmd+V). */
export function isClipboardPasteKey(e: {
  key: string;
  ctrlKey: boolean;
  metaKey: boolean;
  altKey?: boolean;
  shiftKey?: boolean;
}): boolean {
  if (e.altKey || e.shiftKey) return false;
  if (!(e.ctrlKey || e.metaKey)) return false;
  return e.key.toLowerCase() === "v";
}

export const CLIPBOARD_PASTE_MAX = 8192;

const MODIFIER_UP: Array<[number, string]> = [
  [0xffe3, "ControlLeft"],
  [0xffe4, "ControlRight"],
  [0xffe1, "ShiftLeft"],
  [0xffe2, "ShiftRight"],
  [0xffe9, "AltLeft"],
  [0xfe03, "AltRight"],
];

/** Type clipboard text as RFB keys. VGA/QEMU does not sync the Windows clipboard. */
export function clipboardCharsToKeysyms(text: string, max = CLIPBOARD_PASTE_MAX): {
  keysyms: number[];
  truncated: boolean;
} {
  const chars = [...text];
  const truncated = chars.length > max;
  const keysyms: number[] = [];
  for (const ch of chars.slice(0, max)) {
    if (ch === "\r") continue;
    if (ch === "\n") {
      keysyms.push(0xff0d);
      continue;
    }
    if (ch === "\t") {
      keysyms.push(0xff09);
      continue;
    }
    const cp = ch.codePointAt(0);
    if (cp === undefined) continue;
    keysyms.push(cp < 0x100 ? cp : 0x01000000 + cp);
  }
  return { keysyms, truncated };
}

export function sendClipboardAsKeys(
  sendKey: (keysym: number, code: string | null, down: boolean) => void,
  text: string,
): { truncated: boolean } {
  for (const [keysym, code] of MODIFIER_UP) sendKey(keysym, code, false);
  const { keysyms, truncated } = clipboardCharsToKeysyms(text);
  for (const keysym of keysyms) {
    sendKey(keysym, null, true);
    sendKey(keysym, null, false);
  }
  return { truncated };
}

export function shouldCaptureConsoleKey(
  e: { key: string; ctrlKey: boolean; metaKey: boolean; target: EventTarget | null },
  active: boolean,
): boolean {
  if (!active) return false;
  if (isDomTextField(e.target)) return false;
  if (isBrowserChromeKey(e)) return false;
  return true;
}

/** X11 keysyms used by RFB KeyEvent. Unicode uses 0x01000000 + codepoint. */
const NAMED_KEYSYMS: Record<string, number> = {
  " ": 0x0020,
  Spacebar: 0x0020,
  Enter: 0xff0d,
  Tab: 0xff09,
  Backspace: 0xff08,
  Escape: 0xff1b,
  Delete: 0xffff,
  Insert: 0xff63,
  Home: 0xff50,
  End: 0xff57,
  PageUp: 0xff55,
  PageDown: 0xff56,
  ArrowLeft: 0xff51,
  ArrowUp: 0xff52,
  ArrowRight: 0xff53,
  ArrowDown: 0xff54,
  Shift: 0xffe1,
  Control: 0xffe3,
  Alt: 0xffe9,
  Meta: 0xffe7,
  CapsLock: 0xffe5,
  Pause: 0xff13,
  ScrollLock: 0xff14,
  PrintScreen: 0xff61,
  ContextMenu: 0xff67,
};

for (let i = 1; i <= 12; i++) NAMED_KEYSYMS[`F${i}`] = 0xffbe + i - 1;

export function rfbKeysymFromKeyboardEvent(e: { key: string; code?: string }): number | null {
  const named = NAMED_KEYSYMS[e.key];
  if (named !== undefined) return named;
  if (e.code === "Space") return 0x0020;
  if (e.key.length === 1) {
    const cp = e.key.codePointAt(0);
    if (cp === undefined) return null;
    if (cp < 0x100) return cp;
    return 0x01000000 + cp;
  }
  if (e.code === "ShiftLeft" || e.code === "ShiftRight") return e.code === "ShiftRight" ? 0xffe2 : 0xffe1;
  if (e.code === "ControlLeft" || e.code === "ControlRight") return e.code === "ControlRight" ? 0xffe4 : 0xffe3;
  if (e.code === "AltLeft" || e.code === "AltRight") return e.code === "AltRight" ? 0xfe03 : 0xffe9;
  return null;
}

type RfbKeyboard = {
  ungrab(): void;
};

/**
 * QEMU advertises QEMUExtendedKeyEvent. Stock noVNC then sends msg-type 255
 * instead of standard KeyEvent (type 4). PVE’s own console does not use that
 * extension; those frames are ignored and the guest never sees keys.
 */
export function disableQemuExtendedKeys(rfb: object): void {
  Object.defineProperty(rfb, "_qemuExtKeyEventSupported", {
    configurable: true,
    enumerable: false,
    get: () => false,
    set: () => undefined,
  });
}

/**
 * Capture keys on window while the VGA session is connected.
 * preventDefault runs first so Space/Arrows cannot scroll the page.
 */
export function grabRfbKeyboard(
  rfb: object,
  isActive: () => boolean,
  send: (e: KeyboardEvent, down: boolean) => void,
  onHostPaste?: (text: string) => void,
): () => void {
  const keyboard = (rfb as { _keyboard?: RfbKeyboard })._keyboard;
  try {
    keyboard?.ungrab();
  } catch {
    /* already detached */
  }

  const onKeyDown = (e: KeyboardEvent) => {
    if (!shouldCaptureConsoleKey(e, isActive())) return;
    if (isClipboardPasteKey(e)) {
      e.stopPropagation();
      e.stopImmediatePropagation();
      return;
    }
    e.preventDefault();
    e.stopPropagation();
    e.stopImmediatePropagation();
    send(e, true);
  };
  const onKeyUp = (e: KeyboardEvent) => {
    if (!shouldCaptureConsoleKey(e, isActive())) return;
    if (isClipboardPasteKey(e)) {
      e.stopPropagation();
      e.stopImmediatePropagation();
      return;
    }
    e.preventDefault();
    e.stopPropagation();
    e.stopImmediatePropagation();
    send(e, false);
  };
  const onPaste = (e: ClipboardEvent) => {
    if (!isActive()) return;
    if (isDomTextField(e.target)) return;
    const text = e.clipboardData?.getData("text") ?? "";
    if (!text) return;
    e.preventDefault();
    e.stopPropagation();
    onHostPaste?.(text);
  };

  window.addEventListener("keydown", onKeyDown, true);
  window.addEventListener("keyup", onKeyUp, true);
  window.addEventListener("paste", onPaste, true);

  return () => {
    window.removeEventListener("keydown", onKeyDown, true);
    window.removeEventListener("keyup", onKeyUp, true);
    window.removeEventListener("paste", onPaste, true);
  };
}
