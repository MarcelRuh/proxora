export const PERMISSIONS = [
  "hosts.view",
  "hosts.create",
  "hosts.update",
  "hosts.credentials",
  "hosts.delete",
  "hosts.reboot",
  "hosts.shutdown",
  "hosts.console",
  "vm.view",
  "vm.create",
  "vm.config",
  "vm.delete",
  "vm.start",
  "vm.shutdown",
  "vm.force-stop",
  "vm.reboot",
  "vm.reset",
  "vm.pause",
  "vm.resume",
  "vm.console",
  "vm.snapshot.create",
  "vm.snapshot.delete",
  "vm.snapshot.rollback",
  "vm.clone",
  "vm.migrate",
  "lxc.view",
  "lxc.create",
  "lxc.config",
  "lxc.delete",
  "lxc.start",
  "lxc.shutdown",
  "lxc.force-stop",
  "lxc.reboot",
  "lxc.console",
  "lxc.snapshot.create",
  "lxc.snapshot.delete",
  "lxc.snapshot.rollback",
  "lxc.clone",
  "storage.view",
  "zfs.view",
  "backup.view",
  "backup.run",
  "backup.restore",
  "backup.delete",
  "backup.job.create",
  "backup.job.update",
  "backup.job.delete",
  "updates.view",
  "updates.check",
  "updates.upgrade",
  "proxora.update",
  "users.view",
  "users.create",
  "users.update",
  "users.delete",
  "roles.view",
  "roles.create",
  "roles.update",
  "roles.delete",
  "audit.view",
  "tasks.view",
  "settings.view",
  "settings.update",
  "notifications.view",
  "notifications.create",
  "notifications.update",
  "notifications.delete",
] as const;

export type Permission = (typeof PERMISSIONS)[number];

export const ALL_PERMISSIONS: Permission[] = [...PERMISSIONS];

export type PermissionGroupId =
  | "hosts"
  | "vm"
  | "lxc"
  | "storage"
  | "backup"
  | "updates"
  | "access"
  | "system";

export type PermissionMeta = {
  id: Permission;
  group: PermissionGroupId;
  de: string;
  en: string;
};

export const PERMISSION_GROUPS: Array<{ id: PermissionGroupId; de: string; en: string }> = [
  { id: "hosts", de: "Hosts", en: "Hosts" },
  { id: "vm", de: "Virtuelle Maschinen", en: "Virtual machines" },
  { id: "lxc", de: "Container", en: "Containers" },
  { id: "storage", de: "Storage & ZFS", en: "Storage & ZFS" },
  { id: "backup", de: "Backups", en: "Backups" },
  { id: "updates", de: "Updates", en: "Updates" },
  { id: "access", de: "Benutzer & Rollen", en: "Users & roles" },
  { id: "system", de: "System", en: "System" },
];

export const PERMISSION_CATALOG: PermissionMeta[] = [
  { id: "hosts.view", group: "hosts", de: "Hosts ansehen", en: "View hosts" },
  { id: "hosts.create", group: "hosts", de: "Host hinzufügen", en: "Add host" },
  { id: "hosts.update", group: "hosts", de: "Host-Daten ändern (Name, URL, Notizen)", en: "Edit host details (name, URL, notes)" },
  { id: "hosts.credentials", group: "hosts", de: "Host-Zugangsdaten ändern", en: "Change host credentials" },
  { id: "hosts.delete", group: "hosts", de: "Host entfernen", en: "Remove host" },
  { id: "hosts.reboot", group: "hosts", de: "Host neu starten", en: "Reboot host" },
  { id: "hosts.shutdown", group: "hosts", de: "Host herunterfahren", en: "Shut down host" },
  { id: "hosts.console", group: "hosts", de: "Host-Konsole", en: "Host console" },
  { id: "vm.view", group: "vm", de: "VMs ansehen", en: "View VMs" },
  { id: "vm.create", group: "vm", de: "VM erstellen", en: "Create VM" },
  { id: "vm.config", group: "vm", de: "VM-Konfiguration ändern", en: "Edit VM config" },
  { id: "vm.delete", group: "vm", de: "VM löschen", en: "Delete VM" },
  { id: "vm.start", group: "vm", de: "VM starten", en: "Start VM" },
  { id: "vm.shutdown", group: "vm", de: "VM herunterfahren (ACPI)", en: "Shut down VM (ACPI)" },
  { id: "vm.force-stop", group: "vm", de: "VM hart stoppen", en: "Force stop VM" },
  { id: "vm.reboot", group: "vm", de: "VM neu starten", en: "Reboot VM" },
  { id: "vm.reset", group: "vm", de: "VM Reset (Strom)", en: "Hard-reset VM" },
  { id: "vm.pause", group: "vm", de: "VM pausieren", en: "Pause VM" },
  { id: "vm.resume", group: "vm", de: "VM fortsetzen", en: "Resume VM" },
  { id: "vm.console", group: "vm", de: "VM-Konsole", en: "VM console" },
  { id: "vm.snapshot.create", group: "vm", de: "VM-Snapshot erstellen", en: "Create VM snapshot" },
  { id: "vm.snapshot.delete", group: "vm", de: "VM-Snapshot löschen", en: "Delete VM snapshot" },
  { id: "vm.snapshot.rollback", group: "vm", de: "VM-Snapshot wiederherstellen", en: "Roll back VM snapshot" },
  { id: "vm.clone", group: "vm", de: "VM klonen", en: "Clone VM" },
  { id: "vm.migrate", group: "vm", de: "VM migrieren", en: "Migrate VM" },
  { id: "lxc.view", group: "lxc", de: "Container ansehen", en: "View containers" },
  { id: "lxc.create", group: "lxc", de: "Container erstellen", en: "Create container" },
  { id: "lxc.config", group: "lxc", de: "Container-Konfiguration ändern", en: "Edit container config" },
  { id: "lxc.delete", group: "lxc", de: "Container löschen", en: "Delete container" },
  { id: "lxc.start", group: "lxc", de: "Container starten", en: "Start container" },
  { id: "lxc.shutdown", group: "lxc", de: "Container herunterfahren", en: "Shut down container" },
  { id: "lxc.force-stop", group: "lxc", de: "Container hart stoppen", en: "Force stop container" },
  { id: "lxc.reboot", group: "lxc", de: "Container neu starten", en: "Reboot container" },
  { id: "lxc.console", group: "lxc", de: "Container-Konsole", en: "Container console" },
  { id: "lxc.snapshot.create", group: "lxc", de: "Container-Snapshot erstellen", en: "Create container snapshot" },
  { id: "lxc.snapshot.delete", group: "lxc", de: "Container-Snapshot löschen", en: "Delete container snapshot" },
  { id: "lxc.snapshot.rollback", group: "lxc", de: "Container-Snapshot wiederherstellen", en: "Roll back container snapshot" },
  { id: "lxc.clone", group: "lxc", de: "Container klonen", en: "Clone container" },
  { id: "storage.view", group: "storage", de: "Storage ansehen", en: "View storage" },
  { id: "zfs.view", group: "storage", de: "ZFS ansehen", en: "View ZFS" },
  { id: "backup.view", group: "backup", de: "Backups ansehen", en: "View backups" },
  { id: "backup.run", group: "backup", de: "Backup starten", en: "Run backup" },
  { id: "backup.restore", group: "backup", de: "Backup einspielen", en: "Restore backup" },
  { id: "backup.delete", group: "backup", de: "Backup-Datei löschen", en: "Delete backup file" },
  { id: "backup.job.create", group: "backup", de: "Backup-Job anlegen", en: "Create backup job" },
  { id: "backup.job.update", group: "backup", de: "Backup-Job ändern", en: "Edit backup job" },
  { id: "backup.job.delete", group: "backup", de: "Backup-Job löschen", en: "Delete backup job" },
  { id: "updates.view", group: "updates", de: "Host-Updates ansehen", en: "View host updates" },
  { id: "updates.check", group: "updates", de: "Host-Updates prüfen", en: "Refresh host updates" },
  { id: "updates.upgrade", group: "updates", de: "Host-Updates einspielen", en: "Apply host updates" },
  { id: "proxora.update", group: "updates", de: "Proxora selbst aktualisieren", en: "Update Proxora itself" },
  { id: "users.view", group: "access", de: "Benutzer ansehen", en: "View users" },
  { id: "users.create", group: "access", de: "Benutzer anlegen", en: "Create users" },
  { id: "users.update", group: "access", de: "Benutzer ändern (Rolle, Scope)", en: "Edit users (role, scope)" },
  { id: "users.delete", group: "access", de: "Benutzer löschen", en: "Delete users" },
  { id: "roles.view", group: "access", de: "Rollen ansehen", en: "View roles" },
  { id: "roles.create", group: "access", de: "Rollen anlegen", en: "Create roles" },
  { id: "roles.update", group: "access", de: "Rollen ändern", en: "Edit roles" },
  { id: "roles.delete", group: "access", de: "Rollen löschen", en: "Delete roles" },
  { id: "audit.view", group: "system", de: "Audit-Log ansehen", en: "View audit log" },
  { id: "tasks.view", group: "system", de: "Tasks ansehen", en: "View tasks" },
  { id: "settings.view", group: "system", de: "Einstellungen ansehen", en: "View settings" },
  { id: "settings.update", group: "system", de: "Einstellungen ändern", en: "Change settings" },
  { id: "notifications.view", group: "system", de: "Meldungskanäle ansehen", en: "View notification channels" },
  { id: "notifications.create", group: "system", de: "Meldungskanal anlegen", en: "Create notification channel" },
  { id: "notifications.update", group: "system", de: "Meldungskanal ändern", en: "Edit notification channel" },
  { id: "notifications.delete", group: "system", de: "Meldungskanal löschen", en: "Delete notification channel" },
];

/** Old coarse role strings still stored in existing DBs. */
export const LEGACY_PERMISSION_ALIASES: Record<string, Permission[]> = {
  "hosts.edit": ["hosts.update", "hosts.credentials"],
  "vm.edit": ["vm.config"],
  "vm.stop": ["vm.force-stop", "vm.shutdown", "vm.reboot", "vm.reset", "vm.pause", "vm.resume"],
  "vm.snapshot": ["vm.snapshot.create", "vm.snapshot.delete", "vm.snapshot.rollback"],
  "lxc.edit": ["lxc.config"],
  "lxc.stop": ["lxc.force-stop", "lxc.shutdown", "lxc.reboot"],
  "lxc.snapshot": ["lxc.snapshot.create", "lxc.snapshot.delete", "lxc.snapshot.rollback"],
  "storage.manage": ["storage.view"],
  "zfs.manage": ["zfs.view"],
  "backup.manage": [
    "backup.run",
    "backup.restore",
    "backup.delete",
    "backup.job.create",
    "backup.job.update",
    "backup.job.delete",
  ],
  "updates.execute": ["updates.check", "updates.upgrade", "proxora.update"],
  "users.manage": ["users.create", "users.update", "users.delete"],
  "roles.manage": ["roles.create", "roles.update", "roles.delete"],
  "settings.manage": [
    "settings.update",
    "notifications.view",
    "notifications.create",
    "notifications.update",
    "notifications.delete",
  ],
};

export function expandPermissions(granted: readonly string[] | undefined): Set<string> {
  const out = new Set<string>();
  if (!granted) return out;
  for (const raw of granted) {
    out.add(raw);
    const extra = LEGACY_PERMISSION_ALIASES[raw];
    if (extra) for (const item of extra) out.add(item);
  }
  return out;
}

export function isPermission(value: string): value is Permission {
  return (PERMISSIONS as readonly string[]).includes(value);
}

export function sanitizePermissions(values: readonly string[]): Permission[] {
  const expanded = expandPermissions(values);
  return ALL_PERMISSIONS.filter((p) => expanded.has(p));
}

export function hasPermission(granted: readonly string[] | undefined, required: Permission): boolean {
  return expandPermissions(granted).has(required);
}

export function hasAnyPermission(
  granted: readonly string[] | undefined,
  required: readonly Permission[],
): boolean {
  const expanded = expandPermissions(granted);
  return required.some((p) => expanded.has(p));
}

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
      (p) =>
        !p.startsWith("users.") &&
        !p.startsWith("roles.") &&
        p !== "settings.update" &&
        p !== "proxora.update" &&
        !p.startsWith("notifications."),
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
      "vm.shutdown",
      "vm.force-stop",
      "vm.reboot",
      "vm.console",
      "lxc.view",
      "lxc.start",
      "lxc.shutdown",
      "lxc.force-stop",
      "lxc.reboot",
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
      "settings.view",
      "notifications.view",
    ],
  },
};

export function permissionForGuestAction(kind: "vm" | "lxc", action: string): Permission {
  const prefix = kind === "vm" ? "vm" : "lxc";
  switch (action) {
    case "start":
      return `${prefix}.start` as Permission;
    case "stop":
      return `${prefix}.force-stop` as Permission;
    case "shutdown":
      return `${prefix}.shutdown` as Permission;
    case "reboot":
      return `${prefix}.reboot` as Permission;
    case "reset":
      return "vm.reset";
    case "pause":
      return "vm.pause";
    case "resume":
      return "vm.resume";
    case "delete":
      return `${prefix}.delete` as Permission;
    case "clone":
      return `${prefix}.clone` as Permission;
    case "migrate":
      return "vm.migrate";
    case "snapshot":
      return `${prefix}.snapshot.create` as Permission;
    case "snapshot-delete":
      return `${prefix}.snapshot.delete` as Permission;
    case "snapshot-rollback":
      return `${prefix}.snapshot.rollback` as Permission;
    case "config":
      return `${prefix}.config` as Permission;
    default:
      return `${prefix}.view` as Permission;
  }
}

export function backupPermissionForAction(action: string): Permission {
  switch (action) {
    case "create-job":
      return "backup.job.create";
    case "update-job":
      return "backup.job.update";
    case "delete-job":
      return "backup.job.delete";
    case "run":
    case "run-job":
      return "backup.run";
    case "restore":
      return "backup.restore";
    case "delete-file":
      return "backup.delete";
    default:
      return "backup.view";
  }
}
