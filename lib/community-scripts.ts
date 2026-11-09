/** Proxmox VE Community Scripts (community-scripts.org) helpers. */

export const COMMUNITY_SCRIPTS_SITE = "https://community-scripts.org";
export const COMMUNITY_SCRIPTS_DB =
  "https://db.community-scripts.org/api/collections/script_scripts/records";
export const COMMUNITY_SCRIPTS_CATEGORIES_DB =
  "https://db.community-scripts.org/api/collections/script_categories/records";
export const COMMUNITY_SCRIPTS_RAW_BASE =
  "https://raw.githubusercontent.com/community-scripts/ProxmoxVE/main";

export const SCRIPT_TYPE_IDS = {
  lxc: "nm9bra8mzye2scg",
  vm: "lte524abgx960bd",
  addon: "88xtxy57q80v38v",
  pve: "1uyjfno0fpf5buh",
  turnkey: "fbwvn9nhe3lmc9l",
} as const;

export type CommunityScriptKind = keyof typeof SCRIPT_TYPE_IDS;

const TYPE_BY_ID: Record<string, CommunityScriptKind> = Object.fromEntries(
  Object.entries(SCRIPT_TYPE_IDS).map(([kind, id]) => [id, kind as CommunityScriptKind]),
);

/** Preferred GitHub path prefix per script kind. */
export const SCRIPT_KIND_DIRS: Record<CommunityScriptKind, string> = {
  lxc: "ct",
  vm: "vm",
  addon: "tools/addon",
  pve: "tools/pve",
  turnkey: "turnkey",
};

export type CommunityScriptCategory = {
  id: string;
  name: string;
  description: string;
  sortOrder: number;
};

export type CommunityScriptSummary = {
  id: string;
  name: string;
  slug: string;
  description: string;
  logo: string | null;
  kind: CommunityScriptKind;
  categoryIds: string[];
  port: number | null;
  privileged: boolean;
  updateable: boolean;
  website: string | null;
  documentation: string | null;
  defaultCpu: number | null;
  defaultRamMb: number | null;
  defaultDiskGb: number | null;
  defaultOs: string | null;
};

export type CommunityScriptInstallMethod = {
  type: string;
  os: string | null;
  version: string | null;
  cpu: number | null;
  ramMb: number | null;
  diskGb: number | null;
};

export function communityScriptKindFromTypeId(typeId: unknown): CommunityScriptKind {
  const id = String(typeId ?? "").trim();
  return TYPE_BY_ID[id] ?? "lxc";
}

export function communityScriptSourcePath(kind: CommunityScriptKind, slug: string): string {
  const safe = slug.trim().replace(/[^a-zA-Z0-9._-]/g, "");
  const dir = SCRIPT_KIND_DIRS[kind] ?? "ct";
  return `${dir}/${safe}.sh`;
}

export function communityScriptRawUrl(kind: CommunityScriptKind, slug: string): string {
  return `${COMMUNITY_SCRIPTS_RAW_BASE}/${communityScriptSourcePath(kind, slug)}`;
}

export function communityScriptPageUrl(slug: string): string {
  return `${COMMUNITY_SCRIPTS_SITE}/scripts/${encodeURIComponent(slug)}`;
}

export const COMMUNITY_SCRIPT_LOGO_PROXY_HOSTS = new Set([
  "cdn.jsdelivr.net",
  "raw.githubusercontent.com",
  "avatars.githubusercontent.com",
  "objects.githubusercontent.com",
]);

export function isCommunityScriptLogoProxyHost(hostname: string): boolean {
  return COMMUNITY_SCRIPT_LOGO_PROXY_HOSTS.has(hostname);
}

/** Prefer Proxora logo proxy for CDNs that rate-limit browsers; otherwise use https directly. */
export function communityScriptLogoSrc(logo: string | null | undefined): string | null {
  const raw = (logo ?? "").trim();
  if (!raw) return null;
  try {
    const url = new URL(raw);
    if (url.protocol !== "https:") return null;
    if (isCommunityScriptLogoProxyHost(url.hostname)) {
      return `/api/community-scripts/logo?u=${encodeURIComponent(raw)}`;
    }
    return raw;
  } catch {
    return null;
  }
}

/** One-liner pasted into the Proxmox host shell (same shape as community-scripts.org). */
export function communityScriptInstallCommand(kind: CommunityScriptKind, slug: string): string {
  const url = communityScriptRawUrl(kind, slug);
  return `bash -c "$(curl -fsSL ${url})"`;
}

export function parseCommunityScriptCategory(raw: Record<string, unknown>): CommunityScriptCategory | null {
  const id = typeof raw.id === "string" ? raw.id : "";
  const name = typeof raw.name === "string" ? raw.name.trim() : "";
  if (!id || !name) return null;
  return {
    id,
    name,
    description: typeof raw.description === "string" ? raw.description : "",
    sortOrder: typeof raw.sort_order === "number" ? raw.sort_order : 999,
  };
}

function numOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function defaultResources(methods: unknown): {
  cpu: number | null;
  ramMb: number | null;
  diskGb: number | null;
  os: string | null;
} {
  if (!Array.isArray(methods) || methods.length === 0) {
    return { cpu: null, ramMb: null, diskGb: null, os: null };
  }
  const preferred =
    methods.find((item) => item && typeof item === "object" && (item as { type?: string }).type === "default") ??
    methods[0];
  if (!preferred || typeof preferred !== "object") {
    return { cpu: null, ramMb: null, diskGb: null, os: null };
  }
  const resources = (preferred as { resources?: Record<string, unknown> }).resources ?? {};
  return {
    cpu: numOrNull(resources.cpu),
    ramMb: numOrNull(resources.ram),
    diskGb: numOrNull(resources.hdd),
    os: typeof resources.os === "string" ? resources.os : null,
  };
}

export function parseCommunityScriptSummary(raw: Record<string, unknown>): CommunityScriptSummary | null {
  const id = typeof raw.id === "string" ? raw.id : "";
  const name = typeof raw.name === "string" ? raw.name.trim() : "";
  const slug = typeof raw.slug === "string" ? raw.slug.trim() : "";
  if (!id || !name || !slug) return null;
  if (raw.is_deleted === true || raw.is_disabled === true) return null;
  const resources = defaultResources(raw.install_methods);
  const categoryIds = Array.isArray(raw.categories)
    ? raw.categories.filter((item): item is string => typeof item === "string")
    : [];
  return {
    id,
    name,
    slug,
    description: typeof raw.description === "string" ? raw.description.trim() : "",
    logo: typeof raw.logo === "string" && raw.logo ? raw.logo : null,
    kind: communityScriptKindFromTypeId(raw.type),
    categoryIds,
    port: numOrNull(raw.port) && Number(raw.port) > 0 ? Number(raw.port) : null,
    privileged: raw.privileged === true,
    updateable: raw.updateable === true,
    website: typeof raw.website === "string" && raw.website ? raw.website : null,
    documentation: typeof raw.documentation === "string" && raw.documentation ? raw.documentation : null,
    defaultCpu: resources.cpu,
    defaultRamMb: resources.ramMb,
    defaultDiskGb: resources.diskGb,
    defaultOs: resources.os,
  };
}

export function filterCommunityScripts(
  scripts: CommunityScriptSummary[],
  opts: { query?: string; categoryId?: string; kind?: CommunityScriptKind | "all" },
): CommunityScriptSummary[] {
  const q = (opts.query ?? "").trim().toLowerCase();
  const words = q ? q.split(/\s+/).filter(Boolean) : [];
  return scripts.filter((script) => {
    if (opts.categoryId && !script.categoryIds.includes(opts.categoryId)) return false;
    if (opts.kind && opts.kind !== "all" && script.kind !== opts.kind) return false;
    if (!words.length) return true;
    const hay = `${script.name} ${script.slug} ${script.description}`.toLowerCase();
    return words.every((word) => hay.includes(word));
  });
}

export function isSafeCommunityScriptSlug(slug: string): boolean {
  return /^[a-z0-9]+(?:-[a-z0-9]+)*$/i.test(slug) && slug.length <= 80;
}
