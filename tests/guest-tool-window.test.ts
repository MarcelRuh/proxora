import { describe, expect, it } from "vitest";
import {
  guestToolPath,
  guestToolWindowFeatures,
  guestToolWindowName,
  guestToolWindowSize,
} from "@/lib/guest-tool-window";

describe("guest tool windows", () => {
  it("builds popup paths for console and files", () => {
    expect(
      guestToolPath({ kind: "vm", hostId: "abc", node: "pve", vmid: 100, tool: "console" }),
    ).toBe("/vms/abc/pve/100/console");
    expect(
      guestToolPath({ kind: "lxc", hostId: "h/1", node: "node-a", vmid: "101", tool: "files" }),
    ).toBe("/containers/h%2F1/node-a/101/files");
  });

  it("uses a stable window name per guest and tool", () => {
    expect(guestToolWindowName({ kind: "vm", hostId: "host-1", vmid: 100, tool: "console" })).toBe(
      "proxora_vm_host_1_100_console",
    );
    expect(guestToolWindowName({ kind: "lxc", hostId: "a b", vmid: 5, tool: "files" })).toBe(
      "proxora_lxc_a_b_5_files",
    );
  });

  it("sizes and centers the popup", () => {
    expect(guestToolWindowSize("console").width).toBeGreaterThan(800);
    const features = guestToolWindowFeatures("files", {
      screenX: 100,
      screenY: 50,
      outerWidth: 1600,
      outerHeight: 900,
    });
    expect(features).toContain("popup=yes");
    expect(features).toContain("width=1100");
    expect(features).toMatch(/left=\d+/);
    expect(features).toMatch(/top=\d+/);
  });
});
