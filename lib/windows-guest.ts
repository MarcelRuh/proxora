import { isWindowsOstype } from "@/lib/iso-images";

/** Hardware used by a working Windows 11 guest (cursor-privat), with VGA kept for the console. */
export const WINDOWS_GUEST_HARDWARE = {
  ostype: "win11",
  bios: "ovmf",
  machine: "q35",
  cpu: "host",
  scsihw: "virtio-scsi-single",
  agent: "1",
  tablet: "1",
  onboot: "1",
  keyboard: "de",
} as const;

export function withNetFirewall(spec: string, enabled = true): string {
  const parts = spec
    .split(",")
    .map((part) => part.trim())
    .filter((part) => part && !/^firewall=/i.test(part));
  if (enabled) parts.push("firewall=1");
  return parts.join(",");
}

/** Fill Windows 11 hardware onto an existing QEMU config (form strings). Does not touch disks. */
export function applyWindowsGuestHardware(config: Record<string, string>): Record<string, string> {
  const next = { ...config };
  if (!isWindowsOstype(next.ostype)) next.ostype = WINDOWS_GUEST_HARDWARE.ostype;
  next.bios = WINDOWS_GUEST_HARDWARE.bios;
  if (!/q35/i.test(next.machine ?? "")) next.machine = WINDOWS_GUEST_HARDWARE.machine;
  next.cpu = WINDOWS_GUEST_HARDWARE.cpu;
  next.scsihw = WINDOWS_GUEST_HARDWARE.scsihw;
  next.agent = WINDOWS_GUEST_HARDWARE.agent;
  next.tablet = WINDOWS_GUEST_HARDWARE.tablet;
  next.onboot = WINDOWS_GUEST_HARDWARE.onboot;
  next.keyboard = WINDOWS_GUEST_HARDWARE.keyboard;
  if (next.vga?.split(",")[0]?.trim().toLowerCase() === "none") next.vga = "std";
  if (next.net0) next.net0 = withNetFirewall(next.net0, true);
  return next;
}
