import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  COMMUNITY_SCRIPTS_CATEGORIES_DB,
  COMMUNITY_SCRIPTS_DB,
  COMMUNITY_SCRIPTS_SITE,
  communityScriptInstallCommand,
  communityScriptPageUrl,
  communityScriptRawUrl,
  filterCommunityScripts,
  isSafeCommunityScriptSlug,
  parseCommunityScriptCategory,
  parseCommunityScriptInstallStats,
  parseCommunityScriptSummary,
  type CommunityScriptCategory,
  type CommunityScriptKind,
  type CommunityScriptSummary,
} from "@/lib/community-scripts";
import { logger } from "@/lib/logger";

const CACHE_TTL_MS = 6 * 60 * 60_000;
const PER_PAGE = 200;
const MAX_PAGES = 20;
const DISK_CACHE_DIR = process.env.PROXORA_CACHE_DIR ?? "/var/lib/proxora";
const DISK_CACHE_PATH = path.join(DISK_CACHE_DIR, "community-scripts-catalog.json");

/** Bump when CommunityScriptSummary gains fields so old disk caches get refreshed. */
const CACHE_VERSION = 2;

type CatalogCache = {
  version?: number;
  fetchedAt: number;
  hasInstallStats?: boolean;
  scripts: CommunityScriptSummary[];
  categories: CommunityScriptCategory[];
};

let cache: CatalogCache | null = null;
let inflight: Promise<CatalogCache> | null = null;
let servedStale = false;

async function readDiskCache(): Promise<CatalogCache | null> {
  try {
    const raw = await readFile(DISK_CACHE_PATH, "utf8");
    const parsed = JSON.parse(raw) as CatalogCache;
    if (!parsed || !Array.isArray(parsed.scripts) || !Array.isArray(parsed.categories)) return null;
    if (typeof parsed.fetchedAt !== "number") return null;
    return parsed;
  } catch {
    return null;
  }
}

async function writeDiskCache(next: CatalogCache): Promise<void> {
  try {
    await mkdir(DISK_CACHE_DIR, { recursive: true });
    await writeFile(DISK_CACHE_PATH, `${JSON.stringify(next)}\n`, "utf8");
  } catch (error) {
    logger.warn({ err: error }, "Community Scripts disk cache write failed");
  }
}

async function fetchJson(url: string): Promise<unknown> {
  const res = await fetch(url, {
    headers: {
      Accept: "application/json",
      "User-Agent": "Proxora/community-scripts",
    },
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) throw new Error(`Community Scripts API HTTP ${res.status}`);
  return res.json();
}

async function fetchAllScripts(): Promise<CommunityScriptSummary[]> {
  const out: CommunityScriptSummary[] = [];
  const seen = new Set<string>();
  for (let page = 1; page <= MAX_PAGES; page += 1) {
    const params = new URLSearchParams({
      page: String(page),
      perPage: String(PER_PAGE),
      filter: "(is_deleted=false&&is_disabled=false)",
      sort: "name",
      fields:
        "id,name,slug,description,logo,type,categories,port,privileged,updateable,website,documentation,install_methods,is_deleted,is_disabled,script_created,script_updated,created,updated,has_arm,architectures,is_dev,oidc_url",
    });
    const data = (await fetchJson(`${COMMUNITY_SCRIPTS_DB}?${params}`)) as {
      items?: unknown[];
      totalPages?: number;
    };
    const items = Array.isArray(data.items) ? data.items : [];
    for (const item of items) {
      if (!item || typeof item !== "object") continue;
      const parsed = parseCommunityScriptSummary(item as Record<string, unknown>);
      if (!parsed || seen.has(parsed.slug)) continue;
      seen.add(parsed.slug);
      out.push(parsed);
    }
    const totalPages = typeof data.totalPages === "number" ? data.totalPages : page;
    if (page >= totalPages) break;
  }
  return out;
}

/** Best effort: 30-day install counts are only published inside the site's script page. */
async function fetchInstallStats(): Promise<Map<string, number>> {
  try {
    const res = await fetch(`${COMMUNITY_SCRIPTS_SITE}/scripts`, {
      headers: { Accept: "text/html", "User-Agent": "Proxora/community-scripts" },
      signal: AbortSignal.timeout(30_000),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const html = await res.text();
    if (html.length > 20_000_000) throw new Error("page too large");
    return parseCommunityScriptInstallStats(html);
  } catch (error) {
    logger.warn({ err: error }, "Community Scripts install stats unavailable");
    return new Map();
  }
}

async function fetchCategories(): Promise<CommunityScriptCategory[]> {
  const params = new URLSearchParams({ perPage: "100", sort: "sort_order" });
  const data = (await fetchJson(`${COMMUNITY_SCRIPTS_CATEGORIES_DB}?${params}`)) as {
    items?: unknown[];
  };
  const items = Array.isArray(data.items) ? data.items : [];
  const out: CommunityScriptCategory[] = [];
  for (const item of items) {
    if (!item || typeof item !== "object") continue;
    const parsed = parseCommunityScriptCategory(item as Record<string, unknown>);
    if (parsed) out.push(parsed);
  }
  return out.sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name));
}

async function ensureMemoryCache(): Promise<void> {
  if (cache) return;
  const disk = await readDiskCache();
  if (disk) {
    // Older cache layouts lack fields the UI sorts on: serve them, but refresh first chance.
    cache = disk.version === CACHE_VERSION ? disk : { ...disk, fetchedAt: 0 };
    servedStale = Date.now() - cache.fetchedAt >= CACHE_TTL_MS;
  }
}

async function loadCatalog(force = false): Promise<CatalogCache> {
  await ensureMemoryCache();
  if (!force && cache && Date.now() - cache.fetchedAt < CACHE_TTL_MS) {
    servedStale = false;
    return cache;
  }
  if (!force && inflight) return inflight;
  inflight = (async () => {
    try {
      const [scripts, categories, stats] = await Promise.all([
        fetchAllScripts(),
        fetchCategories(),
        fetchInstallStats(),
      ]);
      const hasInstallStats = stats.size > 0;
      const withStats = hasInstallStats
        ? scripts.map((script) => ({ ...script, installs30d: stats.get(script.slug) ?? 0 }))
        : scripts;
      cache = { version: CACHE_VERSION, fetchedAt: Date.now(), hasInstallStats, scripts: withStats, categories };
      servedStale = false;
      await writeDiskCache(cache);
      return cache;
    } catch (error) {
      if (cache) {
        servedStale = true;
        logger.warn({ err: error }, "Community Scripts refresh failed; using stale cache");
        return cache;
      }
      const disk = await readDiskCache();
      if (disk) {
        cache = disk;
        servedStale = true;
        logger.warn({ err: error }, "Community Scripts refresh failed; using disk cache");
        return disk;
      }
      throw error;
    } finally {
      inflight = null;
    }
  })();
  return inflight;
}

export async function listCommunityScripts(opts?: {
  query?: string;
  categoryId?: string;
  kind?: CommunityScriptKind | "all";
  force?: boolean;
}): Promise<{
  scripts: CommunityScriptSummary[];
  categories: CommunityScriptCategory[];
  fetchedAt: number;
  total: number;
  stale: boolean;
  hasInstallStats: boolean;
}> {
  const catalog = await loadCatalog(opts?.force === true);
  const filtered = filterCommunityScripts(catalog.scripts, {
    query: opts?.query,
    categoryId: opts?.categoryId,
    kind: opts?.kind,
  });
  return {
    scripts: filtered,
    categories: catalog.categories,
    fetchedAt: catalog.fetchedAt,
    total: catalog.scripts.length,
    hasInstallStats: catalog.hasInstallStats === true,
    stale: servedStale || Date.now() - catalog.fetchedAt >= CACHE_TTL_MS,
  };
}

export async function getCommunityScript(slug: string): Promise<CommunityScriptSummary | null> {
  if (!isSafeCommunityScriptSlug(slug)) return null;
  const catalog = await loadCatalog();
  return catalog.scripts.find((item) => item.slug === slug) ?? null;
}

export async function assertCommunityScriptInstallable(slug: string): Promise<{
  script: CommunityScriptSummary;
  command: string;
  sourceUrl: string;
  pageUrl: string;
}> {
  const script = await getCommunityScript(slug);
  if (!script) throw new Error("Script not found");
  const sourceUrl = communityScriptRawUrl(script.kind, script.slug);
  const head = await fetch(sourceUrl, {
    method: "HEAD",
    headers: { "User-Agent": "Proxora/community-scripts" },
    signal: AbortSignal.timeout(15_000),
  });
  if (!head.ok) {
    throw new Error(`Install script missing upstream (${head.status}): ${sourceUrl}`);
  }
  return {
    script,
    command: communityScriptInstallCommand(script.kind, script.slug),
    sourceUrl,
    pageUrl: communityScriptPageUrl(script.slug),
  };
}
