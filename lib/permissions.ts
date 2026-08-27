export const PERMISSIONS = [
  "hosts.view",
  "hosts.create",
  "hosts.edit",
  "hosts.delete",
  "hosts.reboot",
  "hosts.console",
  "vm.view",
  "vm.create",
  "vm.edit",
  "vm.delete",
  "vm.start",
  "vm.stop",
  "vm.console",
  "vm.snapshot",
  "vm.clone",
  "vm.migrate",
  "lxc.view",
  "lxc.create",
  "lxc.edit",
  "lxc.delete",
  "lxc.start",
  "lxc.stop",
  "lxc.console",
  "lxc.snapshot",
  "lxc.clone",
  "storage.view",
  "storage.manage",
  "backup.view",
  "backup.manage",
  "zfs.view",
  "zfs.manage",
  "updates.view",
  "updates.execute",
  "users.view",
  "users.manage",
  "roles.view",
  "roles.manage",
  "audit.view",
  "tasks.view",
  "settings.view",
  "settings.manage",
] as const;

export type Permission = (typeof PERMISSIONS)[number];

export const ALL_PERMISSIONS: Permission[] = [...PERMISSIONS];

export const ROLE_PRESETS: Record<
  "super-admin" | "administrator" | "operator" | "viewer",
  { name: string; description: string; permissions: Permission[] }
> = {
  "super-admin": {
    name: "Super Admin",
    description: "Full access to every feature, host and setting.",
    permissions: [...ALL_PERMISSIONS],
  },
  administrator: {
    name: "Administrator",
    description: "Manage hosts, virtual machines, storage and updates.",
    permissions: ALL_PERMISSIONS.filter(
      (p) => !p.startsWith("users.") && !p.startsWith("roles.") && p !== "settings.manage",
    ),
  },
  operator: {
    name: "Operator",
    description: "Start, stop and open consoles for VMs and containers.",
    permissions: [
      "hosts.view",
      "hosts.console",
      "vm.view",
      "vm.start",
      "vm.stop",
      "vm.console",
      "lxc.view",
      "lxc.start",
      "lxc.stop",
      "lxc.console",
      "storage.view",
      "zfs.view",
      "backup.view",
      "tasks.view",
      "updates.view",
    ],
  },
  viewer: {
    name: "Viewer",
    description: "Read-only access to hosts and guests.",
    permissions: [
      "hosts.view",
      "vm.view",
      "lxc.view",
      "storage.view",
      "zfs.view",
      "backup.view",
      "tasks.view",
      "updates.view",
      "audit.view",
    ],
  },
};

export function hasPermission(
  granted: readonly string[] | undefined,
  required: Permission,
): boolean {
  if (!granted) return false;
  return granted.includes(required);
}

export function hasAnyPermission(
  granted: readonly string[] | undefined,
  required: Permission[],
): boolean {
  return required.some((p) => hasPermission(granted, p));
}
