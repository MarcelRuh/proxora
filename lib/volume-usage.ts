import { volidFilename } from "@/lib/lxc-templates";
import { parseBackupVolid } from "@/lib/backup";

export type VolumeUser = {
  kind: "vm" | "lxc";
  vmid: number;
  name: string;
  node: string;
};

/** VMID encoded in a backup, disk, or PBS volid; null for ISO/template files. */
export function vmidFromVolid(volid: string): number | null {
  const parsed = parseBackupVolid(volid);
  if (parsed.vmid != null) return parsed.vmid;
  const disk = /(?:^|\/|:)(?:vm|base|subvol)-(\d+)-(?:disk|cloudinit|state|efidisk|tpmstate)/i.exec(volid);
  if (!disk) return null;
  const id = Number(disk[1]);
  return Number.isInteger(id) && id > 0 ? id : null;
}

const UNUSED_KEY = /^unused\d+$/i;

export type VolumeUseRole = "attached" | "unused" | "none";

function volumeHitsValue(volid: string, value: unknown): boolean {
  const file = volidFilename(volid).toLowerCase();
  const full = volid.toLowerCase();
  const text = String(value ?? "").toLowerCase();
  if (!text) return false;
  if (full && text.includes(full)) return true;
  return file.length >= 8 && text.includes(file);
}

export function configVolumeRole(config: Record<string, unknown>, volid: string): VolumeUseRole {
  let unused = false;
  let attached = false;
  for (const [key, value] of Object.entries(config)) {
    if (!volumeHitsValue(volid, value)) continue;
    if (UNUSED_KEY.test(key)) unused = true;
    else attached = true;
  }
  if (attached) return "attached";
  if (unused) return "unused";
  return "none";
}

export function configReferencesVolume(config: Record<string, unknown>, volid: string): boolean {
  return configVolumeRole(config, volid) !== "none";
}

export function formatVolumeUsers(users: VolumeUser[]): string {
  return users
    .map((user) => `${user.kind === "vm" ? "VM" : "CT"} ${user.vmid}${user.name ? ` (${user.name})` : ""}`)
    .join(", ");
}

export function usersForVolids(usedBy: Record<string, VolumeUser[]>, volids: string[]): VolumeUser[] {
  const seen = new Set<string>();
  const out: VolumeUser[] = [];
  for (const volid of volids) {
    for (const user of usedBy[volid] ?? []) {
      const key = `${user.kind}:${user.node}:${user.vmid}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(user);
    }
  }
  return out;
}
