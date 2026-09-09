import { describe, expect, it } from "vitest";
import { isHostTransportFailure, ProxmoxApiError, ValidationError } from "@/lib/errors";
import {
  isLxcRootSshEnabled,
  lxcSshRootSetScript,
  lxcSshRootStatusScript,
  parseLxcExecPayload,
  parseLxcSshRootStatus,
  wrapLxcTermScript,
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

  it("keeps termproxy payload lines short enough not to wrap", () => {
    const b64 = "A".repeat(200);
    const wrapped = wrapLxcTermScript(b64, "__PXR_B_ab__", "__PXR_E_ab__");
    for (const line of wrapped.split("\n")) {
      expect(line.length).toBeLessThanOrEqual(80);
    }
    expect(wrapped).toContain("printf '%s' \"$B64\" | base64 -d | sh");
  });

  it("writes PermitRootLogin and restarts sshd on both enable and disable", () => {
    const on = lxcSshRootSetScript(true);
    const off = lxcSshRootSetScript(false);
    expect(on).toContain("PermitRootLogin yes");
    expect(on).toContain("echo NO_SSHD");
    expect(on).toContain("systemctl restart ssh");
    expect(off).toContain("PermitRootLogin no");
    expect(off).toContain("systemctl restart ssh");
    expect(off).not.toContain("PermitRootLogin yes");
    expect(lxcSshRootStatusScript()).toContain("99-proxora-root.conf");
  });

  it("does not treat console validation errors as a dead host", () => {
    expect(isHostTransportFailure(new ValidationError("Zeitüberschreitung in der Container-Konsole"))).toBe(false);
    expect(isHostTransportFailure(new ProxmoxApiError("Connection failed", 503))).toBe(true);
  });
});
