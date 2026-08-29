export const VM_SCSI_CONTROLLERS = [
  { id: "virtio-scsi-single", labelKey: "create.scsihwSingle" },
  { id: "virtio-scsi", labelKey: "create.scsihwMulti" },
] as const;

export const VM_DISK_BUSES = ["scsi", "virtio", "sata"] as const;

export type VmDiskStorage = {
  storage: string;
  type?: string;
  content?: string;
  active?: number;
  enabled?: number;
  avail?: number;
  total?: number;
};

export function storageIsIscsi(storage: Pick<VmDiskStorage, "type">): boolean {
  const type = String(storage.type ?? "").toLowerCase();
  return type === "iscsi" || type === "iscsidirect";
}

export function storageHoldsVmImages(storage: VmDiskStorage): boolean {
  if (storage.enabled === 0 || storage.active === 0) return false;
  const content = String(storage.content ?? "").toLowerCase();
  if (content.split(/[,\s]+/).includes("images")) return true;
  return storageIsIscsi(storage);
}

export function vmDiskStorages<T extends VmDiskStorage>(list: T[]): T[] {
  return list.filter(storageHoldsVmImages);
}

export function vmDiskSpec(input: {
  diskStorage: string;
  diskSize?: string;
  diskVolume?: string;
  extras?: string[];
}): string {
  const extra = input.extras?.length ? `,${input.extras.join(",")}` : "";
  const volume = input.diskVolume?.trim();
  if (volume) return `${volume}${extra}`;
  const size = String(input.diskSize ?? "").trim() || "32";
  return `${input.diskStorage}:${size}${extra}`;
}

export function diskExtras(input: {
  cache?: string;
  discard?: boolean;
  ssd?: boolean;
  iothread?: boolean;
  diskBus?: string;
  scsihw?: string;
}): string[] {
  const extras: string[] = [];
  if (input.cache) extras.push(`cache=${input.cache}`);
  if (input.discard) extras.push("discard=on");
  if (input.ssd) extras.push("ssd=1");
  const bus = input.diskBus ?? "scsi";
  const scsihw = input.scsihw ?? "virtio-scsi-single";
  const iothread =
    input.iothread ?? (bus === "scsi" && scsihw === "virtio-scsi-single");
  if (iothread && (bus === "scsi" || bus === "virtio")) extras.push("iothread=1");
  return extras;
}
