import { describe, expect, it } from "vitest";
import {
  isLxcRootSshEnabled,
  lxcSshRootSetScript,
  lxcSshRootStatusScript,
  parseLxcExecPayload,
  parseLxcSshRootStatus,
} from "@/lib/lxc-ssh-root";

describe("LXC root SSH", () => {
  it("treats yes and key-only variants as enabled", () => {
    expect(isLxcRootSshEnabled("yes")).toBe(true);
    expect(isLxcRootSshEnabled("Without-Password")).toBe(true);
    expect(isLxcRootSshEnabled("prohibit-password")).toBe(true);
    expect(isLxcRootSshEnabled("no")).toBe(false);
    expect(isLxcRootSshEnabled("forced-commands-only")).toBe(false);
    expect(isLxcRootSshEnabled("unknown")).toBe(false);
  });

  it("parses sshd status JSON from noisy console output", () => {
    const parsed = parseLxcSshRootStatus('junk\n{"running":1,"permitRootLogin":"yes"}\n');
    expect(parsed).toEqual({ running: true, permitRootLogin: "yes", enabled: true });
    expect(parseLxcSshRootStatus('{"running":0,"permitRootLogin":"no"}').enabled).toBe(false);
  });

  it("extracts stdout between termproxy markers", () => {
    const raw = "\u001b[0mOK\r\necho start\n__PXR_B_ab__\n{\"running\":1,\"permitRootLogin\":\"no\"}\n__PXR_E_ab__:0\n";
    expect(parseLxcExecPayload(raw, "__PXR_B_ab__", "__PXR_E_ab__")).toEqual({
      stdout: '{"running":1,"permitRootLogin":"no"}',
      exitCode: 0,
    });
  });

  it("ignores echoed commands that contain the markers inline", () => {
    const raw = [
      "echo __PXR_B_ab__; echo b64 | base64 -d | sh; echo __PXR_E_ab__:$?",
      "__PXR_B_ab__",
      "NO_SSHD",
      "__PXR_E_ab__:2",
      "",
    ].join("\n");
    expect(parseLxcExecPayload(raw, "__PXR_B_ab__", "__PXR_E_ab__")).toEqual({
      stdout: "NO_SSHD",
      exitCode: 2,
    });
  });

  it("writes PermitRootLogin and fails without sshd", () => {
    const on = lxcSshRootSetScript(true);
    const off = lxcSshRootSetScript(false);
    expect(on).toContain("PermitRootLogin yes");
    expect(on).toContain("echo NO_SSHD");
    expect(on).toContain("systemctl enable ssh");
    expect(off).toContain("PermitRootLogin no");
    expect(off).not.toContain("PermitRootLogin yes");
    expect(lxcSshRootStatusScript()).toContain("permitrootlogin");
  });
});
