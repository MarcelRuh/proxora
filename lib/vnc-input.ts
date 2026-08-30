/** Form fields and dialogs must keep the browser keyboard. */
export function isDomTextField(target: EventTarget | null): boolean {
  if (target == null || typeof HTMLElement === "undefined") return false;
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;
  if (target.isContentEditable) return true;
  return Boolean(target.closest('[role="dialog"]'));
}

type RfbKeyboard = {
  ungrab(): void;
  _eventHandlers: {
    keydown: (e: KeyboardEvent) => void;
    keyup: (e: KeyboardEvent) => void;
    blur: () => void;
  };
};

type RfbInputPatch = {
  _keyboard?: RfbKeyboard;
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
 * noVNC binds keydown to the canvas (tabIndex=-1). In a React app that focus
 * is lost constantly. Capture on window while the VGA console is grabbed.
 */
export function grabRfbKeyboard(rfb: object, isActive: () => boolean): () => void {
  const keyboard = (rfb as RfbInputPatch)._keyboard;
  if (!keyboard) return () => undefined;
  keyboard.ungrab();

  const onKeyDown = (e: KeyboardEvent) => {
    if (!isActive() || isDomTextField(e.target)) return;
    keyboard._eventHandlers.keydown(e);
  };
  const onKeyUp = (e: KeyboardEvent) => {
    if (!isActive() || isDomTextField(e.target)) return;
    keyboard._eventHandlers.keyup(e);
  };

  window.addEventListener("keydown", onKeyDown, true);
  window.addEventListener("keyup", onKeyUp, true);
  window.addEventListener("blur", keyboard._eventHandlers.blur);

  return () => {
    window.removeEventListener("keydown", onKeyDown, true);
    window.removeEventListener("keyup", onKeyUp, true);
    window.removeEventListener("blur", keyboard._eventHandlers.blur);
    try {
      keyboard.ungrab();
    } catch {
      /* already torn down */
    }
  };
}
