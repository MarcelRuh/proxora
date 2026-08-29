import { taskTypeLabel } from "@/lib/proxmox-tasks";

export type BackupTaskLike = {
  type?: string;
  status?: string;
  exitstatus?: string;
  upid?: string;
  id?: string;
  node?: string;
};

const GUEST_FAIL_TASK_TYPES = new Set([
  "qmstart",
  "qmstop",
  "qmshutdown",
  "qmreboot",
  "qmreset",
  "qmpause",
  "qmresume",
  "qmsuspend",
  "qmsnapshot",
  "qmdelsnapshot",
  "qmrollback",
  "vzstart",
  "vzstop",
  "vzshutdown",
  "vzreboot",
  "vzsuspend",
  "vzsnapshot",
  "vzdelsnapshot",
  "vzrollback",
]);

export function isFailedTaskExit(task: BackupTaskLike): boolean {
  if (task.status && task.status !== "stopped") return false;
  const exit = (task.exitstatus ?? "").trim();
  return Boolean(exit) && exit !== "OK";
}

export function failedTaskKind(task: BackupTaskLike): "backup" | "guest" | null {
  if (!isFailedTaskExit(task)) return null;
  const type = task.type ?? "";
  if (type === "vzdump") return "backup";
  if (GUEST_FAIL_TASK_TYPES.has(type)) return "guest";
  return null;
}

export function isVzdumpTask(task: BackupTaskLike): boolean {
  return task.type === "vzdump";
}

export function isFailedBackupTask(task: BackupTaskLike): boolean {
  return failedTaskKind(task) === "backup";
}

export function guestTaskLabel(type: string | undefined): string {
  return taskTypeLabel(type, "de");
}

export function backupTaskGuestId(task: BackupTaskLike): string | undefined {
  const id = String(task.id ?? "").trim();
  return id || undefined;
}

export const GUEST_TASK_NOTIFY_ACTIONS = new Set([
  "start",
  "stop",
  "shutdown",
  "reboot",
  "reset",
  "pause",
  "resume",
  "snapshot",
  "snapshot-delete",
  "snapshot-rollback",
]);
