import { describe, expect, it } from "vitest";
import { applyQemuCloudInit, buildQemuIpconfig, cloudInitDriveKey, qemuCreateIpMode, qemuCreateStaticIp } from "@/lib/cloud-init";

describe("cloud-init payload", () => {
  it("builds dhcp and static ipconfig0", () => {
    expect(buildQemuIpconfig("dhcp")).toBe("ip=dhcp");
    expect(buildQemuIpconfig("static", "10.0.0.8", "10.0.0.1")).toBe("ip=10.0.0.8/24,gw=10.0.0.1");
  });

  it("does not reuse ide0 when the system disk already occupies it", () => {
    expect(cloudInitDriveKey(["ide0", "scsi0", "ide2", "scsi1", "sata1", "ide1", "virtio1"])).toBe("scsi2");
  });

  it("writes drive + ipconfig onto the create payload", () => {
    const payload = applyQemuCloudInit({ scsi0: "local-lvm:32", ide2: "local:iso/debian.iso,media=cdrom" }, "local-lvm", "ip=dhcp");
    expect(payload.ide0).toBe("local-lvm:cloudinit");
    expect(payload.ipconfig0).toBe("ip=dhcp");
  });

  it("parses create-body IP mode", () => {
    expect(qemuCreateIpMode("dhcp")).toBe("dhcp");
    expect(qemuCreateIpMode("10.0.0.8/24")).toBe("static");
    expect(qemuCreateStaticIp("10.0.0.8/24")).toBe("10.0.0.8");
    expect(qemuCreateIpMode(undefined)).toBeNull();
  });
});
