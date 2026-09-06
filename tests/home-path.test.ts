import { describe, expect, it } from "vitest";
import { homePathForUser, navItemVisible, resolvePostLoginPath } from "@/lib/home-path";
import { ROLE_PRESETS } from "@/lib/permissions";

const nothingUser = {
  role: { permissions: ROLE_PRESETS.nothing.permissions },
  allowedGuests: [{ hostId: "h1", kind: "lxc" as const, vmid: 243 }],
};

describe("home path", () => {
  it("sends Nothing users with an LXC grant to containers", () => {
    expect(homePathForUser(nothingUser)).toBe("/containers");
    expect(resolvePostLoginPath(nothingUser, "/dashboard")).toBe("/containers");
    expect(resolvePostLoginPath(nothingUser, "/hosts")).toBe("/containers");
    expect(resolvePostLoginPath(nothingUser, "/containers/h1/pve/243")).toBe("/containers/h1/pve/243");
  });

  it("hides hosts and the other guest kind in the nav", () => {
    expect(navItemVisible(nothingUser, "/dashboard", ["hosts.view"])).toBe(false);
    expect(navItemVisible(nothingUser, "/hosts", ["hosts.view"])).toBe(false);
    expect(navItemVisible(nothingUser, "/containers", ["lxc.view"])).toBe(true);
    expect(navItemVisible(nothingUser, "/vms", ["vm.view"])).toBe(false);
    expect(navItemVisible(nothingUser, "/storage", ["storage.view"])).toBe(false);
  });

  it("keeps operators on the dashboard", () => {
    const operator = { role: { permissions: ROLE_PRESETS.operator.permissions }, allowedGuests: null };
    expect(homePathForUser(operator)).toBe("/dashboard");
    expect(navItemVisible(operator, "/hosts", ["hosts.view"])).toBe(true);
    expect(navItemVisible(operator, "/vms", ["vm.view"])).toBe(true);
  });
});
