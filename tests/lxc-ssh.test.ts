import { describe, expect, it } from "vitest";
import { LXC_SSH_DISABLE_LINE, LXC_SSH_ENABLE_LINE, lxcSshInput } from "@/lib/lxc-ssh";

describe("lxc ssh toggle", () => {
  it("uncomments port 22 and allows root login", () => {
    expect(LXC_SSH_ENABLE_LINE).toContain("s/^#Port 22$/Port 22/");
    expect(LXC_SSH_ENABLE_LINE).toContain("s/^#PermitRootLogin prohibit-password$/PermitRootLogin yes/");
    expect(lxcSshInput(true).endsWith("\r")).toBe(true);
  });

  it("restores the stock commented lines", () => {
    expect(LXC_SSH_DISABLE_LINE).toContain("s/^Port 22$/#Port 22/");
    expect(LXC_SSH_DISABLE_LINE).toContain("s/^PermitRootLogin yes$/#PermitRootLogin prohibit-password/");
    expect(lxcSshInput(false).startsWith(LXC_SSH_DISABLE_LINE)).toBe(true);
  });
});
