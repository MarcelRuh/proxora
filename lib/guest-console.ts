/** QEMU `-k` / PVE Options → Keyboard Layout. Empty in config means en-us. */
export const QEMU_KEYBOARD_LAYOUTS = [
  { value: "de", label: "Deutsch" },
  { value: "de-ch", label: "Deutsch (Schweiz)" },
  { value: "en-us", label: "English (US)" },
  { value: "en-gb", label: "English (UK)" },
  { value: "fr", label: "Français" },
  { value: "fr-ch", label: "Français (Suisse)" },
  { value: "es", label: "Español" },
  { value: "it", label: "Italiano" },
  { value: "nl", label: "Nederlands" },
  { value: "pl", label: "Polski" },
  { value: "pt", label: "Português" },
  { value: "pt-br", label: "Português (BR)" },
  { value: "sv", label: "Svenska" },
  { value: "da", label: "Dansk" },
  { value: "fi", label: "Suomi" },
  { value: "no", label: "Norsk" },
  { value: "hu", label: "Magyar" },
  { value: "tr", label: "Türkçe" },
  { value: "ja", label: "日本語" },
] as const;

export type QemuKeyboardLayout = (typeof QEMU_KEYBOARD_LAYOUTS)[number]["value"];

export function parseQemuKeyboard(raw: unknown): QemuKeyboardLayout {
  const value = String(raw ?? "")
    .trim()
    .toLowerCase();
  const match = QEMU_KEYBOARD_LAYOUTS.find((layout) => layout.value === value);
  return match?.value ?? "en-us";
}

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

/**
 * USB tablet (absolute pointer). PVE default is on (`tablet=1`).
 * Unset therefore counts as present — do not PUT tablet on a running VM
 * or QEMU may reset the USB HID (keyboard + mouse go dead, picture stays).
 */
export function vmHasTablet(tablet: unknown): boolean {
  const raw = String(tablet ?? "1").trim().toLowerCase();
  return raw !== "0" && raw !== "false" && raw !== "no" && raw !== "off";
}
