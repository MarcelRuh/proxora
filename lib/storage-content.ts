import { parseBackupVolid } from "@/lib/backup";
import { storageContentVolid, volidFilename } from "@/lib/lxc-templates";
import { configVolumeRole, type VolumeUseRole } from "@/lib/volume-usage";

export type StorageContentKind = "iso" | "vztmpl" | "images" | "rootdir" | "backup" | "snippets" | "other";

export type StorageContentItem = {
  volid: string;
  filename: string;
  content: StorageContentKind;
  size: number;
  ctime: number;
  vmid: number | null;
  format?: string;
  usage: VolumeUseRole;
  guestName?: string;
  guestKind?: "vm" | "lxc";
};

export type StorageContentFilter = {
  query: string;
  content: StorageContentKind | "all" | "unused";
};

const KNOWN_CONTENT = new Set<StorageContentKind>(["iso", "vztmpl", "images", "rootdir", "backup", "snippets"]);

export function storageContentKind(row: Record<string, unknown>): StorageContentKind {
  const raw = String(row.content ?? "").toLowerCase().split(",")[0]?.trim() ?? "";
  if (KNOWN_CONTENT.has(raw as StorageContentKind)) return raw as StorageContentKind;
  const volid = storageContentVolid(row).toLowerCase();
  if (volid.includes("/iso/") || volid.includes(":iso/")) return "iso";
  if (volid.includes("vztmpl")) return "vztmpl";
  if (volid.includes("backup") || /vzdump-/i.test(volid)) return "backup";
  if (volid.includes("snippets")) return "snippets";
  if (volid.includes("rootdir") || volid.includes("subvol-")) return "rootdir";
  if (volid.includes("vm-") || volid.includes("base-")) return "images";
  return "other";
}

export function normalizeStorageContentRow(row: Record<string, unknown>): StorageContentItem | null {
  const volid = storageContentVolid(row);
  if (!volid) return null;
  const parsed = parseBackupVolid(volid);
  const vmidRaw = Number(row.vmid);
  const vmid = Number.isFinite(vmidRaw) && vmidRaw > 0 ? vmidRaw : parsed.vmid;
  const ctimeRaw = Number(row.ctime);
  return {
    volid,
    filename: parsed.filename || volidFilename(volid),
    content: storageContentKind(row),
    size: Number(row.size) || 0,
    ctime: Number.isFinite(ctimeRaw) && ctimeRaw > 0 ? (ctimeRaw > 1e12 ? ctimeRaw : ctimeRaw * 1000) : 0,
    vmid,
    format: String(row.format ?? "").trim() || undefined,
    usage: "none",
  };
}

export function applyVolumeUsage(
  item: StorageContentItem,
  config: Record<string, unknown> | null | undefined,
  guest?: { name?: string; kind?: "vm" | "lxc" },
): StorageContentItem {
  return {
    ...item,
    usage: config ? configVolumeRole(config, item.volid) : item.usage,
    guestName: guest?.name || item.guestName,
    guestKind: guest?.kind || item.guestKind,
  };
}

export function filterStorageContent<T extends StorageContentItem>(items: T[], filter: StorageContentFilter): T[] {
  const q = filter.query.trim().toLowerCase();
  return items.filter((item) => {
    if (filter.content === "unused") {
      if (item.usage !== "unused") return false;
    } else if (filter.content !== "all" && item.content !== filter.content) {
      return false;
    }
    if (!q) return true;
    const hay = [item.filename, item.volid, item.content, item.guestName, item.vmid ? String(item.vmid) : ""]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();
    return hay.includes(q);
  });
}

export function storageContentDeletePermission(content: StorageContentKind): "backup.delete" | "storage.delete" {
  return content === "backup" ? "backup.delete" : "storage.delete";
}
