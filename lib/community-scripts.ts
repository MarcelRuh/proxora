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
  /** Upstream script creation date (ms epoch), null when unknown. */
  createdAt: number | null;
  /** Last upstream script change (ms epoch), null when unknown. */
  updatedAt: number | null;
  hasArm: boolean;
  /** Still in the community "testing" (dev) channel. */
  isDev: boolean;
  /** Script docs describe an OIDC / SSO setup. */
  hasOidc: boolean;
  /** Installs in the last 30 days (community-scripts.org stats), null when unknown. */
  installs30d?: number | null;
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

function dateMs(value: unknown): number | null {
  if (typeof value !== "string" || !value.trim()) return null;
  const ms = Date.parse(value.trim().replace(" ", "T"));
  return Number.isFinite(ms) ? ms : null;
}

const DAY_MS = 24 * 60 * 60_000;

/** `script_*` dates are day-precise; refine with the record timestamp when it is the same day. */
function scriptDateMs(day: unknown, record: unknown): number | null {
  const dayMs = dateMs(day);
  const exact = dateMs(record);
  if (dayMs == null) return exact;
  return exact != null && exact >= dayMs && exact < dayMs + DAY_MS ? exact : dayMs;
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
    createdAt: scriptDateMs(raw.script_created, raw.created),
    updatedAt: scriptDateMs(raw.script_updated, raw.updated),
    hasArm:
      raw.has_arm === true ||
      (Array.isArray(raw.architectures) && raw.architectures.some((arch) => arch === "arm64")),
    isDev: raw.is_dev === true,
    hasOidc: typeof raw.oidc_url === "string" && raw.oidc_url.trim() !== "",
  };
}

export type CommunityScriptFlag = "arm" | "testing" | "oidc";
export type CommunityScriptSort = "category" | "popular" | "newest" | "updated" | "least" | "name";

export const COMMUNITY_SCRIPT_FLAGS: CommunityScriptFlag[] = ["arm", "testing", "oidc"];
export const COMMUNITY_SCRIPT_SORTS: CommunityScriptSort[] = [
  "category",
  "popular",
  "newest",
  "updated",
  "least",
  "name",
];

export type CommunityScriptFilter = {
  query?: string;
  categoryId?: string;
  kind?: CommunityScriptKind | "all";
  /** Type chips: empty = all kinds. */
  kinds?: CommunityScriptKind[];
  /** Every flag must match. */
  flags?: CommunityScriptFlag[];
};

export function communityScriptHasFlag(script: CommunityScriptSummary, flag: CommunityScriptFlag): boolean {
  if (flag === "arm") return script.hasArm === true;
  if (flag === "testing") return script.isDev === true;
  return script.hasOidc === true;
}

export function filterCommunityScripts(
  scripts: CommunityScriptSummary[],
  opts: CommunityScriptFilter,
): CommunityScriptSummary[] {
  const q = (opts.query ?? "").trim().toLowerCase();
  const words = q ? q.split(/\s+/).filter(Boolean) : [];
  const kinds = opts.kinds?.length ? new Set(opts.kinds) : null;
  const flags = opts.flags ?? [];
  return scripts.filter((script) => {
    if (opts.categoryId && !script.categoryIds.includes(opts.categoryId)) return false;
    if (opts.kind && opts.kind !== "all" && script.kind !== opts.kind) return false;
    if (kinds && !kinds.has(script.kind)) return false;
    if (flags.some((flag) => !communityScriptHasFlag(script, flag))) return false;
    if (!words.length) return true;
    const hay = `${script.name} ${script.slug} ${script.description}`.toLowerCase();
    return words.every((word) => hay.includes(word));
  });
}

/** Counts per kind / flag for the chips, ignoring the chip dimension itself. */
export function communityScriptFacetCounts(
  scripts: CommunityScriptSummary[],
  opts: CommunityScriptFilter,
): { kinds: Record<CommunityScriptKind, number>; flags: Record<CommunityScriptFlag, number> } {
  const kinds = { lxc: 0, vm: 0, addon: 0, pve: 0, turnkey: 0 } as Record<CommunityScriptKind, number>;
  for (const script of filterCommunityScripts(scripts, { ...opts, kinds: [] })) kinds[script.kind] += 1;
  const flags = { arm: 0, testing: 0, oidc: 0 } as Record<CommunityScriptFlag, number>;
  for (const script of filterCommunityScripts(scripts, { ...opts, flags: [] })) {
    for (const flag of COMMUNITY_SCRIPT_FLAGS) if (communityScriptHasFlag(script, flag)) flags[flag] += 1;
  }
  return { kinds, flags };
}

function byName(a: CommunityScriptSummary, b: CommunityScriptSummary): number {
  return a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
}

/** Unknown values always sort last, regardless of direction. */
function byNumber(
  pick: (script: CommunityScriptSummary) => number | null | undefined,
  dir: "asc" | "desc",
): (a: CommunityScriptSummary, b: CommunityScriptSummary) => number {
  return (a, b) => {
    const av = pick(a);
    const bv = pick(b);
    const aMissing = av == null;
    const bMissing = bv == null;
    if (aMissing || bMissing) return aMissing === bMissing ? byName(a, b) : aMissing ? 1 : -1;
    if (av === bv) return byName(a, b);
    return dir === "asc" ? av - bv : bv - av;
  };
}

export function sortCommunityScripts(
  scripts: CommunityScriptSummary[],
  sort: CommunityScriptSort,
  categories: CommunityScriptCategory[] = [],
): CommunityScriptSummary[] {
  const out = [...scripts];
  switch (sort) {
    case "popular":
      return out.sort(byNumber((s) => s.installs30d ?? null, "desc"));
    case "least":
      return out.sort(byNumber((s) => s.installs30d ?? null, "asc"));
    case "newest":
      return out.sort(byNumber((s) => s.createdAt, "desc"));
    case "updated":
      return out.sort(byNumber((s) => s.updatedAt, "desc"));
    case "category": {
      const order = new Map(categories.map((cat, index) => [cat.id, index]));
      const rank = (s: CommunityScriptSummary) =>
        s.categoryIds.length ? Math.min(...s.categoryIds.map((id) => order.get(id) ?? 9_999)) : 9_999;
      return out.sort((a, b) => rank(a) - rank(b) || byName(a, b));
    }
    default:
      return out.sort(byName);
  }
}

/**
 * Pulls `{slug, installCount30d}` pairs out of the community-scripts.org page payload.
 * There is no public stats API; missing data just disables popularity sorting.
 */
export function parseCommunityScriptInstallStats(html: string): Map<string, number> {
  const out = new Map<string, number>();
  const pattern = /\\?"slug\\?"\s*:\s*\\?"([a-z0-9][a-z0-9._-]{0,79})\\?"\s*,\s*\\?"installCount30d\\?"\s*:\s*(\d{1,9})/gi;
  for (const match of html.matchAll(pattern)) {
    const slug = match[1];
    const count = Number(match[2]);
    if (!out.has(slug) && Number.isFinite(count)) out.set(slug, count);
  }
  return out;
}

export function isSafeCommunityScriptSlug(slug: string): boolean {
  return /^[a-z0-9]+(?:-[a-z0-9]+)*$/i.test(slug) && slug.length <= 80;
}
