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

const ARCHIVE_RE = /\.(tar\.(gz|xz|zst|bz2)|tgz)$/i;

export function volidFilename(volid: string): string {
  const raw = String(volid ?? "").trim();
  return raw.split("/").pop() ?? raw;
}

export function vztmplVolid(storage: string, filename: string): string {
  return `${storage}:vztmpl/${filename}`;
}

export function isLxcAppliance(raw: Record<string, unknown>): boolean {
  const pkg = String(raw.package ?? "").toLowerCase();
  if (pkg === "pve-web-news") return false;
  const type = String(raw.type ?? "").toLowerCase();
  if (type === "lxc" || type === "openvz") return true;
  if (type && type !== "lxc" && type !== "openvz") return false;
  const name = String(raw.template ?? raw.location ?? raw.package ?? "");
  return ARCHIVE_RE.test(name);
}

export function normalizeAplTemplate(raw: Record<string, unknown>): AplTemplate | null {
  if (!raw || typeof raw !== "object") return null;
  const location = String(raw.location ?? "");
  const template =
    String(raw.template ?? "").trim() || volidFilename(location) || String(raw.filename ?? "").trim();
  if (!template || !isLxcAppliance({ ...raw, template })) return null;
  const packageName = String(raw.package ?? "").trim();
  const headline =
    String(raw.headline ?? "").trim() || String(raw.description ?? "").trim() || packageName || template;
  return {
    template,
    package: packageName,
    version: String(raw.version ?? "").trim(),
    section: String(raw.section ?? "").trim() || "system",
    headline,
    type: String(raw.type ?? "lxc").trim() || "lxc",
    os: String(raw.os ?? "").trim(),
    architecture: String(raw.architecture ?? raw.arch ?? "").trim(),
  };
}

export function sortAplTemplates(a: AplTemplate, b: AplTemplate): number {
  const rank = (section: string) => (section === "system" ? 0 : 1);
  return rank(a.section) - rank(b.section) || a.headline.localeCompare(b.headline) || a.template.localeCompare(b.template);
}
