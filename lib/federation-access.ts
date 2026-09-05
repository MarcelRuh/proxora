import { hasAnyPermission, hasPermission, hostGrantCatalog, sanitizePermissions, type Permission } from "@/lib/permissions";

export type ShareLevel = "view" | "control" | "create";

export type FederationExtra = {
  query?: Record<string, string>;
  body?: Record<string, unknown> | null;
};

const RANK: Record<ShareLevel, number> = { view: 1, control: 2, create: 3 };

export function shareRank(level: ShareLevel): number {
  return RANK[level];
}

export function shareAllows(granted: ShareLevel, needed: ShareLevel | "deny"): boolean {
  if (needed === "deny") return false;
  return RANK[granted] >= RANK[needed];
}

export function parseShareLevel(value: string | null | undefined): ShareLevel | null {
  const v = String(value ?? "").toLowerCase();
  if (v === "view" || v === "control" || v === "create") return v;
  return null;
}

const SHARE_VIEW: Permission[] = [
  "hosts.view",
  "vm.view",
  "lxc.view",
  "storage.view",
  "zfs.view",
  "backup.view",
  "updates.view",
  "tasks.view",
];

const SHARE_CREATE_ONLY: Permission[] = ["vm.create", "vm.clone", "lxc.create", "lxc.clone"];

const SHARE_DEFAULT_DENY: Permission[] = [
  "hosts.console",
  "hosts.delete",
  "hosts.credentials",
  "updates.check",
  "updates.upgrade",
];

export function permissionsForShareLevel(level: ShareLevel): Permission[] {
  const catalog = hostGrantCatalog().map((p) => p.id);
  if (level === "view") return SHARE_VIEW.filter((p) => catalog.includes(p));
  const denied = new Set<Permission>([...SHARE_DEFAULT_DENY, ...(level === "control" ? SHARE_CREATE_ONLY : [])]);
  return catalog.filter((p) => !denied.has(p));
}

export function shareLevelFromPermissions(permissions: readonly string[]): ShareLevel {
  const perms = sanitizePermissions(permissions);
  if (SHARE_CREATE_ONLY.some((p) => hasPermission(perms, p))) return "create";
  const view = new Set(permissionsForShareLevel("view"));
  if (perms.some((p) => !view.has(p))) return "control";
  return "view";
}

export function effectiveSharePermissions(level: ShareLevel, permissions?: readonly string[] | null): Permission[] {
  if (permissions && permissions.length) return sanitizePermissions(permissions).filter((p) => hostGrantCatalog().some((m) => m.id === p));
  return permissionsForShareLevel(level);
}

export function shareHasPermission(level: ShareLevel, permissions: readonly string[] | null | undefined, needed: Permission | Permission[]): boolean {
  const granted = effectiveSharePermissions(level, permissions);
  const list = Array.isArray(needed) ? needed : [needed];
  return hasAnyPermission(granted, list);
}

/** Colleague copy of a shared host: local user RBAC still applies; this is the owner ceiling. */
export function peerHostAllowsPermission(
  host: { origin?: string | null; shareLevel?: string | null; sharePermissions?: string[] | null },
  needed: Permission | Permission[],
): boolean {
  if (host.origin !== "PEER") return true;
  const level = parseShareLevel(host.shareLevel) ?? "view";
  return shareHasPermission(level, host.sharePermissions, needed);
}

function extraCmd(extra?: FederationExtra): string {
  const fromBody = extra?.body && typeof extra.body === "object" ? extra.body.cmd ?? extra.body.command : undefined;
  const fromQuery = extra?.query?.cmd ?? extra?.query?.command;
  return String(fromBody ?? fromQuery ?? "").toLowerCase();
}

function guestPrefix(kind: "vm" | "lxc"): "vm" | "lxc" {
  return kind;
}

function guestActionPermission(kind: "vm" | "lxc", method: string, lower: string): Permission {
  const prefix = guestPrefix(kind);
  if (/\/status\/start$/i.test(lower)) return `${prefix}.start` as Permission;
  if (/\/status\/stop$/i.test(lower)) return `${prefix}.force-stop` as Permission;
  if (/\/status\/shutdown$/i.test(lower)) return `${prefix}.shutdown` as Permission;
  if (/\/status\/reboot$/i.test(lower)) return `${prefix}.reboot` as Permission;
  if (/\/status\/reset$/i.test(lower)) return "vm.reset";
  if (/\/status\/suspend$/i.test(lower)) return "vm.pause";
  if (/\/status\/resume$/i.test(lower)) return "vm.resume";
  if (/\/clone$/i.test(lower)) return `${prefix}.clone` as Permission;
  if (/\/migrate$/i.test(lower)) return `${prefix}.migrate` as Permission;
  if (/\/(termproxy|vncproxy|vncwebsocket)$/i.test(lower)) return `${prefix}.console` as Permission;
  if (/\/snapshot\/[^/]+\/rollback$/i.test(lower)) return `${prefix}.snapshot.rollback` as Permission;
  if (/\/snapshot(\/|$)/i.test(lower)) {
    if (method === "DELETE") return `${prefix}.snapshot.delete` as Permission;
    if (method === "POST") return `${prefix}.snapshot.create` as Permission;
    return `${prefix}.view` as Permission;
  }
  if (method === "DELETE") return `${prefix}.delete` as Permission;
  if (method === "PUT" || method === "POST") return `${prefix}.config` as Permission;
  return `${prefix}.view` as Permission;
}

/** Fine-grained permission for a proxied Proxmox call. */
export function federationPermission(
  method: string,
  path: string,
  extra?: FederationExtra,
): Permission | Permission[] | "deny" {
  const m = method.toUpperCase();
  const lower = (path.split("?")[0] ?? "").toLowerCase();

  if (/\/nodes\/[^/]+\/status\/stopall$/i.test(lower) || /\/nodes\/[^/]+\/startall$/i.test(lower)) return "deny";
  if (lower.includes("/apt/")) {
    if (m === "GET" || m === "HEAD") return "updates.view";
    if (m === "POST" && /\/apt\/update$/i.test(lower)) return "updates.check";
    return "deny";
  }

  if (/\/nodes\/[^/]+\/status$/i.test(lower) && m === "POST" && !/\/(qemu|lxc)\//i.test(lower)) {
    const cmd = extraCmd(extra);
    if (cmd === "reboot") return "hosts.reboot";
    if (cmd === "shutdown") return "hosts.shutdown";
    return "deny";
  }
  if (/\/nodes\/[^/]+\/status\/reboot$/i.test(lower)) return m === "POST" ? "hosts.reboot" : "hosts.view";
  if (/\/nodes\/[^/]+\/status\/shutdown$/i.test(lower)) return m === "POST" ? "hosts.shutdown" : "hosts.view";

  if (/\/nodes\/[^/]+\/termproxy$/i.test(lower) && !/\/(qemu|lxc)\//i.test(lower)) {
    return extraCmd(extra) === "upgrade" ? "updates.upgrade" : "hosts.console";
  }
  if (/\/nodes\/[^/]+\/vncshell$/i.test(lower) && !/\/(qemu|lxc)\//i.test(lower)) return "hosts.console";
  if (/\/nodes\/[^/]+\/vncwebsocket$/i.test(lower) && !/\/(qemu|lxc)\//i.test(lower)) {
    return ["hosts.console", "updates.upgrade"];
  }

  if (m === "POST" && /\/nodes\/[^/]+\/qemu$/i.test(lower)) return "vm.create";
  if (m === "POST" && /\/nodes\/[^/]+\/lxc$/i.test(lower)) return "lxc.create";

  if (/\/qemu\//i.test(lower) || /\/nodes\/[^/]+\/qemu$/i.test(lower)) {
    if (m === "GET" || m === "HEAD") return "vm.view";
    return guestActionPermission("vm", m, lower);
  }
  if (/\/lxc\//i.test(lower) || /\/nodes\/[^/]+\/lxc$/i.test(lower)) {
    if (m === "GET" || m === "HEAD") return "lxc.view";
    return guestActionPermission("lxc", m, lower);
  }

  if (lower.includes("/storage/") && (lower.includes("backup") || lower.includes("vzdump"))) {
    if (m === "GET" || m === "HEAD") return "backup.view";
    if (m === "DELETE") return "backup.delete";
    if (m === "POST" && /restore/i.test(lower)) return "backup.restore";
    if (m === "POST") return "backup.run";
  }
  if (lower.includes("vzdump")) {
    if (m === "GET" || m === "HEAD") return "backup.view";
    if (m === "POST") return "backup.run";
  }
  if (lower.includes("/storage/")) {
    if (m === "GET" || m === "HEAD") return "storage.view";
    if (m === "DELETE") return "storage.delete";
  }
  if (lower.includes("/disks/") || lower.includes("/zfs")) {
    return "zfs.view";
  }
  if (lower.includes("/tasks")) {
    if (m === "DELETE" || /\/status$/i.test(lower) && m === "POST") return "tasks.cancel";
    return "tasks.view";
  }

  if (m === "GET" || m === "HEAD") return "hosts.view";
  return "deny";
}

/** Coarse bucket used by older peers and the share dropdown. */
export function federationActionLevel(method: string, path: string, extra?: FederationExtra): ShareLevel | "deny" {
  const needed = federationPermission(method, path, extra);
  if (needed === "deny") return "deny";
  const list = Array.isArray(needed) ? needed : [needed];
  if (list.some((p) => SHARE_CREATE_ONLY.includes(p))) return "create";
  const view = new Set(SHARE_VIEW);
  if (list.every((p) => view.has(p))) return "view";
  if (list.some((p) => SHARE_DEFAULT_DENY.includes(p))) {
    // Host console / APT mutate stay outside the coarse ladder.
    return "deny";
  }
  return "control";
}
