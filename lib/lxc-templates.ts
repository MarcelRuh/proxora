export type AplTemplate = {
  template: string;
  package: string;
  version: string;
  section: string;
  headline: string;
  type: string;
  os: string;
  architecture: string;
};

export type CatalogTemplate = AplTemplate & { installed: boolean; volid?: string };

export type TemplatePackageRow = {
  key: string;
  package: string;
  headline: string;
  section: string;
  architecture: string;
  installedVersion: string;
  installedTemplate: string;
  installedVolids: string[];
  latestVersion: string;
  latestTemplate: string;
  updateAvailable: boolean;
};

const ARCHIVE_RE = /\.(tar\.(gz|xz|zst|bz2)|tgz)$/i;

export function volidFilename(volid: string): string {
  const raw = String(volid ?? "").trim();
  return raw.split("/").pop() ?? raw;
}

export function vztmplVolid(storage: string, filename: string): string {
  return `${storage}:vztmpl/${filename}`;
}

export function isVztmplContentVolid(volid: string): boolean {
  const raw = volid.trim();
  if (!raw || raw.includes("..")) return false;
  const lower = raw.toLowerCase();
  return lower.includes(":vztmpl/") || lower.includes("/vztmpl/");
}

export function storageContentVolid(row: Record<string, unknown> | null | undefined): string {
  if (!row) return "";
  const volid = String(row.volid ?? "").trim();
  if (volid) return volid;
  const storage = String(row.storage ?? "").trim();
  const volume = String(row.volume ?? "").trim();
  if (storage && volume) return volume.includes(":") ? volume : `${storage}:${volume}`;
  return "";
}

export function isVztmplRow(row: Record<string, unknown>): boolean {
  const content = String(row.content ?? "").toLowerCase();
  const volid = storageContentVolid(row);
  if (content.includes("vztmpl")) return true;
  if (volid.toLowerCase().includes("vztmpl")) return true;
  return ARCHIVE_RE.test(volidFilename(volid));
}

export function parseVztmplFilename(filename: string): { package: string; version: string; architecture: string } {
  const base = volidFilename(filename).replace(ARCHIVE_RE, "");
  const match = /^(.+)_([^_]+)_([^_]+)$/.exec(base);
  if (!match) return { package: base, version: "", architecture: "" };
  return { package: match[1] ?? base, version: match[2] ?? "", architecture: match[3] ?? "" };
}

export function headlineFromPackage(pkg: string): string {
  const raw = pkg.trim();
  if (!raw) return "";
  return raw
    .split("-")
    .map((part) => {
      if (!part) return part;
      if (/^\d/.test(part) || part === part.toUpperCase()) return part;
      return part.charAt(0).toUpperCase() + part.slice(1);
    })
    .join(" ");
}

export function isLxcAppliance(raw: Record<string, unknown>): boolean {
  const pkg = String(raw.package ?? "").toLowerCase();
  if (pkg === "pve-web-news") return false;
  const name = String(raw.template ?? raw.location ?? raw.filename ?? raw.package ?? "");
  if (ARCHIVE_RE.test(name)) return true;
  const type = String(raw.type ?? "").toLowerCase();
  return type === "lxc" || type === "openvz";
}

export function normalizeAplTemplate(raw: Record<string, unknown>): AplTemplate | null {
  if (!raw || typeof raw !== "object") return null;
  const location = String(raw.location ?? raw.Location ?? "");
  const parsed = parseVztmplFilename(String(raw.template ?? raw.filename ?? location));
  const template =
    String(raw.template ?? "").trim() ||
    volidFilename(location) ||
    String(raw.filename ?? "").trim();
  if (!template || !isLxcAppliance({ ...raw, template })) return null;
  const packageName = String(raw.package ?? parsed.package ?? "").trim();
  const headline =
    String(raw.headline ?? raw.Headline ?? "").trim() ||
    String(raw.description ?? raw.Description ?? "").trim() ||
    headlineFromPackage(packageName) ||
    template;
  return {
    template,
    package: packageName,
    version: String(raw.version ?? parsed.version ?? "").trim(),
    section: String(raw.section ?? raw.Section ?? "").trim() || "system",
    headline,
    type: String(raw.type ?? "lxc").trim() || "lxc",
    os: String(raw.os ?? "").trim(),
    architecture: String(raw.architecture ?? raw.arch ?? parsed.architecture ?? "").trim(),
  };
}

export function templateFromInstalledVolid(volid: string): CatalogTemplate {
  const template = volidFilename(volid);
  const parsed = parseVztmplFilename(template);
  return {
    template,
    package: parsed.package,
    version: parsed.version,
    section: "system",
    headline: headlineFromPackage(parsed.package) || template,
    type: "lxc",
    os: "",
    architecture: parsed.architecture,
    installed: true,
    volid,
  };
}

export function compareTemplateVersion(a: string, b: string): number {
  const pa = String(a)
    .trim()
    .split(/[.-]/)
    .map((n) => Number.parseInt(n, 10) || 0);
  const pb = String(b)
    .trim()
    .split(/[.-]/)
    .map((n) => Number.parseInt(n, 10) || 0);
  const len = Math.max(pa.length, pb.length);
  for (let i = 0; i < len; i++) {
    const da = pa[i] ?? 0;
    const db = pb[i] ?? 0;
    if (da !== db) return da - db;
  }
  return 0;
}

export function packageKey(row: { package: string; architecture: string; template: string }): string {
  const parsed = parseVztmplFilename(row.template);
  const pkg = (row.package || parsed.package).trim().toLowerCase() || row.template.toLowerCase();
  const arch = (row.architecture || parsed.architecture).trim().toLowerCase();
  return `${pkg}|${arch}`;
}

export function groupTemplatePackages(rows: CatalogTemplate[]): TemplatePackageRow[] {
  const groups = new Map<string, CatalogTemplate[]>();
  for (const row of rows) {
    const key = packageKey(row);
    const list = groups.get(key) ?? [];
    list.push(row);
    groups.set(key, list);
  }
  const out: TemplatePackageRow[] = [];
  for (const [key, list] of groups) {
    const byVersion = (a: CatalogTemplate, b: CatalogTemplate) =>
      compareTemplateVersion(b.version, a.version) || b.template.localeCompare(a.template);
    const installed = list.filter((row) => row.installed).sort(byVersion);
    const newestInstalled = installed[0];
    const newestAny = [...list].sort(byVersion)[0];
    const latestTemplate = newestAny?.template ?? "";
    const latestVersion = newestAny?.version ?? "";
    const updateAvailable = Boolean(
      newestInstalled &&
        latestTemplate &&
        latestTemplate !== newestInstalled.template &&
        compareTemplateVersion(latestVersion, newestInstalled.version) > 0,
    );
    out.push({
      key,
      package: newestAny?.package || newestInstalled?.package || "",
      headline: newestAny?.headline || newestInstalled?.headline || latestTemplate,
      section: newestAny?.section || newestInstalled?.section || "system",
      architecture: newestAny?.architecture || newestInstalled?.architecture || "",
      installedVersion: newestInstalled?.version ?? "",
      installedTemplate: newestInstalled?.template ?? "",
      installedVolids: installed.map((row) => row.volid).filter((volid): volid is string => Boolean(volid)),
      latestVersion,
      latestTemplate,
      updateAvailable,
    });
  }
  return out.sort((a, b) => {
    if (a.updateAvailable !== b.updateAvailable) return a.updateAvailable ? -1 : 1;
    if (Boolean(a.installedVersion) !== Boolean(b.installedVersion)) return a.installedVersion ? -1 : 1;
    return a.headline.localeCompare(b.headline);
  });
}

export function sortAplTemplates(a: AplTemplate, b: AplTemplate): number {
  const rank = (section: string) => (section === "system" ? 0 : 1);
  return rank(a.section) - rank(b.section) || a.headline.localeCompare(b.headline) || a.template.localeCompare(b.template);
}

/** Catalog (latest from Proxmox) plus locally installed files such as debian-13-standard_13.1-2. */
export function mergeTemplateCatalog(catalog: AplTemplate[], installedVolids: Iterable<string>): CatalogTemplate[] {
  const byFile = new Map<string, CatalogTemplate>();
  for (const row of catalog) {
    byFile.set(row.template.toLowerCase(), { ...row, installed: false });
  }
  for (const volid of installedVolids) {
    const file = volidFilename(volid);
    if (!file) continue;
    const key = file.toLowerCase();
    const existing = byFile.get(key);
    if (existing) {
      existing.installed = true;
      existing.volid = volid;
      continue;
    }
    byFile.set(key, templateFromInstalledVolid(volid));
  }
  return [...byFile.values()].sort((a, b) => {
    if (a.installed !== b.installed) return a.installed ? -1 : 1;
    return sortAplTemplates(a, b);
  });
}
