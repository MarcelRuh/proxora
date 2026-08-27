export type BackupJob = {
  id: string;
  enabled: boolean;
  schedule: string;
  storage: string;
  mode: string;
  compress: string;
  all: boolean;
  vmid: string;
  node: string;
  prune: string;
  keepLast: number | null;
};

export type BackupFile = {
  volid: string;
  node: string;
  storage: string;
  vmid: number | null;
  kind: "vm" | "lxc" | "unknown";
  size: number;
  ctime: number;
  notes?: string;
  format?: string;
};

export type BackupGuest = { vmid: number; name: string; kind: "vm" | "lxc"; node: string };

export type BackupOverview = {
  nodes: string[];
  primaryNode: string;
  backupStorages: string[];
  diskStorages: string[];
  jobs: BackupJob[];
  files: BackupFile[];
  guests: BackupGuest[];
};

export const SELECT_CLASS =
  "mt-1 h-9 w-full rounded-[4px] border border-input bg-white/[0.03] px-2 text-sm";
