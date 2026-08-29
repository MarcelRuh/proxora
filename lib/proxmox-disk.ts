export type ParsedDiskSpec = {
  volume: string;
  sizeGiB: number | null;
  rest: string[];
};

const SIZE_RE = /^([\d.]+)\s*([KMGT])B?$/i;

export function sizeToGiB(raw: string): number | null {
  const text = String(raw ?? "").trim();
  if (!text) return null;
  const match = SIZE_RE.exec(text) ?? /^([\d.]+)$/.exec(text);
  if (!match) return null;
  const n = Number(match[1]);
  if (!Number.isFinite(n) || n < 0) return null;
  const unit = (match[2] ?? "G").toUpperCase();
  if (unit === "K") return n / (1024 * 1024);
  if (unit === "M") return n / 1024;
  if (unit === "T") return n * 1024;
  return n;
}

export function formatDiskGiB(sizeGiB: number): string {
  const rounded = Math.round(sizeGiB * 1000) / 1000;
  return `${rounded}G`;
}

export function parseDiskSpec(raw: string): ParsedDiskSpec {
  const parts = String(raw ?? "")
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
  const volume = parts[0] ?? "";
  const rest = parts.slice(1);
  const sizePart = rest.find((part) => part.toLowerCase().startsWith("size="));
  let sizeRaw = sizePart ? sizePart.slice(sizePart.indexOf("=") + 1) : "";
  if (!sizeRaw) {
    const bare = /^[^:]+:(\d+(?:\.\d+)?)$/.exec(volume);
    if (bare?.[1]) sizeRaw = `${bare[1]}G`;
  }
  return { volume, sizeGiB: sizeRaw ? sizeToGiB(sizeRaw) : null, rest };
}

export function setDiskSize(raw: string, sizeGiB: number): string {
  const { volume, rest } = parseDiskSpec(raw);
  const size = `size=${formatDiskGiB(sizeGiB)}`;
  const others = rest.filter((part) => !part.toLowerCase().startsWith("size="));
  return [volume, size, ...others].join(",");
}

export function isCdromDisk(raw: string): boolean {
  return /(?:^|,)media=cdrom(?:,|$)/i.test(raw);
}

export function canResizeDisk(key: string, raw: string): boolean {
  if (isCdromDisk(raw)) return false;
  if (/^(efidisk|tpmstate)/i.test(key)) return false;
  return parseDiskSpec(raw).sizeGiB != null;
}

export function diskSizeDeltaGiB(before: string, after: string): number | null {
  const oldSize = parseDiskSpec(before).sizeGiB;
  const nextSize = parseDiskSpec(after).sizeGiB;
  if (oldSize == null || nextSize == null) return null;
  return nextSize - oldSize;
}

export function isResizeDiskKey(key: string): boolean {
  return key === "rootfs" || /^(scsi|sata|virtio|ide|unused|mp)\d+$/.test(key);
}
