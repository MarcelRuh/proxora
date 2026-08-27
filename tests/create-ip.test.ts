import { describe, expect, it } from "vitest";
import { DEFAULT_GUEST_NETWORK, guestCidrFromVmid, guestGateway, guestIpFromVmid } from "@/lib/create-ip";

describe("guest IP from VMID", () => {
  it("fills the last octet from the VMID", () => {
    expect(guestIpFromVmid("192.168.178.0", 242)).toBe("192.168.178.242");
    expect(guestCidrFromVmid(DEFAULT_GUEST_NETWORK, 242)).toBe("192.168.178.242/24");
    expect(guestGateway("192.168.1.0")).toBe("192.168.1.1");
    expect(guestIpFromVmid("192.168.2.0", 100)).toBe("192.168.2.100");
  });

  it("rejects octets outside 1–254", () => {
    expect(guestIpFromVmid("192.168.178.0", 0)).toBeNull();
    expect(guestIpFromVmid("192.168.178.0", 255)).toBeNull();
    expect(guestCidrFromVmid("192.168.178.0", 300)).toBe("");
  });
});
