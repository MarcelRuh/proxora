import { compareTemplateVersion, storageContentVolid, volidFilename } from "@/lib/lxc-templates";

export type IsoCatalogItem = {
  id: string;
  headline: string;
  section: string;
  filename: string;
  url: string;
  version: string;
};

export type IsoPackageRow = {
  key: string;
  headline: string;
  section: string;
  url: string;
  installedVersion: string;
  installedFilename: string;
  installedVolids: string[];
  latestVersion: string;
  latestFilename: string;
  updateAvailable: boolean;
};

/** Pinned VirtIO build — Proxmox flags 0.1.285 as problematic for Windows SCSI/Block. */
export const VIRTIO_WIN_CATALOG_ITEM: IsoCatalogItem = {
  id: "virtio-win-drivers",
  headline: "VirtIO Windows drivers",
  section: "windows",
  filename: "virtio-win-0.1.271.iso",
  url: "https://fedorapeople.org/groups/virt/virtio-win/direct-downloads/archive-virtio/virtio-win-0.1.271-1/virtio-win-0.1.271.iso",
  version: "0.1.271",
};

export const ISO_CATALOG: IsoCatalogItem[] = [
  {
    id: "debian-13-netinst-amd64",
    headline: "Debian 13 (Trixie) netinst",
    section: "linux",
    filename: "debian-13.6.0-amd64-netinst.iso",
    url: "https://cdimage.debian.org/debian-cd/current/amd64/iso-cd/debian-13.6.0-amd64-netinst.iso",
    version: "13.6.0",
  },
  {
    id: "ubuntu-24.04-server-amd64",
    headline: "Ubuntu 24.04 LTS Server",
    section: "linux",
    filename: "ubuntu-24.04.3-live-server-amd64.iso",
    url: "https://releases.ubuntu.com/24.04/ubuntu-24.04.3-live-server-amd64.iso",
    version: "24.04.3",
  },
  VIRTIO_WIN_CATALOG_ITEM,
];

export function isoVolid(storage: string, filename: string): string {
  return `${storage}:iso/${filename}`;
}

export function isIsoContentVolid(volid: string): boolean {
  const raw = volid.trim();
  if (!raw || raw.includes("..")) return false;
  const lower = raw.toLowerCase();
  if (!lower.includes(":iso/") && !lower.includes("/iso/")) return false;
  return /\.iso$/i.test(volidFilename(raw));
}

export function isIsoRow(row: Record<string, unknown>): boolean {
  const content = String(row.content ?? "").toLowerCase();
  const volid = storageContentVolid(row);
  if (content.includes("iso")) return true;
  if (volid.toLowerCase().includes(":iso/") || volid.toLowerCase().includes("/iso/")) return true;
  return /\.iso$/i.test(volidFilename(volid));
}

export function isoFamily(filename: string): string {
  const file = volidFilename(filename).toLowerCase();
  if (/^virtio[-_]?win/i.test(file)) return "virtio-win";
  const debian = /^(debian(?:-edu|-mac)?)-(\d+)(?:\.\d+)*-([^-]+)-netinst\.iso$/.exec(file);
  if (debian) return `${debian[1]}-${debian[2]}-${debian[3]}-netinst`;
  const ubuntu = /^(ubuntu)-(\d+\.\d+)(?:\.\d+)?-(live-server|desktop)-([^.]+)\.iso$/.exec(file);
  if (ubuntu) return `${ubuntu[1]}-${ubuntu[2]}-${ubuntu[3]}-${ubuntu[4]}`;
  return file.replace(/\.iso$/i, "") || file;
}

export function isVirtioIso(volid: string): boolean {
  return /virtio/i.test(volidFilename(volid));
}

/** Versions Proxmox flags as problematic for Windows VirtIO SCSI/Block. */
export const VIRTIO_KNOWN_BAD = new Set(["0.1.285"]);

export const VIRTIO_ARCHIVE_BASE =
  "https://fedorapeople.org/groups/virt/virtio-win/direct-downloads/archive-virtio";

export type VirtioArchiveRelease = {
  version: string;
  release: number;
  dir: string;
  filename: string;
  url: string;
};

export function virtioIsoVersion(volid: string): string | null {
  const match = /virtio[-_]?win[-_]?(\d+\.\d+\.\d+)/i.exec(volidFilename(volid));
  return match?.[1] ?? null;
}

export function isKnownBadVirtioVersion(version: string | null | undefined): boolean {
  return Boolean(version && VIRTIO_KNOWN_BAD.has(version));
}

export function isKnownBadVirtioIso(volid: string): boolean {
  return isKnownBadVirtioVersion(virtioIsoVersion(volid));
}

/** Parse Fedora archive directory listing HTML into versioned releases. */
export function parseVirtioArchiveHtml(html: string): VirtioArchiveRelease[] {
  const found = new Map<string, VirtioArchiveRelease>();
  const re = /href="(virtio-win-(\d+\.\d+\.\d+)-(\d+)\/)"/gi;
  for (const match of html.matchAll(re)) {
    const dir = match[1]?.replace(/\/$/, "") ?? "";
    const version = match[2] ?? "";
    const release = Number(match[3] ?? 0) || 0;
    if (!dir || !version) continue;
    const key = `${version}-${release}`;
    const prev = found.get(key);
    if (prev && prev.release >= release) continue;
    const filename = `virtio-win-${version}.iso`;
    found.set(key, {
      version,
      release,
      dir,
      filename,
      url: `${VIRTIO_ARCHIVE_BASE}/${dir}/${filename}`,
    });
  }
  return [...found.values()].sort((a, b) => {
    const byVersion = compareTemplateVersion(b.version, a.version);
    if (byVersion !== 0) return byVersion;
    return b.release - a.release;
  });
}

/** Newest archive release that is not on the known-bad list. */
export function pickRecommendedVirtioRelease(
  releases: VirtioArchiveRelease[],
  fallback: IsoCatalogItem = VIRTIO_WIN_CATALOG_ITEM,
): VirtioArchiveRelease {
  const safe = releases.find((item) => !isKnownBadVirtioVersion(item.version));
  if (safe) return safe;
  return {
    version: fallback.version,
    release: 1,
    dir: `virtio-win-${fallback.version}-1`,
    filename: fallback.filename,
    url: fallback.url,
  };
}

export function virtioCatalogItemFromRelease(
  release: VirtioArchiveRelease,
  base: IsoCatalogItem = VIRTIO_WIN_CATALOG_ITEM,
): IsoCatalogItem {
  return {
    ...base,
    filename: release.filename,
    url: release.url,
    version: release.version,
  };
}

export function bestInstalledVirtioVersion(isos: string[]): string {
  return isos
    .filter((volid) => isVirtioIso(volid) && !isKnownBadVirtioIso(volid))
    .map((volid) => virtioIsoVersion(volid) ?? "")
    .filter(Boolean)
    .sort((a, b) => compareTemplateVersion(b, a))[0] ?? "";
}

export function isWindowsIso(volid: string): boolean {
  const file = volidFilename(volid).toLowerCase();
  return /windows|win(?:dows)?(?:10|11)|win(?:dows)?[-_]?server|server[-_]?20(?:1[69]|2[025])/.test(file);
}

export function suggestVirtioIso(isos: string[], installIso: string): string {
  if (!installIso || !isWindowsIso(installIso)) return "";
  const candidates = isos.filter((volid) => volid !== installIso && isVirtioIso(volid));
  if (!candidates.length) return "";
  const preferred = candidates
    .filter((volid) => !isKnownBadVirtioIso(volid))
    .sort((a, b) => compareTemplateVersion(virtioIsoVersion(b) ?? "", virtioIsoVersion(a) ?? ""));
  return preferred[0] ?? candidates[0] ?? "";
}

/** True when a non-known-bad VirtIO ISO is already on the host. */
export function hasUsableVirtioIso(isos: string[]): boolean {
  return isos.some((volid) => isVirtioIso(volid) && !isKnownBadVirtioIso(volid));
}

/** Missing VirtIO or installed usable build older than the live recommendation. */
export function needsVirtioDownload(isos: string[], recommendedVersion: string): boolean {
  if (!recommendedVersion) return !hasUsableVirtioIso(isos);
  if (!hasUsableVirtioIso(isos)) return true;
  return compareTemplateVersion(recommendedVersion, bestInstalledVirtioVersion(isos)) > 0;
}

export function withLiveVirtioCatalog(
  live: IsoCatalogItem | null | undefined,
  catalog: IsoCatalogItem[] = ISO_CATALOG,
): IsoCatalogItem[] {
  if (!live) return catalog;
  return catalog.map((item) => (item.id === VIRTIO_WIN_CATALOG_ITEM.id ? live : item));
}

export function ostypeFromIso(volid: string): string | undefined {
  if (!isWindowsIso(volid)) return undefined;
  const file = volidFilename(volid).toLowerCase();
  if (/win10|2016|2019/.test(file)) return "win10";
  return "win11";
}

export function isWindowsOstype(ostype: string | undefined): boolean {
  return Boolean(ostype?.toLowerCase().startsWith("win"));
}

/** Pin a stable q35 revision — bare `q35` follows the host default (11.x) and breaks some Windows ISOs. */
export const WINDOWS_MACHINE_TYPE = "pc-q35-9.2";

export function windowsVmFirmware(
  ostype: string,
): { bios: "ovmf"; machine: typeof WINDOWS_MACHINE_TYPE; cpu: "host" } | null {
  if (!isWindowsOstype(ostype)) return null;
  return { bios: "ovmf", machine: WINDOWS_MACHINE_TYPE, cpu: "host" };
}

export function vmCdromDisks(iso?: string, iso2?: string): Record<string, string> {
  const first = iso?.trim() ?? "";
  const second = iso2?.trim() ?? "";
  const disks: Record<string, string> = {};
  // Install ISO on ide2 (bootable). VirtIO drivers on sata1 so OVMF does not treat it as a second DVD boot target.
  if (first) disks.ide2 = `${first},media=cdrom`;
  if (second && second !== first) {
    if (first) disks.sata1 = `${second},media=cdrom`;
    else disks.ide2 = `${second},media=cdrom`;
  }
  return disks;
}

/** Boot order for new VMs. With an install ISO, prefer it and omit net0 so a missed CD keypress does not fall through to PXE. */
export function vmCreateBootOrder(input: {
  diskBus: "scsi" | "virtio" | "sata" | "ide";
  hasInstallIso: boolean;
}): string {
  const disk =
    input.diskBus === "virtio"
      ? "virtio0"
      : input.diskBus === "sata"
        ? "sata0"
        : input.diskBus === "ide"
          ? "ide0"
          : "scsi0";
  if (input.hasInstallIso) return `order=ide2;${disk}`;
  return `order=${disk}`;
}

export function isoVersionFromFilename(filename: string): string {
  const file = volidFilename(filename);
  const virtio = /virtio[-_]?win[-_]?(\d+\.\d+\.\d+)/i.exec(file);
  if (virtio?.[1]) return virtio[1];
  const debian = /debian(?:-edu|-mac)?-(\d+(?:\.\d+)*)-/i.exec(file);
  if (debian?.[1]) return debian[1];
  const ubuntu = /ubuntu-(\d+\.\d+(?:\.\d+)?)-/i.exec(file);
  if (ubuntu?.[1]) return ubuntu[1];
  return "";
}

export function filenameFromUrl(url: string): string {
  try {
    const path = decodeURIComponent(new URL(url).pathname);
    const name = path.split("/").pop() ?? "";
    return name.includes(".") ? name : "";
  } catch {
    return "";
  }
}

export function isHttpUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:" || parsed.protocol === "http:";
  } catch {
    return false;
  }
}

export function mergeIsoCatalog(
  installedVolids: Iterable<string>,
  catalog: IsoCatalogItem[] = ISO_CATALOG,
): IsoPackageRow[] {
  const installed = [...installedVolids].filter(Boolean);
  const used = new Set<string>();
  const rows: IsoPackageRow[] = [];

  for (const item of catalog) {
    const family = isoFamily(item.filename);
    const matches = installed.filter((volid) => isoFamily(volid) === family);
    for (const volid of matches) used.add(volid);
    const newestInstalled = [...matches].sort(
      (a, b) => compareTemplateVersion(isoVersionFromFilename(b), isoVersionFromFilename(a)) || volidFilename(b).localeCompare(volidFilename(a)),
    )[0];
    const installedFilename = newestInstalled ? volidFilename(newestInstalled) : "";
    rows.push({
      key: item.id,
      headline: item.headline,
      section: item.section,
      url: item.url,
      installedVersion: newestInstalled ? isoVersionFromFilename(newestInstalled) : "",
      installedFilename,
      installedVolids: matches,
      latestVersion: item.version,
      latestFilename: item.filename,
      updateAvailable: Boolean(
        installedFilename &&
          installedFilename !== item.filename &&
          compareTemplateVersion(item.version, isoVersionFromFilename(newestInstalled ?? "")) > 0,
      ),
    });
  }

  for (const volid of installed) {
    if (used.has(volid)) continue;
    const filename = volidFilename(volid);
    rows.push({
      key: `local:${filename.toLowerCase()}`,
      headline: filename,
      section: "iso",
      url: "",
      installedVersion: isoVersionFromFilename(filename),
      installedFilename: filename,
      installedVolids: [volid],
      latestVersion: isoVersionFromFilename(filename),
      latestFilename: filename,
      updateAvailable: false,
    });
  }

  return rows.sort((a, b) => {
    if (a.updateAvailable !== b.updateAvailable) return a.updateAvailable ? -1 : 1;
    if (Boolean(a.installedFilename) !== Boolean(b.installedFilename)) return a.installedFilename ? -1 : 1;
    return a.headline.localeCompare(b.headline);
  });
}
