export type BackupTaskLike = {
  type?: string;
  status?: string;
  exitstatus?: string;
  upid?: string;
  id?: string;
  node?: string;
};

export function isVzdumpTask(task: BackupTaskLike): boolean {
  return task.type === "vzdump";
}

export function isFailedBackupTask(task: BackupTaskLike): boolean {
  if (!isVzdumpTask(task)) return false;
  if (task.status && task.status !== "stopped") return false;
  const exit = (task.exitstatus ?? "").trim();
  return Boolean(exit) && exit !== "OK";
}

export function backupTaskGuestId(task: BackupTaskLike): string | undefined {
  const id = String(task.id ?? "").trim();
  return id || undefined;
}
