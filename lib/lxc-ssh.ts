/**
 * Debian LXC often activates ssh via ssh.socket. Reloading an inactive ssh.service
 * fails even when the config is valid, so only reload when the service is running.
 */
export const LXC_SSH_APPLY =
  "/usr/sbin/sshd -t && if systemctl is-active --quiet ssh; then systemctl reload ssh; fi";

/** Typed into an open root shell. Uncommented PermitRootLogin yes, otherwise sshd keeps the default. */
export const LXC_SSH_ENABLE_LINE =
  `sed -i -e 's/^#Port 22$/Port 22/' -e 's/^#PermitRootLogin prohibit-password$/PermitRootLogin yes/' /etc/ssh/sshd_config && ${LXC_SSH_APPLY}`;

export const LXC_SSH_DISABLE_LINE =
  `sed -i -e 's/^Port 22$/#Port 22/' -e 's/^PermitRootLogin yes$/#PermitRootLogin prohibit-password/' /etc/ssh/sshd_config && ${LXC_SSH_APPLY}`;

export const LXC_SSH_MARKER = "PROXORA_SSH:";

/** Prints a single PROXORA_SSH:0 or :1 line. The command text itself contains neither, so the shell echo cannot flip the button. */
export const LXC_SSH_PROBE_LINE =
  `printf '${LXC_SSH_MARKER}%s\\n' "$(grep -q '^PermitRootLogin yes$' /etc/ssh/sshd_config && printf 1 || printf 0)"`;

export function lxcSshInput(turnOn: boolean): string {
  return `${turnOn ? LXC_SSH_ENABLE_LINE : LXC_SSH_DISABLE_LINE}; ${LXC_SSH_PROBE_LINE}\r`;
}

export function lxcSshProbeInput(): string {
  return `${LXC_SSH_PROBE_LINE}\r`;
}

export function lxcSshStateFromOutput(text: string): boolean | null {
  const matches = text.match(/(?:^|[\r\n])PROXORA_SSH:([01])/g);
  const last = matches?.at(-1);
  if (!last) return null;
  return last.endsWith("1");
}

export function lxcShellPrompt(line: string): boolean {
  return /[#$>]\s*$/.test(line);
}
