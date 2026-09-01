import { describe, expect, it } from "vitest";
import { applyWindowsGuestHardware, withNetFirewall } from "@/lib/windows-guest";

describe("windows guest hardware", () => {
  it("adds host CPU, q35, OVMF and net firewall without dropping the NIC", () => {
    const next = applyWindowsGuestHardware({
      name: "WindowsTest",
      ostype: "l26",
      net0: "virtio=BC:24:11:52:AA:71,bridge=vmbr0",
      scsi0: "apps:vm-243-disk-1,size=80G",
    });
    expect(next.ostype).toBe("win11");
    expect(next.bios).toBe("ovmf");
    expect(next.machine).toBe("q35");
    expect(next.cpu).toBe("host");
    expect(next.scsihw).toBe("virtio-scsi-single");
    expect(next.agent).toBe("1");
    expect(next.tablet).toBe("1");
    expect(next.onboot).toBe("1");
    expect(next.net0).toBe("virtio=BC:24:11:52:AA:71,bridge=vmbr0,firewall=1");
    expect(next.scsi0).toBe("apps:vm-243-disk-1,size=80G");
  });

  it("keeps an existing q35 machine and restores a display if VGA is none", () => {
    const next = applyWindowsGuestHardware({
      ostype: "win11",
      machine: "pc-q35-11.0+pve2",
      vga: "none",
      net0: "virtio=AA:BB:CC:DD:EE:FF,bridge=vmbr0,firewall=1",
    });
    expect(next.machine).toBe("pc-q35-11.0+pve2");
    expect(next.vga).toBe("std");
    expect(next.net0).toBe("virtio=AA:BB:CC:DD:EE:FF,bridge=vmbr0,firewall=1");
  });

  it("toggles the firewall flag on a net spec", () => {
    expect(withNetFirewall("virtio=AA:BB,bridge=vmbr0,firewall=0")).toBe("virtio=AA:BB,bridge=vmbr0,firewall=1");
    expect(withNetFirewall("virtio=AA:BB,bridge=vmbr0,firewall=1", false)).toBe("virtio=AA:BB,bridge=vmbr0");
  });
});
