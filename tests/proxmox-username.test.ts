import { describe, expect, it } from "vitest";
import { normalizeProxmoxUsername } from "@/server/proxmox/username";

describe("normalizeProxmoxUsername", () => {
  it("appends @pam when the realm is missing", () => {
    expect(normalizeProxmoxUsername("root")).toBe("root@pam");
    expect(normalizeProxmoxUsername("  root  ")).toBe("root@pam");
  });

  it("keeps an explicit realm", () => {
    expect(normalizeProxmoxUsername("root@pam")).toBe("root@pam");
    expect(normalizeProxmoxUsername("manager@pve")).toBe("manager@pve");
  });
});
