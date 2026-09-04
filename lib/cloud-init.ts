import { ipv4Host } from "@/lib/create-ip";
import { normalizeLxcCidr } from "@/lib/lxc-net";

const CLOUDINIT_SLOTS = ["ide0", "scsi1", "sata1", "ide1", "virtio1"] as const;

export function buildQemuIpconfig(mode: "dhcp" | "static", cidr?: string, gateway?: string): string {
  if (mode === "dhcp") return "ip=dhcp";
  const parts = [`ip=${normalizeLxcCidr(cidr ?? "")}`];
  const gw = gateway?.trim();
  if (gw) parts.push(`gw=${gw}`);
  return parts.join(",");
}

export function cloudInitDriveKey(used: Iterable<string>): string {
  const taken = new Set([...used].map((key) => key.toLowerCase()));
  const preferred = CLOUDINIT_SLOTS.find((slot) => !taken.has(slot));
  if (preferred) return preferred;
  for (let i = 1; i <= 13; i++) {
    const slot = `scsi${i}`;
    if (!taken.has(slot)) return slot;
  }
  return "scsi1";
}

export function applyQemuCloudInit(
  payload: Record<string, unknown>,
  storage: string,
  ipconfig: string,
): Record<string, unknown> {
  const store = storage.trim();
  if (!store) return payload;
  const key = cloudInitDriveKey(Object.keys(payload));
  payload[key] = `${store}:cloudinit`;
  payload.ipconfig0 = ipconfig;
  return payload;
}

export function qemuCreateIpMode(ipv4: string | undefined): "dhcp" | "static" | null {
  const raw = ipv4?.trim() ?? "";
  if (!raw) return null;
  if (raw.toLowerCase() === "dhcp") return "dhcp";
  return "static";
}

export function qemuCreateStaticIp(ipv4: string | undefined): string | null {
  if (qemuCreateIpMode(ipv4) !== "static") return null;
  return ipv4Host(ipv4 ?? "");
}
