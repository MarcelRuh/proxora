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
];

export function isoVolid(storage: string, filename: string): string {
  return `${storage}:iso/${filename}`;
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
  const debian = /^(debian(?:-edu|-mac)?)-(\d+)(?:\.\d+)*-([^-]+)-netinst\.iso$/.exec(file);
  if (debian) return `${debian[1]}-${debian[2]}-${debian[3]}-netinst`;
  const ubuntu = /^(ubuntu)-(\d+\.\d+)(?:\.\d+)?-(live-server|desktop)-([^.]+)\.iso$/.exec(file);
  if (ubuntu) return `${ubuntu[1]}-${ubuntu[2]}-${ubuntu[3]}-${ubuntu[4]}`;
  return file.replace(/\.iso$/i, "") || file;
}

export function isVirtioIso(volid: string): boolean {
  return /virtio/i.test(volidFilename(volid));
}

export function isWindowsIso(volid: string): boolean {
  const file = volidFilename(volid).toLowerCase();
  return /windows|win(?:dows)?(?:10|11)|win(?:dows)?[-_]?server|server[-_]?20(?:1[69]|2[025])/.test(file);
}

export function suggestVirtioIso(isos: string[], installIso: string): string {
  if (!installIso || !isWindowsIso(installIso)) return "";
  return isos.find((volid) => volid !== installIso && isVirtioIso(volid)) ?? "";
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

export function windowsVmFirmware(ostype: string): { bios: "ovmf"; machine: "q35"; cpu: "host" } | null {
  if (!isWindowsOstype(ostype)) return null;
  return { bios: "ovmf", machine: "q35", cpu: "host" };
}

export function vmCdromDisks(iso?: string, iso2?: string): Record<string, string> {
  const first = iso?.trim() ?? "";
  const second = iso2?.trim() ?? "";
  const disks: Record<string, string> = {};
  if (first) disks.ide2 = `${first},media=cdrom`;
  if (second && second !== first) disks[first ? "ide3" : "ide2"] = `${second},media=cdrom`;
  return disks;
}

export function isoVersionFromFilename(filename: string): string {
  const file = volidFilename(filename);
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

export function mergeIsoCatalog(installedVolids: Iterable<string>): IsoPackageRow[] {
  const installed = [...installedVolids].filter(Boolean);
  const used = new Set<string>();
  const rows: IsoPackageRow[] = [];

  for (const item of ISO_CATALOG) {
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
