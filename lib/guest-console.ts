/** Unset VGA means PVE default (std). Only `none` has no graphics. */
export function vmHasGraphics(vga: unknown): boolean {
  const raw = String(vga ?? "")
    .split(",")[0]
    ?.trim()
    .toLowerCase();
  return raw !== "none";
}

/** xterm.js serial console needs QEMU `serial0: socket`. */
export function vmHasSerialSocket(serial0: unknown): boolean {
  const raw = String(serial0 ?? "")
    .trim()
    .toLowerCase();
  return raw === "socket" || raw.startsWith("socket,");
}

export function isTermproxySerialError(text: string): boolean {
  return /unable to find a serial interface/i.test(text);
}

/** Absolute pointer (usb-tablet). Without it, noVNC mouse feels relative/wrong. */
export function vmHasTablet(tablet: unknown): boolean {
  const raw = String(tablet ?? "").trim().toLowerCase();
  return raw === "1" || raw === "true" || raw === "yes";
}
