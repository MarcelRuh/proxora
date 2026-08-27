import { describe, expect, it } from "vitest";
import { ALL_PERMISSIONS, hasAnyPermission, hasPermission, ROLE_PRESETS } from "@/lib/permissions";

describe("RBAC", () => {
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
    expect(hasPermission(granted, "backup.manage")).toBe(false);
    expect(hasPermission(granted, "vm.delete")).toBe(false);
    expect(hasPermission(granted, "hosts.reboot")).toBe(false);
    expect(hasAnyPermission(granted, ["vm.start", "lxc.start"])).toBe(false);
  });

  it("allows Operator to start guests and open consoles", () => {
    const granted = ROLE_PRESETS.operator.permissions;
    expect(hasPermission(granted, "vm.start")).toBe(true);
    expect(hasPermission(granted, "lxc.console")).toBe(true);
    expect(hasPermission(granted, "users.manage")).toBe(false);
  });

  it("denies missing permission lists", () => {
    expect(hasPermission(undefined, "hosts.view")).toBe(false);
    expect(hasPermission([], "hosts.view")).toBe(false);
  });
});
