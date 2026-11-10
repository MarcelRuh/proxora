import { NotFoundError } from "@/lib/errors";
import type { AccessScope } from "@/lib/guest-scope";
import { canAccessVmid, isGuestScoped } from "@/lib/backup-scope";

export type ParsedUpid = {
  node: string;
  type: string;
  id: string;
  user: string;
  vmid: number | null;
  kind: "vm" | "lxc" | "unknown";
};

/** `UPID:node:pid:pstart:starttime:type:id:user@realm:` */
export function parseUpid(upid: string): ParsedUpid | null {
  const parts = upid.trim().split(":");
  if (parts.length < 9 || parts[0] !== "UPID" || !parts[1]) return null;
  const [, node, , , , type = "", id = "", user = ""] = parts;
  const vmid = /^\d+$/.test(id) ? Number(id) : null;
  const kind = /^qm/.test(type) ? "vm" : /^vz(?!dump)/.test(type) ? "lxc" : "unknown";
  return { node, type, id, user, vmid, kind };
}

function taskVmid(task: { upid?: unknown; id?: unknown; type?: unknown }): { vmid: number | null; kind: ParsedUpid["kind"] } {
  const parsed = typeof task.upid === "string" ? parseUpid(task.upid) : null;
  if (parsed) return parsed;
  const id = String(task.id ?? "").trim();
  const type = String(task.type ?? "");
  return {
    vmid: /^\d+$/.test(id) ? Number(id) : null,
    kind: /^qm/.test(type) ? "vm" : /^vz(?!dump)/.test(type) ? "lxc" : "unknown",
  };
}

/** Guest-scoped users only see tasks that belong to one of their guests; node tasks stay hidden. */
export function canAccessTask(
  user: AccessScope,
  hostId: string,
  task: { upid?: unknown; id?: unknown; type?: unknown },
): boolean {
  if (!isGuestScoped(user)) return true;
  const { vmid, kind } = taskVmid(task);
  return vmid != null && canAccessVmid(user, hostId, vmid, kind);
}

export function filterTasksForUser<T extends { upid?: unknown; id?: unknown; type?: unknown }>(
  user: AccessScope,
  hostId: string,
  tasks: T[],
): T[] {
  if (!isGuestScoped(user)) return tasks;
  return tasks.filter((task) => canAccessTask(user, hostId, task));
}

export function assertTaskAccess(user: AccessScope, hostId: string, node: string, upid: string) {
  if (!isGuestScoped(user)) return;
  const parsed = parseUpid(upid);
  if (!parsed || parsed.node !== node || !canAccessTask(user, hostId, { upid })) {
    throw new NotFoundError("Task not found");
  }
}
