import { HostOrigin } from "@prisma/client";
import { ValidationError } from "@/lib/errors";
import {
  lxcSshRootSetScript,
  lxcSshRootStatusScript,
  parseLxcSshRootStatus,
} from "@/lib/lxc-ssh-root";
import type { ProxmoxClient } from "@/server/proxmox/client";
import { execLxcScript } from "@/server/services/lxc-term-exec";
import type { Host } from "@prisma/client";

export type LxcSshRootStatus = {
  running: boolean;
  permitRootLogin: string;
  enabled: boolean;
  guestRunning: boolean;
};

function tlsRejectUnauthorized(host: Pick<Host, "allowInsecureTls" | "origin">): boolean {
  return host.origin !== HostOrigin.PEER && !host.allowInsecureTls;
}

async function assertRunning(
  client: ProxmoxClient,
  node: string,
  vmid: number,
): Promise<void> {
  const live = await client.lxc.status(node, vmid).catch(() => null);
  if (String(live?.status ?? "") !== "running") {
    throw new ValidationError("Container muss laufen");
  }
}

async function run(
  client: ProxmoxClient,
  host: Pick<Host, "allowInsecureTls" | "origin">,
  node: string,
  vmid: number,
  script: string,
  timeoutMs: number,
): Promise<LxcSshRootStatus> {
  await assertRunning(client, node, vmid);
  const result = await execLxcScript(client, {
    node,
    vmid,
    script,
    rejectUnauthorized: tlsRejectUnauthorized(host),
    timeoutMs,
  });
  if (result.exitCode === 2 || /\bNO_SSHD(?:_CONFIG)?\b/.test(result.stdout)) {
    throw new ValidationError("sshd ist im Container nicht installiert");
  }
  if (result.exitCode !== 0) {
    throw new ValidationError(result.stdout.trim().slice(0, 200) || `Befehl fehlgeschlagen (${result.exitCode})`);
  }
  return { ...parseLxcSshRootStatus(result.stdout), guestRunning: true };
}

export async function readLxcSshRoot(
  client: ProxmoxClient,
  host: Pick<Host, "allowInsecureTls" | "origin">,
  node: string,
  vmid: number,
): Promise<LxcSshRootStatus> {
  const live = await client.lxc.status(node, vmid).catch(() => null);
  if (String(live?.status ?? "") !== "running") {
    return { running: false, permitRootLogin: "unknown", enabled: false, guestRunning: false };
  }
  return run(client, host, node, vmid, lxcSshRootStatusScript(), 12_000);
}

export function setLxcSshRoot(
  client: ProxmoxClient,
  host: Pick<Host, "allowInsecureTls" | "origin">,
  node: string,
  vmid: number,
  enabled: boolean,
) {
  return run(client, host, node, vmid, lxcSshRootSetScript(enabled), 35_000);
}
