import { describe, expect, it } from "vitest";
import { isHostTransportFailure, ProxmoxApiError, ValidationError } from "@/lib/errors";
import {
  isSshdConfigRootLoginEnabled,
  lxcSshRootSetScript,
  lxcSshRootStatusScript,
  parseLxcExecPayload,
  parseLxcSshRootStatus,
  parseSshdPermitRootLoginLine,
  wrapLxcTermScript,
} from "@/lib/lxc-ssh-root";

const DEBIAN_SSHD_CONFIG = `# This is the sshd server system-wide configuration file.  See
# sshd_config(5) for more information.

# This sshd was compiled with PATH=/usr/local/bin:/usr/bin:/bin:/usr/games

Include /etc/ssh/sshd_config.d/*.conf

Port 22
#AddressFamily any
#ListenAddress 0.0.0.0
#ListenAddress ::

# Authentication:

#LoginGraceTime 2m
PermitRootLogin yes
#StrictModes yes
#MaxAuthTries 6
#MaxSessions 10

#PubkeyAuthentication yes
#PasswordAuthentication yes
#PermitEmptyPasswords no

KbdInteractiveAuthentication no
UsePAM yes
X11Forwarding yes
PrintMotd no
AcceptEnv LANG LC_* COLORTERM NO_COLOR
Subsystem       sftp    /usr/lib/openssh/sftp-server
`;

describe("LXC root SSH", () => {
  it("detects uncommented PermitRootLogin vs #PermitRootLogin", () => {
    expect(parseSshdPermitRootLoginLine("PermitRootLogin yes")).toEqual({ commented: false, value: "yes" });
    expect(parseSshdPermitRootLoginLine("  PermitRootLogin yes")).toEqual({ commented: false, value: "yes" });
    expect(parseSshdPermitRootLoginLine("PermitRootLogin\tyes")).toEqual({ commented: false, value: "yes" });
    expect(parseSshdPermitRootLoginLine("#PermitRootLogin prohibit-password")).toEqual({
      commented: true,
      value: "prohibit-password",
    });
    expect(parseSshdPermitRootLoginLine("# PermitRootLogin yes")).toEqual({ commented: true, value: "yes" });
    expect(parseSshdPermitRootLoginLine("#MaxAuthTries 6")).toBeNull();
    expect(isSshdConfigRootLoginEnabled(DEBIAN_SSHD_CONFIG)).toBe(true);
    expect(isSshdConfigRootLoginEnabled(DEBIAN_SSHD_CONFIG.replace("PermitRootLogin yes", "#PermitRootLogin yes"))).toBe(
      false,
    );
    expect(isSshdConfigRootLoginEnabled(DEBIAN_SSHD_CONFIG.replace("PermitRootLogin yes", "PermitRootLogin no"))).toBe(
      false,
    );
    expect(
      isSshdConfigRootLoginEnabled("#PermitRootLogin prohibit-password\n#LoginGraceTime 2m\n"),
    ).toBe(false);
    expect(isSshdConfigRootLoginEnabled("#PermitRootLogin prohibit-password\nPermitRootLogin yes\n")).toBe(true);
  });

  it("parses sshd_config dumped from the container as status", () => {
    expect(parseLxcSshRootStatus(DEBIAN_SSHD_CONFIG)).toEqual({
      running: true,
      permitRootLogin: "yes",
      enabled: true,
    });
    expect(parseLxcSshRootStatus("#PermitRootLogin yes\nPort 22\n").enabled).toBe(false);
  });

  it("extracts stdout between termproxy markers", () => {
    const raw = "\u001b[0mOK\r\necho start\n__PXR_B_ab__\nPermitRootLogin yes\n__PXR_E_ab__:0\n";
    expect(parseLxcExecPayload(raw, "__PXR_B_ab__", "__PXR_E_ab__")).toEqual({
      stdout: "PermitRootLogin yes",
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

  it("reads sshd_config and comments or uncomments PermitRootLogin", () => {
    const on = lxcSshRootSetScript(true);
    const off = lxcSshRootSetScript(false);
    const status = lxcSshRootStatusScript();
    expect(status).toContain("cat /etc/ssh/sshd_config");
    expect(on).toContain("PermitRootLogin yes");
    expect(on).toContain("#[[:space:]]*PermitRootLogin");
    expect(on).toContain("/etc/ssh/sshd_config");
    expect(off).toContain("#PermitRootLogin");
    expect(off).toContain("systemctl restart ssh");
  });

  it("does not treat console validation errors as a dead host", () => {
    expect(isHostTransportFailure(new ValidationError("Zeitüberschreitung in der Container-Konsole"))).toBe(false);
    expect(isHostTransportFailure(new ProxmoxApiError("Connection failed", 503))).toBe(true);
  });
});
