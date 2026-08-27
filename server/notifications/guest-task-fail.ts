import { GUEST_TASK_NOTIFY_ACTIONS, guestTaskLabel } from "@/lib/backup-tasks";
import { notifyTopic } from "@/server/notifications/dispatch";
import { rememberNotifiedUpid } from "@/server/services/backup-watch";

export function notifyGuestTaskFailed(input: {
  kind: "vm" | "lxc";
  action: string;
  vmid: number;
  name?: string;
  hostId: string;
  hostName: string;
  node: string;
  error: unknown;
  upid?: unknown;
}) {
  if (!GUEST_TASK_NOTIFY_ACTIONS.has(input.action)) return;
  if (typeof input.upid === "string") rememberNotifiedUpid(input.upid);
  const label = guestTaskLabel(input.action);
  const kindLabel = input.kind === "vm" ? "VM" : "LXC";
  const who = input.name ? `${kindLabel} ${input.vmid} (${input.name})` : `${kindLabel} ${input.vmid}`;
  const reason = input.error instanceof Error ? input.error.message : "unbekannt";
  notifyTopic("task.failed", {
    level: "error",
    title: `${label} fehlgeschlagen`,
    message: `${who} — ${reason}`,
    hostId: input.hostId,
    name: input.name ?? `${kindLabel} ${input.vmid}`,
    id: String(input.vmid),
    host: input.hostName,
    node: input.node,
  });
}
