import type { Guest } from "@/lib/types";

export type BulkGuestAction = "start" | "shutdown" | "reboot" | "stop";

export function guestRowKey(guest: Pick<Guest, "vmid" | "node"> & { hostId?: string; kind?: "vm" | "lxc" }, kind: "vm" | "lxc"): string {
  return `${kind}:${guest.hostId ?? ""}:${guest.node}:${guest.vmid}`;
}

export function bulkActionFits(guest: Pick<Guest, "status">, action: BulkGuestAction): boolean {
  if (action === "start") return guest.status === "stopped";
  if (action === "shutdown" || action === "reboot") return guest.status === "running";
  if (action === "stop") return guest.status !== "stopped";
  return false;
}
