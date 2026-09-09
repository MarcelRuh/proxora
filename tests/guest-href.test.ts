import { describe, expect, it } from "vitest";
import { canOpenGuestDetail, guestDetailHref } from "@/lib/guest-href";

describe("guestDetailHref", () => {
  it("builds container and VM detail paths", () => {
    expect(guestDetailHref("lxc", "host-1", "pve", 101)).toBe("/containers/host-1/pve/101");
    expect(guestDetailHref("vm", "host-1", "node a", 200)).toBe("/vms/host-1/node%20a/200");
  });

  it("rejects an incomplete guest identity", () => {
    expect(canOpenGuestDetail("", "pve", 101)).toBe(false);
    expect(canOpenGuestDetail("host-1", "", 101)).toBe(false);
    expect(canOpenGuestDetail("host-1", "pve", 0)).toBe(false);
  });
});
