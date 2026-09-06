import { describe, expect, it } from "vitest";
import { buildAccessPreview } from "@/lib/access-preview";

describe("access preview", () => {
  it("treats empty host and guest lists as unrestricted", () => {
    const preview = buildAccessPreview({
      roleName: "Operator",
      permissions: ["vm.view", "vm.start", "vm.shutdown"],
      hosts: [],
      guests: [],
      hostList: [{ id: "h1", name: "lab" }],
    });
    expect(preview.hostMode).toBe("all");
    expect(preview.guestMode).toBe("all");
    expect(preview.actions).toEqual(["vm.start", "vm.shutdown"]);
  });

  it("names listed hosts and guests", () => {
    const preview = buildAccessPreview({
      roleName: "Operator",
      permissions: ["vm.start"],
      hostIds: ["h1"],
      guests: [{ hostId: "h1", kind: "vm", vmid: 105 }],
      hostList: [{ id: "h1", name: "lab" }],
      guestNames: { "h1:vm:105": "web" },
    });
    expect(preview.hostNames).toEqual(["lab"]);
    expect(preview.guests[0]).toMatchObject({ vmid: 105, name: "web", hostName: "lab" });
  });

  it("surfaces host overrides in the preview", () => {
    const preview = buildAccessPreview({
      roleName: "Viewer",
      permissions: ["hosts.view"],
      hosts: [{ hostId: "h1", permissions: ["hosts.view", "updates.upgrade"] }],
      guests: [],
      hostList: [{ id: "h1", name: "lab" }],
    });
    expect(preview.actions).toContain("updates.upgrade");
    expect(preview.hostOverrides).toEqual([{ hostName: "lab", count: 2 }]);
  });

  it("treats guest-only grants as listed hosts, not all hosts", () => {
    const preview = buildAccessPreview({
      roleName: "Nothing",
      permissions: ["lxc.view", "lxc.start"],
      hosts: [],
      guests: [{ hostId: "h1", kind: "lxc", vmid: 243 }],
      hostList: [{ id: "h1", name: "lab" }],
      guestNames: { "h1:lxc:243": "mail" },
    });
    expect(preview.hostMode).toBe("listed");
    expect(preview.hostNames).toEqual(["lab"]);
    expect(preview.guestMode).toBe("listed");
    expect(preview.guests[0]).toMatchObject({ vmid: 243, name: "mail", kind: "lxc" });
  });

  it("surfaces per-guest files-only rights in the preview", () => {
    const preview = buildAccessPreview({
      roleName: "Nothing",
      permissions: ["lxc.view", "lxc.start"],
      hosts: [],
      guests: [{ hostId: "h1", kind: "lxc", vmid: 243, permissions: ["lxc.view", "lxc.files.read", "lxc.files.write"] }],
      hostList: [{ id: "h1", name: "lab" }],
      guestNames: { "h1:lxc:243": "mail" },
    });
    expect(preview.actions).toContain("lxc.files.read");
    expect(preview.actions).toContain("lxc.files.write");
    expect(preview.guestOverrides).toEqual([{ label: "lab · LXC 243 (mail)", count: 3 }]);
  });
});
