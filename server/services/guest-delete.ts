import { ForbiddenError, ProxmoxApiError, ValidationError } from "@/lib/errors";
import { assertGuestBackupVolids, guestNeedsStopForRestore, parseBackupVolid, waitUntilGuestStopped } from "@/lib/backup";
import { TASK_TIMEOUT, waitUpid } from "@/server/proxmox/task-wait";
import type { ProxmoxClient } from "@/server/proxmox/client";

async function guestStatus(
  client: ProxmoxClient,
  kind: "vm" | "lxc",
  node: string,
  vmid: number,
): Promise<string | null> {
  try {
    const rec = kind === "lxc" ? await client.lxc.status(node, vmid) : await client.vms.status(node, vmid);
    return String(rec.status ?? "");
  } catch {
    return null;
  }
}

export async function shutdownThenDeleteGuest(
  client: ProxmoxClient,
  input: {
    kind: "vm" | "lxc";
    node: string;
    vmid: number;
    backupVolids?: string[];
    canDeleteBackups: boolean;
  },
) {
  let backups: string[];
  try {
    backups = assertGuestBackupVolids(input.backupVolids ?? [], input.vmid, input.kind);
  } catch (error) {
    throw new ValidationError(error instanceof Error ? error.message : "Ungültige Backup-Auswahl");
  }
  if (backups.length && !input.canDeleteBackups) throw new ForbiddenError();

  const api = input.kind === "lxc" ? client.lxc : client.vms;
  const status = await guestStatus(client, input.kind, input.node, input.vmid);
  if (guestNeedsStopForRestore(status)) {
    try {
      const upid = await api.shutdown(input.node, input.vmid);
      await waitUpid(client, input.node, upid, TASK_TIMEOUT.start);
    } catch {
      /* already stopping or ACPI ignored */
    }
    let stopped = await waitUntilGuestStopped(
      () => guestStatus(client, input.kind, input.node, input.vmid),
      { timeoutMs: 60_000 },
    );
    if (!stopped) {
      try {
        const upid = await api.stop(input.node, input.vmid);
        await waitUpid(client, input.node, upid, TASK_TIMEOUT.stop);
      } catch {
        /* poll below */
      }
      stopped = await waitUntilGuestStopped(
        () => guestStatus(client, input.kind, input.node, input.vmid),
        { timeoutMs: 45_000 },
      );
    }
    if (!stopped) throw new ProxmoxApiError("Gast ließ sich nicht herunterfahren", 504);
  }

  const deleteUpid = await api.delete(input.node, input.vmid, true);
  await waitUpid(client, input.node, deleteUpid, TASK_TIMEOUT.delete);

  for (const volid of backups) {
    const parsed = parseBackupVolid(volid);
    await client.storage.deleteContent(input.node, parsed.storage, parsed.volume);
  }
  return deleteUpid;
}
