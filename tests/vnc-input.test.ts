import { describe, expect, it } from "vitest";
import { disableQemuExtendedKeys, isDomTextField } from "@/lib/vnc-input";

describe("vnc input helpers", () => {
  it("returns false without a DOM node", () => {
    expect(isDomTextField(null)).toBe(false);
  });

  it("ignores QEMU advertising extended key events", () => {
    const rfb: { _qemuExtKeyEventSupported: boolean } = { _qemuExtKeyEventSupported: true };
    disableQemuExtendedKeys(rfb);
    rfb._qemuExtKeyEventSupported = true;
    expect(rfb._qemuExtKeyEventSupported).toBe(false);
  });
});
