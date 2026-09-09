import { describe, expect, it } from "vitest";
import { isHostTransportFailure, ProxmoxApiError, ValidationError } from "@/lib/errors";
import {
  isLxcRootSshEnabled,
  isSshdConfigRootLoginYes,
  lxcSshRootSetScript,
  lxcSshRootStatusScript,
  parseLxcExecPayload,
  parseLxcSshRootStatus,
  wrapLxcTermScript,
} from "@/lib/lxc-ssh-root";

const DEBIAN_SSHD_CONFIG = `
# This is the sshd server system-wide configuration file.  See
# sshd_config(5) for more information.

Include /etc/ssh/sshd_config.d/*.conf

Port 22
#LoginGraceTime 2m
PermitRootLogin yes
#StrictModes yes
#PasswordAuthentication yes
KbdInteractiveAuthentication no
UsePAM yes
`;

describe("LXC root SSH", () => {
  it("treats only uncommented PermitRootLogin yes as enabled", () => {
    expect(isLxcRootSshEnabled("yes")).toBe(true);
    expect(isLxcRootSshEnabled("Without-Password")).toBe(false);
    expect(isLxcRootSshEnabled("prohibit-password")).toBe(false);
    expect(isLxcRootSshEnabled("no")).toBe(false);
    expect(isSshdConfigRootLoginYes(DEBIAN_SSHD_CONFIG)).toBe(true);
    expect(isSshdConfigRootLoginYes(DEBIAN_SSHD_CONFIG.replace("PermitRootLogin yes", "#PermitRootLogin yes"))).toBe(
      false,
    );
    expect(isSshdConfigRootLoginYes(DEBIAN_SSHD_CONFIG.replace("PermitRootLogin yes", "PermitRootLogin no"))).toBe(
      false,
    );
  });

  it("parses sshd status JSON from noisy console output", () => {
    const parsed = parseLxcSshRootStatus('junk\n{"running":1,"permitRootLogin":"yes"}\n');
    expect(parsed).toEqual({ running: true, permitRootLogin: "yes", enabled: true });
    expect(parseLxcSshRootStatus('{"running":1,"permitRootLogin":"no"}').enabled).toBe(false);
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

  it("keeps a heredoc wrapper around the guest script", () => {
    const wrapped = wrapLxcTermScript("echo hi\n", "__PXR_B_ab__", "__PXR_E_ab__");
    expect(wrapped).toContain("sh <<'PXR_SH'");
    expect(wrapped).toContain("echo hi");
  });

  it("reads and writes /etc/ssh/sshd_config PermitRootLogin", () => {
    const on = lxcSshRootSetScript(true);
    const off = lxcSshRootSetScript(false);
    const status = lxcSshRootStatusScript();
    expect(status).toContain("/etc/ssh/sshd_config");
    expect(status).toContain("PermitRootLogin[[:space:]]+yes");
    expect(on).toContain("PermitRootLogin yes");
    expect(on).toContain("sed -i");
    expect(on).toContain("/etc/ssh/sshd_config");
    expect(on).toContain("99-proxora-root.conf");
    expect(off).toContain("PermitRootLogin no");
    expect(off).toContain("systemctl restart ssh");
    expect(off).not.toContain("PermitRootLogin yes");
  });

  it("does not treat console validation errors as a dead host", () => {
    expect(isHostTransportFailure(new ValidationError("Zeitüberschreitung in der Container-Konsole"))).toBe(false);
    expect(isHostTransportFailure(new ProxmoxApiError("Connection failed", 503))).toBe(true);
  });
});
