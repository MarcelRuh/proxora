import { userHasPermission, type Permission } from "@/lib/permissions";
import type { GuestScope } from "@/lib/guest-scope";
import { guestScopeKey } from "@/lib/guest-scope";

export const PREVIEW_ACTIONS: Permission[] = [
  "hosts.reboot",
  "hosts.shutdown",
  "hosts.console",
  "updates.check",
  "updates.upgrade",
  "vm.start",
  "vm.shutdown",
  "vm.force-stop",
  "vm.reboot",
  "vm.console",
  "vm.files.read",
  "vm.files.write",
  "vm.config",
  "vm.delete",
  "vm.clone",
  "vm.migrate",
  "lxc.start",
  "lxc.shutdown",
  "lxc.force-stop",
  "lxc.reboot",
  "lxc.console",
  "lxc.files.read",
  "lxc.files.write",
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
  hostOverrides: Array<{ hostName: string; count: number }>;
  guestOverrides: Array<{ label: string; count: number }>;
};

export function buildAccessPreview(input: {
  roleName: string;
  permissions: readonly string[] | undefined;
  hosts?: Array<{ hostId: string; permissions: string[] | null }>;
  hostIds?: string[];
  guests: Array<GuestScope & { permissions?: string[] | null }>;
  hostList: Array<{ id: string; name: string }>;
  /** @deprecated use hostList */
  hostsLegacy?: Array<{ id: string; name: string }>;
  guestNames?: Record<string, string>;
}): AccessPreview {
  const catalog = input.hostList ?? input.hostsLegacy ?? [];
  const hostMap = new Map(catalog.map((h) => [h.id, h.name]));
  const grants = input.hosts ?? (input.hostIds ?? []).map((hostId) => ({ hostId, permissions: null as string[] | null }));
  const holder = {
    role: { permissions: input.permissions },
    hostPermissions: Object.fromEntries(grants.map((g) => [g.hostId, g.permissions])),
    guestPermissions: Object.fromEntries(
      input.guests.map((g) => [guestScopeKey(g), g.permissions ?? null]),
    ),
  };
  const guestHostIds = [...new Set(input.guests.map((g) => g.hostId))];
  const hostMode: AccessPreview["hostMode"] = grants.length || input.guests.length ? "listed" : "all";
  const hostNames = grants.length
    ? grants.map((g) => hostMap.get(g.hostId) ?? g.hostId)
    : guestHostIds.map((id) => hostMap.get(id) ?? id);
  return {
    roleName: input.roleName,
    hostMode,
    hostNames,
    guestMode: input.guests.length ? "listed" : "all",
    guests: input.guests.map((g) => ({
      hostName: hostMap.get(g.hostId) ?? g.hostId,
      kind: g.kind,
      vmid: g.vmid,
      name: input.guestNames?.[guestScopeKey(g)] ?? null,
    })),
    actions: PREVIEW_ACTIONS.filter((p) => userHasPermission(holder, p)),
    hostOverrides: grants
      .filter((g) => g.permissions)
      .map((g) => ({ hostName: hostMap.get(g.hostId) ?? g.hostId, count: g.permissions?.length ?? 0 })),
    guestOverrides: input.guests.flatMap((g) => {
      if (!g.permissions) return [];
      const hostName = hostMap.get(g.hostId) ?? g.hostId;
      const name = input.guestNames?.[guestScopeKey(g)];
      const label = name
        ? `${hostName} · ${g.kind.toUpperCase()} ${g.vmid} (${name})`
        : `${hostName} · ${g.kind.toUpperCase()} ${g.vmid}`;
      return [{ label, count: g.permissions.length }];
    }),
  };
}
