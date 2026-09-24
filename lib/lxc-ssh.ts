/** Typed into an open root shell. Uncommented PermitRootLogin yes, otherwise sshd keeps the default. */
export const LXC_SSH_ENABLE_LINE =
  "sed -i -e 's/^#Port 22$/Port 22/' -e 's/^#PermitRootLogin prohibit-password$/PermitRootLogin yes/' /etc/ssh/sshd_config && systemctl reload ssh";

export const LXC_SSH_DISABLE_LINE =
  "sed -i -e 's/^Port 22$/#Port 22/' -e 's/^PermitRootLogin yes$/#PermitRootLogin prohibit-password/' /etc/ssh/sshd_config && systemctl reload ssh";

export function lxcSshInput(turnOn: boolean): string {
  return `${turnOn ? LXC_SSH_ENABLE_LINE : LXC_SSH_DISABLE_LINE}\r`;
}

export function lxcSshStorageKey(hostId: string, node: string, vmid: number | undefined): string {
  return `proxora-lxc-ssh:${hostId}:${node}:${vmid ?? ""}`;
}
