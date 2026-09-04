import { describe, expect, it } from "vitest";
import {
  ALL_PERMISSIONS,
  hasAnyPermission,
  hasPermission,
  PERMISSION_CATALOG,
  permissionForGuestAction,
  ROLE_PRESETS,
  sanitizePermissions,
} from "@/lib/permissions";
import { canAccessGuest, canAccessHost, filterGuestsForUser, type AccessScope } from "@/lib/guest-scope";

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
    expect(hasPermission(granted, "tasks.cancel")).toBe(true);
    expect(hasPermission(granted, "storage.delete")).toBe(false);
    expect(hasPermission(granted, "vm.reset")).toBe(false);
    expect(hasPermission(granted, "vm.config")).toBe(false);
    expect(hasPermission(granted, "users.create")).toBe(false);
  });

  it("expands legacy coarse aliases without turning force-stop into a bundle", () => {
    expect(hasPermission(["hosts.edit"], "hosts.update")).toBe(true);
    expect(hasPermission(["hosts.edit"], "hosts.credentials")).toBe(true);
    expect(hasPermission(["vm.edit"], "vm.config")).toBe(true);
    expect(hasPermission(["vm.stop"], "vm.shutdown")).toBe(true);
    expect(hasPermission(["vm.stop"], "vm.force-stop")).toBe(true);
    expect(hasPermission(["vm.force-stop"], "vm.shutdown")).toBe(false);
    expect(sanitizePermissions(["hosts.edit", "vm.view"])).toEqual(["hosts.update", "hosts.credentials", "vm.view"]);
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
});
