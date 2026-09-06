import { describe, expect, it } from "vitest";
import {
  ALL_PERMISSIONS,
  hasAnyPermission,
  hasPermission,
  PERMISSION_CATALOG,
  permissionForGuestAction,
  ROLE_PRESETS,
  sanitizePermissions,
  filesOnlyGuestPermissions,
  normalizeGuestPermissions,
  userHasPermission,
  userHasAnyPermission,
} from "@/lib/permissions";
import { canAccessGuest, canAccessHost, filterGuestsForUser, lockHostsWithoutHostView, sessionScopeFromGrants, type AccessScope } from "@/lib/guest-scope";

function user(partial: Partial<AccessScope> = {}): AccessScope {
  return {
    allowedHostIds: null,
    allowedGuests: null,
    ...partial,
  };
}

describe("RBAC", () => {
  it("keeps the catalog aligned with the permission list", () => {
    expect(PERMISSION_CATALOG.map((p) => p.id).sort()).toEqual([...ALL_PERMISSIONS].sort());
  });

  it("grants Super Admin every permission", () => {
    const granted = ROLE_PRESETS["super-admin"].permissions;
    for (const permission of ALL_PERMISSIONS) {
      expect(hasPermission(granted, permission)).toBe(true);
    }
  });

  it("keeps Viewer read-only", () => {
    const granted = ROLE_PRESETS.viewer.permissions;
    expect(hasPermission(granted, "vm.view")).toBe(true);
    expect(hasPermission(granted, "backup.view")).toBe(true);
    expect(hasPermission(granted, "backup.run")).toBe(false);
    expect(hasPermission(granted, "storage.delete")).toBe(false);
    expect(hasPermission(granted, "tasks.cancel")).toBe(false);
    expect(hasPermission(granted, "vm.delete")).toBe(false);
    expect(hasPermission(granted, "hosts.reboot")).toBe(false);
    expect(hasAnyPermission(granted, ["vm.start", "lxc.start"])).toBe(false);
  });

  it("allows Operator to start guests and open consoles without config or force extras", () => {
    const granted = ROLE_PRESETS.operator.permissions;
    expect(hasPermission(granted, "vm.start")).toBe(true);
    expect(hasPermission(granted, "vm.shutdown")).toBe(true);
    expect(hasPermission(granted, "vm.force-stop")).toBe(true);
    expect(hasPermission(granted, "lxc.console")).toBe(true);
    expect(hasPermission(granted, "lxc.files.read")).toBe(true);
    expect(hasPermission(granted, "lxc.files.write")).toBe(true);
    expect(hasPermission(granted, "tasks.cancel")).toBe(true);
    expect(hasPermission(granted, "storage.delete")).toBe(false);
    expect(hasPermission(granted, "vm.reset")).toBe(false);
    expect(hasPermission(granted, "vm.config")).toBe(false);
    expect(hasPermission(granted, "users.create")).toBe(false);
  });

  it("gives Nothing guest control without host inventory", () => {
    const granted = ROLE_PRESETS.nothing.permissions;
    expect(hasPermission(granted, "hosts.view")).toBe(false);
    expect(hasPermission(granted, "storage.view")).toBe(false);
    expect(hasPermission(granted, "backup.view")).toBe(false);
    expect(hasPermission(granted, "lxc.view")).toBe(true);
    expect(hasPermission(granted, "lxc.start")).toBe(true);
    expect(hasPermission(granted, "lxc.console")).toBe(true);
    expect(hasPermission(granted, "lxc.files.read")).toBe(true);
    expect(hasPermission(granted, "lxc.files.write")).toBe(true);
    expect(hasPermission(granted, "vm.view")).toBe(true);
    expect(hasPermission(granted, "lxc.create")).toBe(false);
    expect(hasPermission(granted, "lxc.config")).toBe(false);
    expect(hasPermission(granted, "users.view")).toBe(false);
  });

  it("expands legacy coarse aliases without turning force-stop into a bundle", () => {
    expect(hasPermission(["hosts.edit"], "hosts.update")).toBe(true);
    expect(hasPermission(["hosts.edit"], "hosts.credentials")).toBe(true);
    expect(hasPermission(["vm.edit"], "vm.config")).toBe(true);
    expect(hasPermission(["vm.stop"], "vm.shutdown")).toBe(true);
    expect(hasPermission(["vm.stop"], "vm.force-stop")).toBe(true);
    expect(hasPermission(["vm.force-stop"], "vm.shutdown")).toBe(false);
    expect(sanitizePermissions(["hosts.edit", "vm.view"])).toEqual(["hosts.update", "hosts.credentials", "vm.view"]);
    expect(hasPermission(["vm.files"], "vm.files.read")).toBe(true);
    expect(hasPermission(["vm.files"], "vm.files.write")).toBe(true);
    expect(hasPermission(["lxc.files.read"], "lxc.files.write")).toBe(false);
  });

  it("maps guest actions to single permissions", () => {
    expect(permissionForGuestAction("vm", "stop")).toBe("vm.force-stop");
    expect(permissionForGuestAction("vm", "shutdown")).toBe("vm.shutdown");
    expect(permissionForGuestAction("lxc", "snapshot")).toBe("lxc.snapshot.create");
    expect(permissionForGuestAction("lxc", "resize")).toBe("lxc.config");
    expect(permissionForGuestAction("vm", "migrate")).toBe("vm.migrate");
    expect(permissionForGuestAction("lxc", "migrate")).toBe("lxc.migrate");
  });

  it("denies missing permission lists", () => {
    expect(hasPermission(undefined, "hosts.view")).toBe(false);
    expect(hasPermission([], "hosts.view")).toBe(false);
  });

  it("grants extra host rights without putting them on the role", () => {
    const holder = {
      role: { permissions: ["hosts.view", "vm.view"] },
      hostPermissions: { h1: ["hosts.view", "updates.view", "updates.upgrade"] },
    };
    expect(userHasPermission(holder, "updates.upgrade", "h1")).toBe(true);
    expect(userHasPermission(holder, "updates.upgrade", "h2")).toBe(false);
    expect(userHasPermission(holder, "updates.upgrade")).toBe(true);
    expect(userHasPermission(holder, "vm.delete", "h1")).toBe(false);
  });

  it("inherits the role when a host has no override", () => {
    const holder = {
      role: { permissions: ["hosts.view", "updates.upgrade"] },
      hostPermissions: { h1: null },
    };
    expect(userHasPermission(holder, "updates.upgrade", "h1")).toBe(true);
    expect(userHasAnyPermission(holder, ["updates.check", "updates.upgrade"], "h1")).toBe(true);
  });

  it("keeps global rights on the role even with a host override", () => {
    const holder = {
      role: { permissions: ["users.view", "hosts.view"] },
      hostPermissions: { h1: ["updates.upgrade"] },
    };
    expect(userHasPermission(holder, "users.view", "h1")).toBe(true);
    expect(userHasPermission(holder, "hosts.create", "h1")).toBe(false);
  });

  it("lets a guest override beat the role and host", () => {
    const holder = {
      role: { permissions: ["lxc.view", "lxc.start", "lxc.files.read", "lxc.files.write"] },
      hostPermissions: { h1: ["lxc.view", "lxc.start"] },
      guestPermissions: { "h1:lxc:243": ["lxc.view", "lxc.files.read", "lxc.files.write"] },
    };
    const guest = { hostId: "h1", kind: "lxc" as const, vmid: 243 };
    expect(userHasPermission(holder, "lxc.files.read", "h1", guest)).toBe(true);
    expect(userHasPermission(holder, "lxc.start", "h1", guest)).toBe(false);
    expect(userHasPermission(holder, "lxc.start", "h1", { hostId: "h1", kind: "lxc", vmid: 100 })).toBe(true);
    expect(userHasPermission(holder, "lxc.files.read", "h1", { hostId: "h1", kind: "lxc", vmid: 100 })).toBe(false);
    expect(userHasPermission(holder, "lxc.start", "h1")).toBe(true);
  });

  it("treats files-only guest grants as view plus files", () => {
    expect(filesOnlyGuestPermissions("lxc")).toEqual(["lxc.view", "lxc.files.read", "lxc.files.write"]);
    expect(normalizeGuestPermissions("vm", ["vm.files.write"])).toEqual(["vm.view", "vm.files.read", "vm.files.write"]);
  });
});

describe("guest scope", () => {
  it("allows every guest when no guest list is set", () => {
    const u = user({ allowedHostIds: ["h1"] });
    expect(canAccessHost(u, "h1")).toBe(true);
    expect(canAccessGuest(u, "h1", "vm", 105)).toBe(true);
    expect(canAccessGuest(u, "h2", "vm", 105)).toBe(false);
  });

  it("restricts to listed VMs and containers", () => {
    const u = user({
      allowedHostIds: ["h1"],
      allowedGuests: [{ hostId: "h1", kind: "vm", vmid: 105 }],
    });
    expect(canAccessGuest(u, "h1", "vm", 105)).toBe(true);
    expect(canAccessGuest(u, "h1", "vm", 106)).toBe(false);
    expect(canAccessGuest(u, "h1", "lxc", 105)).toBe(false);
    expect(
      filterGuestsForUser(u, "h1", "vm", [
        { vmid: 105 },
        { vmid: 106 },
      ]),
    ).toEqual([{ vmid: 105 }]);
  });

  it("derives host scope from guest grants when no hosts are assigned", () => {
    const scope = sessionScopeFromGrants([], [{ hostId: "h1", kind: "lxc", vmid: 243 }]);
    expect(scope.allowedHostIds).toEqual(["h1"]);
    expect(scope.allowedGuests).toEqual([{ hostId: "h1", kind: "lxc", vmid: 243 }]);
    expect(canAccessGuest(scope, "h1", "lxc", 243)).toBe(true);
    expect(canAccessGuest(scope, "h1", "lxc", 100)).toBe(false);
    expect(canAccessGuest(scope, "h2", "lxc", 243)).toBe(false);
    expect(canAccessHost(scope, "h2")).toBe(false);
  });

  it("does not treat empty grants as all hosts when the role cannot view hosts", () => {
    expect(lockHostsWithoutHostView(null, false)).toEqual([]);
    expect(lockHostsWithoutHostView(null, true)).toBeNull();
    expect(lockHostsWithoutHostView(["h1"], false)).toEqual(["h1"]);
    const locked: AccessScope = { allowedHostIds: [], allowedGuests: null };
    expect(canAccessHost(locked, "h1")).toBe(false);
    expect(filterGuestsForUser(locked, "h1", "lxc", [{ vmid: 1 }])).toEqual([]);
  });

  it("stores per-guest permission overrides", () => {
    const scope = sessionScopeFromGrants([], [
      { hostId: "h1", kind: "lxc", vmid: 243, override: true, permissions: ["lxc.view", "lxc.files.read"] },
    ]);
    expect(scope.guestPermissions).toEqual({ "h1:lxc:243": ["lxc.view", "lxc.files.read"] });
  });
});
