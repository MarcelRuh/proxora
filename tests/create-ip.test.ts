import { describe, expect, it } from "vitest";
import {
  DEFAULT_GUEST_NETWORK,
  guestCidrFromVmid,
  guestGateway,
  guestIpFromVmid,
  ipv4Host,
  networksForHost,
  parseGuestConfigIps,
  parseAgentNetworkIps,
  parseGuestIpSettings,
  shouldSyncGuestIp,
} from "@/lib/create-ip";

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

  it("syncs empty or current auto IP, keeps custom and stale auto IPs", () => {
    expect(shouldSyncGuestIp("", DEFAULT_GUEST_NETWORK, 210)).toBe(true);
    expect(shouldSyncGuestIp("192.168.178.210/24", DEFAULT_GUEST_NETWORK, 210)).toBe(true);
    expect(shouldSyncGuestIp("192.168.178.210", DEFAULT_GUEST_NETWORK, 210)).toBe(true);
    expect(shouldSyncGuestIp("192.168.178.204/24", DEFAULT_GUEST_NETWORK, 210)).toBe(false);
    expect(shouldSyncGuestIp("10.0.0.50/24", DEFAULT_GUEST_NETWORK, 210)).toBe(false);
  });
});

describe("guest IP settings and config parse", () => {
  it("parses host overrides and falls back to defaults", () => {
    const settings = parseGuestIpSettings({
      defaults: [{ id: "10.0.0.0", prefix: 24, gateway: "10.0.0.1" }],
      byHost: { h1: [{ id: "10.1.0.0", prefix: 16, gateway: "10.1.0.1" }] },
    });
    expect(networksForHost(settings, "h1")[0]?.id).toBe("10.1.0.0");
    expect(networksForHost(settings, "other")[0]?.id).toBe("10.0.0.0");
  });

  it("reads IPs from LXC net0 and QEMU ipconfig0", () => {
    expect(parseGuestConfigIps({ net0: "name=eth0,bridge=vmbr0,ip=192.168.178.242/24,gw=192.168.178.1" })).toEqual([
      "192.168.178.242",
    ]);
    expect(parseGuestConfigIps({ ipconfig0: "ip=192.168.1.50/24,gw=192.168.1.1" })).toEqual(["192.168.1.50"]);
    expect(parseGuestConfigIps({ net0: "name=eth0,ip=dhcp" })).toEqual([]);
    expect(ipv4Host("10.0.0.8/24")).toBe("10.0.0.8");
  });

  it("reads QEMU agent interfaces and skips loopback", () => {
    expect(
      parseAgentNetworkIps({
        result: [
          { name: "lo", "ip-addresses": [{ "ip-address": "127.0.0.1", "ip-address-type": "ipv4" }] },
          {
            name: "eth0",
            "ip-addresses": [
              { "ip-address": "192.168.178.10", "ip-address-type": "ipv4" },
              { "ip-address": "fe80::1", "ip-address-type": "ipv6" },
            ],
          },
        ],
      }),
    ).toEqual(["192.168.178.10"]);
  });
});
