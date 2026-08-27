import { describe, expect, it } from "vitest";
import { buildAccessPreview } from "@/lib/access-preview";

describe("access preview", () => {
  it("treats empty host and guest lists as unrestricted", () => {
    const preview = buildAccessPreview({
      roleName: "Operator",
      permissions: ["vm.view", "vm.start", "vm.shutdown"],
      hostIds: [],
      guests: [],
      hosts: [{ id: "h1", name: "lab" }],
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
      hosts: [{ id: "h1", name: "lab" }],
      guestNames: { "h1:vm:105": "web" },
    });
    expect(preview.hostNames).toEqual(["lab"]);
    expect(preview.guests[0]).toMatchObject({ vmid: 105, name: "web", hostName: "lab" });
  });
});
