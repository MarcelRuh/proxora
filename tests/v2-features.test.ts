import { describe, expect, it } from "vitest";
import {
  consumeRecoveryCode,
  generateRecoveryCodes,
  hashRecoveryCodes,
  looksLikeRecoveryCode,
  normalizeRecoveryCode,
} from "@/lib/recovery-codes";
import { haSid, hostShowsClusterUi, parseHaSid } from "@/lib/cluster-features";
import { hostNameFromUrl, spiceViewerFile } from "@/lib/spice-vv";
import { isCloudInitKey, isPciKey, isUsbKey } from "@/lib/guest-passthrough";

describe("recovery codes", () => {
  it("generates unique hashed codes that can be consumed once", () => {
    const codes = generateRecoveryCodes(8);
    expect(codes).toHaveLength(8);
    expect(new Set(codes).size).toBe(8);
    expect(codes.every((c) => looksLikeRecoveryCode(c))).toBe(true);
    const hashes = hashRecoveryCodes(codes);
    const next = consumeRecoveryCode(hashes, codes[0]!.toLowerCase());
    expect(next).toHaveLength(hashes.length - 1);
    expect(consumeRecoveryCode(next!, codes[0]!)).toBeNull();
    expect(normalizeRecoveryCode("ab-cd ef12")).toBe("ABCDEF12");
  });
});

describe("cluster UI gating", () => {
  it("hides HA on standalone hosts", () => {
    expect(hostShowsClusterUi(false)).toBe(false);
    expect(hostShowsClusterUi(null)).toBe(false);
    expect(hostShowsClusterUi(true)).toBe(true);
    expect(haSid("vm", 101)).toBe("vm:101");
    expect(haSid("lxc", 202)).toBe("ct:202");
    expect(parseHaSid("ct:202")).toEqual({ kind: "lxc", vmid: 202 });
  });
});

describe("spice viewer file", () => {
  it("builds a virt-viewer document", () => {
    const file = spiceViewerFile(
      { type: "spice", host: "pve.lan", port: 3128, password: "secret", title: "VM 100" },
      "ignored",
    );
    expect(file).toContain("[virt-viewer]");
    expect(file).toContain("type=spice");
    expect(file).toContain("host=pve.lan");
    expect(file).toContain("password=secret");
    expect(hostNameFromUrl("https://pve.example:8006")).toBe("pve.example");
  });
});

describe("passthrough keys", () => {
  it("recognizes pci, usb and cloud-init keys", () => {
    expect(isPciKey("hostpci0")).toBe(true);
    expect(isUsbKey("usb1")).toBe(true);
    expect(isCloudInitKey("ipconfig0")).toBe(true);
    expect(isPciKey("scsi0")).toBe(false);
  });
});
