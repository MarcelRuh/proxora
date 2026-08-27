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

const GUEST_TASK_LABELS: Record<string, string> = {
  qmstart: "VM-Start",
  qmstop: "VM-Stop",
  qmshutdown: "VM-Shutdown",
  qmreboot: "VM-Reboot",
  qmreset: "VM-Reset",
  qmpause: "VM-Pause",
  qmresume: "VM-Resume",
  qmsuspend: "VM-Pause",
  qmsnapshot: "VM-Snapshot",
  qmdelsnapshot: "VM-Snapshot löschen",
  qmrollback: "VM-Rollback",
  vzstart: "LXC-Start",
  vzstop: "LXC-Stop",
  vzshutdown: "LXC-Shutdown",
  vzreboot: "LXC-Reboot",
  vzsuspend: "LXC-Pause",
  vzsnapshot: "LXC-Snapshot",
  vzdelsnapshot: "LXC-Snapshot löschen",
  vzrollback: "LXC-Rollback",
  start: "Start",
  stop: "Stop",
  shutdown: "Shutdown",
  reboot: "Reboot",
  reset: "Reset",
  pause: "Pause",
  resume: "Resume",
  snapshot: "Snapshot",
  "snapshot-delete": "Snapshot löschen",
  "snapshot-rollback": "Rollback",
};

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
  if (!type) return "Task";
  return GUEST_TASK_LABELS[type] ?? type;
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
