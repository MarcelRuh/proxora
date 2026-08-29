import { volidFilename } from "@/lib/lxc-templates";

export type VolumeUser = {
  kind: "vm" | "lxc";
  vmid: number;
  name: string;
  node: string;
};

export function configReferencesVolume(config: Record<string, unknown>, volid: string): boolean {
  const file = volidFilename(volid).toLowerCase();
  if (!file) return false;
  const full = volid.toLowerCase();
  for (const value of Object.values(config)) {
    const text = String(value ?? "").toLowerCase();
    if (!text) continue;
    if (text.includes(full)) return true;
    if (file.length >= 12 && text.includes(file)) return true;
  }
  return false;
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
