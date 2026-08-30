import { describe, expect, it } from "vitest";
import { isTermproxySerialError, vmHasGraphics, vmHasSerialSocket } from "@/lib/guest-console";

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
});
