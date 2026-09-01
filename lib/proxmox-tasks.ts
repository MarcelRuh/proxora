import type { Locale } from "@/lib/i18n/messages";

export type TaskKindGroup = "vm" | "lxc" | "backup" | "storage" | "system" | "other";
export type TaskRunState = "running" | "ok" | "failed";
export type TaskStatusFilter = "all" | TaskRunState;

export type TaskLike = {
  type?: string;
  status?: string;
  exitstatus?: string;
  id?: string;
  node?: string;
  user?: string;
  hostId?: string;
  guestName?: string;
  guestKind?: "vm" | "lxc";
};

const TASK_TYPE_LABELS: Record<string, { de: string; en: string }> = {
  qmstart: { de: "VM starten", en: "Start VM" },
  qmstop: { de: "VM stoppen", en: "Stop VM" },
  qmshutdown: { de: "VM herunterfahren", en: "Shut down VM" },
  qmreboot: { de: "VM neu starten", en: "Reboot VM" },
  qmreset: { de: "VM Reset", en: "Reset VM" },
  qmpause: { de: "VM pausieren", en: "Pause VM" },
  qmresume: { de: "VM fortsetzen", en: "Resume VM" },
  qmsuspend: { de: "VM pausieren", en: "Pause VM" },
  qmsnapshot: { de: "VM-Snapshot", en: "VM snapshot" },
  qmdelsnapshot: { de: "VM-Snapshot löschen", en: "Delete VM snapshot" },
  qmrollback: { de: "VM-Rollback", en: "VM rollback" },
  qmcreate: { de: "VM erstellen", en: "Create VM" },
  qmdestroy: { de: "VM löschen", en: "Delete VM" },
  qmclone: { de: "VM klonen", en: "Clone VM" },
  qmigrate: { de: "VM migrieren", en: "Migrate VM" },
  qmmove: { de: "VM-Disk verschieben", en: "Move VM disk" },
  qmrestore: { de: "VM wiederherstellen", en: "Restore VM" },
  qmpowestate: { de: "VM-Stromstatus", en: "VM power state" },
  resize: { de: "Disk vergrößern", en: "Resize disk" },
  vzstart: { de: "LXC starten", en: "Start container" },
  vzstop: { de: "LXC stoppen", en: "Stop container" },
  vzshutdown: { de: "LXC herunterfahren", en: "Shut down container" },
  vzreboot: { de: "LXC neu starten", en: "Reboot container" },
  vzsuspend: { de: "LXC pausieren", en: "Pause container" },
  vzsnapshot: { de: "LXC-Snapshot", en: "Container snapshot" },
  vzdelsnapshot: { de: "LXC-Snapshot löschen", en: "Delete container snapshot" },
  vzrollback: { de: "LXC-Rollback", en: "Container rollback" },
  vzcreate: { de: "LXC erstellen", en: "Create container" },
  vzdestroy: { de: "LXC löschen", en: "Delete container" },
  vzclone: { de: "LXC klonen", en: "Clone container" },
  vzrestore: { de: "LXC wiederherstellen", en: "Restore container" },
  vzdump: { de: "Backup", en: "Backup" },
  download: { de: "Download", en: "Download" },
  imgcopy: { de: "Image kopieren", en: "Copy image" },
  imgdel: { de: "Image löschen", en: "Delete image" },
  aptupdate: { de: "APT-Update", en: "APT update" },
  vncproxy: { de: "VNC-Proxy", en: "VNC proxy" },
  spiceproxy: { de: "SPICE-Proxy", en: "SPICE proxy" },
  vncshell: { de: "Shell", en: "Shell" },
  startall: { de: "Alle starten", en: "Start all" },
  stopall: { de: "Alle stoppen", en: "Stop all" },
  move_volume: { de: "Volume verschieben", en: "Move volume" },
  diskscan: { de: "Disk-Scan", en: "Disk scan" },
  start: { de: "Start", en: "Start" },
  stop: { de: "Stop", en: "Stop" },
  shutdown: { de: "Shutdown", en: "Shutdown" },
  reboot: { de: "Reboot", en: "Reboot" },
  reset: { de: "Reset", en: "Reset" },
  pause: { de: "Pause", en: "Pause" },
  resume: { de: "Fortsetzen", en: "Resume" },
  snapshot: { de: "Snapshot", en: "Snapshot" },
  "snapshot-delete": { de: "Snapshot löschen", en: "Delete snapshot" },
  "snapshot-rollback": { de: "Rollback", en: "Rollback" },
};

const BACKUP_TYPES = new Set(["vzdump", "qmrestore", "vzrestore"]);
const STORAGE_TYPES = new Set(["download", "imgcopy", "imgdel", "move_volume", "unknownimg"]);
const SYSTEM_TYPES = new Set(["aptupdate", "startall", "stopall", "clusterjoin", "diskscan"]);

export function taskTypeLabel(type: string | undefined, locale: Locale = "de"): string {
  if (!type) return locale === "en" ? "Task" : "Task";
  return TASK_TYPE_LABELS[type]?.[locale] ?? type;
}

export function taskKindGroup(type: string | undefined): TaskKindGroup {
  const raw = type ?? "";
  if (BACKUP_TYPES.has(raw)) return "backup";
  if (raw.startsWith("qm") || raw === "qmigrate") return "vm";
  if (raw.startsWith("vz")) return "lxc";
  if (STORAGE_TYPES.has(raw)) return "storage";
  if (SYSTEM_TYPES.has(raw)) return "system";
  return "other";
}

export function taskRunState(task: TaskLike): TaskRunState {
  const status = (task.status ?? "").trim();
  const exit = (task.exitstatus ?? "").trim();
  if (!status || status === "running") return "running";
  if (status === "OK") return "ok";
  if (status === "stopped") {
    if (!exit || exit === "OK") return "ok";
    return "failed";
  }
  return "failed";
}

export const TASKS_POLL_IDLE_MS = 30_000;
export const TASKS_POLL_ACTIVE_MS = 3_000;

export function tasksPollIntervalMs(tasks: TaskLike[] | undefined): number {
  if (!tasks?.length) return TASKS_POLL_IDLE_MS;
  return tasks.some((task) => taskRunState(task) === "running") ? TASKS_POLL_ACTIVE_MS : TASKS_POLL_IDLE_MS;
}

export function taskGuestId(task: TaskLike): string | undefined {
  const id = String(task.id ?? "").trim();
  return id || undefined;
}

export function taskGuestLabel(task: TaskLike): string {
  const id = taskGuestId(task);
  if (!id) return "";
  if (task.guestName && task.guestName !== id) return `${id} (${task.guestName})`;
  return id;
}

export function taskGuestHref(task: TaskLike): string | null {
  const hostId = task.hostId?.trim();
  const node = task.node?.trim();
  const vmid = Number(taskGuestId(task));
  if (!hostId || !node || !Number.isInteger(vmid) || vmid <= 0) return null;
  const group = taskKindGroup(task.type);
  const kind = task.guestKind ?? (group === "lxc" || group === "vm" ? group : null);
  if (!kind) return null;
  const base = kind === "lxc" ? "containers" : "vms";
  return `/${base}/${hostId}/${encodeURIComponent(node)}/${vmid}`;
}

export type TaskFilter = {
  hostId?: string;
  kind: TaskKindGroup | "all";
  status: TaskStatusFilter;
  type: string;
  query: string;
};

export function filterTasks<T extends TaskLike & { hostId?: string; type: string }>(
  tasks: T[],
  filter: TaskFilter,
): T[] {
  const q = filter.query.trim().toLowerCase();
  return tasks.filter((task) => {
    if (filter.hostId && task.hostId !== filter.hostId) return false;
    if (filter.kind !== "all" && taskKindGroup(task.type) !== filter.kind) return false;
    if (filter.status !== "all" && taskRunState(task) !== filter.status) return false;
    if (filter.type && filter.type !== "all" && task.type !== filter.type) return false;
    if (!q) return true;
    const hay = [task.type, taskTypeLabel(task.type, "de"), taskTypeLabel(task.type, "en"), task.id, task.guestName, task.node, task.user]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();
    return hay.includes(q);
  });
}
