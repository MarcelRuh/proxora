import { describe, expect, it } from "vitest";
import { buildLxcNet0, compactProxmoxBody, normalizeLxcCidr } from "@/lib/lxc-net";

describe("LXC net0", () => {
  it("builds DHCP without gateway", () => {
    expect(buildLxcNet0({ bridge: "vmbr0", mode: "dhcp", gateway: "192.168.1.1" })).toBe(
      "name=eth0,bridge=vmbr0,ip=dhcp",
    );
  });

  it("builds static with CIDR and gateway", () => {
    expect(
      buildLxcNet0({
        bridge: "vmbr0",
        mode: "static",
        cidr: "192.168.1.50",
        gateway: "192.168.1.1",
      }),
    ).toBe("name=eth0,bridge=vmbr0,ip=192.168.1.50/24,gw=192.168.1.1");
  });

  it("keeps an existing prefix", () => {
    expect(normalizeLxcCidr("10.0.0.8/16")).toBe("10.0.0.8/16");
  });

  it("drops empty Proxmox fields", () => {
    expect(compactProxmoxBody({ hostname: "ct", password: "", "ssh-public-keys": undefined, cores: 2 })).toEqual({
      hostname: "ct",
      cores: 2,
    });
  });
});
