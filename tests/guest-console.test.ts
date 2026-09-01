import { describe, expect, it } from "vitest";
import { isTermproxySerialError, parseQemuKeyboard, vmHasGraphics, vmHasSerialSocket, vmHasTablet } from "@/lib/guest-console";

describe("guest console helpers", () => {
  it("treats unset VGA as a display and vga=none as headless", () => {
    expect(vmHasGraphics(undefined)).toBe(true);
    expect(vmHasGraphics("std")).toBe(true);
    expect(vmHasGraphics("virtio,memory=32")).toBe(true);
    expect(vmHasGraphics("none")).toBe(false);
  });

  it("only accepts serial0 socket for xterm.js", () => {
    expect(vmHasSerialSocket(undefined)).toBe(false);
    expect(vmHasSerialSocket("socket")).toBe(true);
    expect(vmHasSerialSocket("socket,path=/tmp/x")).toBe(true);
    expect(vmHasSerialSocket("/dev/ttyS0")).toBe(false);
  });

  it("detects the PVE serial error", () => {
    expect(isTermproxySerialError("unable to find a serial interface")).toBe(true);
    expect(isTermproxySerialError("OK")).toBe(false);
  });

  it("treats PVE default tablet as on and only 0 as off", () => {
    expect(vmHasTablet(undefined)).toBe(true);
    expect(vmHasTablet(1)).toBe(true);
    expect(vmHasTablet("1")).toBe(true);
    expect(vmHasTablet(0)).toBe(false);
    expect(vmHasTablet("0")).toBe(false);
  });

  it("defaults QEMU keyboard to en-us and accepts de", () => {
    expect(parseQemuKeyboard(undefined)).toBe("en-us");
    expect(parseQemuKeyboard("")).toBe("en-us");
    expect(parseQemuKeyboard("de")).toBe("de");
    expect(parseQemuKeyboard("DE")).toBe("de");
    expect(parseQemuKeyboard("de-ch")).toBe("de-ch");
  });
});
