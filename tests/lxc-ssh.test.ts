import { describe, expect, it } from "vitest";
import { LXC_SSH_DISABLE_LINE, LXC_SSH_ENABLE_LINE, lxcShellPrompt, lxcSshInput, lxcSshStateFromOutput } from "@/lib/lxc-ssh";

describe("lxc ssh toggle", () => {
  it("uncomments port 22 and allows root login", () => {
    expect(LXC_SSH_ENABLE_LINE).toContain("s/^#Port 22$/Port 22/");
    expect(LXC_SSH_ENABLE_LINE).toContain("s/^#PermitRootLogin prohibit-password$/PermitRootLogin yes/");
    expect(LXC_SSH_ENABLE_LINE).toContain("install -d -m 0755 /run/sshd");
    expect(LXC_SSH_ENABLE_LINE).toContain("systemctl is-active --quiet ssh");
    expect(LXC_SSH_ENABLE_LINE).not.toContain("&& systemctl reload ssh");
    expect(lxcSshInput(true).endsWith("\r")).toBe(true);
  });

  it("restores the stock commented lines", () => {
    expect(LXC_SSH_DISABLE_LINE).toContain("s/^Port 22$/#Port 22/");
    expect(LXC_SSH_DISABLE_LINE).toContain("s/^PermitRootLogin yes$/#PermitRootLogin prohibit-password/");
    expect(lxcSshInput(false).startsWith(LXC_SSH_DISABLE_LINE)).toBe(true);
  });

  it("reads the last marker from the shell", () => {
    expect(lxcSshStateFromOutput("PROXORA_SSH:0\r\n")).toBe(false);
    expect(lxcSshStateFromOutput("PROXORA_SSH:0\nPROXORA_SSH:1\n")).toBe(true);
    expect(lxcSshStateFromOutput("printf 'PROXORA_SSH:%s\\n' \"$(printf 0)\"\r\nPROXORA_SSH:1\r\n")).toBe(true);
    expect(lxcSshStateFromOutput("root@colibri:~# ")).toBeNull();
    expect(lxcShellPrompt("root@colibri:~# ")).toBe(true);
    expect(lxcShellPrompt("colibri login: ")).toBe(false);
  });
});
