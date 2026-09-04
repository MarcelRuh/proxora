import { hasPermission, type Permission } from "@/lib/permissions";
import type { GuestScope } from "@/lib/guest-scope";
import { guestScopeKey } from "@/lib/guest-scope";

export const PREVIEW_ACTIONS: Permission[] = [
  "hosts.reboot",
  "hosts.shutdown",
  "hosts.console",
  "vm.start",
  "vm.shutdown",
  "vm.force-stop",
  "vm.reboot",
  "vm.console",
  "vm.config",
  "vm.delete",
  "vm.clone",
  "vm.migrate",
  "lxc.start",
  "lxc.shutdown",
  "lxc.force-stop",
  "lxc.reboot",
  "lxc.console",
  "lxc.config",
  "lxc.delete",
  "lxc.clone",
  "lxc.migrate",
  "backup.run",
  "backup.restore",
];

export type AccessPreview = {
  roleName: string;
  hostMode: "all" | "listed";
  hostNames: string[];
  guestMode: "all" | "listed";
  guests: Array<{ hostName: string; kind: "vm" | "lxc"; vmid: number; name: string | null }>;
  actions: Permission[];
};

export function buildAccessPreview(input: {
  roleName: string;
  permissions: readonly string[] | undefined;
  hostIds: string[];
  guests: GuestScope[];
  hosts: Array<{ id: string; name: string }>;
  guestNames?: Record<string, string>;
}): AccessPreview {
  const hostMap = new Map(input.hosts.map((h) => [h.id, h.name]));
  return {
    roleName: input.roleName,
    hostMode: input.hostIds.length ? "listed" : "all",
    hostNames: input.hostIds.map((id) => hostMap.get(id) ?? id),
    guestMode: input.guests.length ? "listed" : "all",
    guests: input.guests.map((g) => ({
      hostName: hostMap.get(g.hostId) ?? g.hostId,
      kind: g.kind,
      vmid: g.vmid,
      name: input.guestNames?.[guestScopeKey(g)] ?? null,
    })),
    actions: PREVIEW_ACTIONS.filter((p) => hasPermission(input.permissions, p)),
  };
}
