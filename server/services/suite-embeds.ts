import { prisma } from "@/lib/db";
import { parseSuiteApps, readSuiteEmbeds, SUITE_EMBEDS_KEY, type SuiteEmbeds } from "@/lib/suite-embeds";

const EMBED_CACHE_MS = 60_000;
let embedCache: { at: number; apps: SuiteEmbeds["apps"] } | null = null;

export async function loadSuiteEmbeds(): Promise<SuiteEmbeds> {
  const row = await prisma.setting.findUnique({ where: { key: SUITE_EMBEDS_KEY } });
  return row ? readSuiteEmbeds(row.value) : { apps: [] };
}

/** Cached for the suite proxy hot path; invalidated on save. */
export async function loadSuiteEmbedAppsCached(): Promise<SuiteEmbeds["apps"]> {
  const now = Date.now();
  if (embedCache && now - embedCache.at <= EMBED_CACHE_MS) return embedCache.apps;
  const apps = (await loadSuiteEmbeds()).apps;
  embedCache = { at: now, apps };
  return apps;
}

export function clearSuiteEmbedCache() {
  embedCache = null;
}

export async function saveSuiteEmbeds(input: { apps?: unknown }): Promise<SuiteEmbeds> {
  const next: SuiteEmbeds = { apps: parseSuiteApps(input.apps) };
  await prisma.setting.upsert({
    where: { key: SUITE_EMBEDS_KEY },
    update: { value: next },
    create: { key: SUITE_EMBEDS_KEY, value: next },
  });
  clearSuiteEmbedCache();
  return next;
}
