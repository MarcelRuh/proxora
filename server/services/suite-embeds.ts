import { prisma } from "@/lib/db";
import { parseSuiteApps, readSuiteEmbeds, SUITE_EMBEDS_KEY, type SuiteEmbeds } from "@/lib/suite-embeds";

export async function loadSuiteEmbeds(): Promise<SuiteEmbeds> {
  const row = await prisma.setting.findUnique({ where: { key: SUITE_EMBEDS_KEY } });
  return row ? readSuiteEmbeds(row.value) : { apps: [] };
}

export async function saveSuiteEmbeds(input: { apps?: unknown }): Promise<SuiteEmbeds> {
  const next: SuiteEmbeds = { apps: parseSuiteApps(input.apps) };
  await prisma.setting.upsert({
    where: { key: SUITE_EMBEDS_KEY },
    update: { value: next },
    create: { key: SUITE_EMBEDS_KEY, value: next },
  });
  return next;
}
