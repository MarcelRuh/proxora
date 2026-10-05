import { prisma } from "@/lib/db";
import { emptySuiteEmbeds, parseEmbedUrl, readSuiteEmbeds, SUITE_EMBEDS_KEY, type SuiteEmbeds } from "@/lib/suite-embeds";

export async function loadSuiteEmbeds(): Promise<SuiteEmbeds> {
  const row = await prisma.setting.findUnique({ where: { key: SUITE_EMBEDS_KEY } });
  return row ? readSuiteEmbeds(row.value) : emptySuiteEmbeds();
}

export async function saveSuiteEmbeds(input: { dockora?: unknown; sambora?: unknown }): Promise<SuiteEmbeds> {
  const current = await loadSuiteEmbeds();
  const next: SuiteEmbeds = {
    dockora: "dockora" in input ? parseEmbedUrl(input.dockora) : current.dockora,
    sambora: "sambora" in input ? parseEmbedUrl(input.sambora) : current.sambora,
  };
  await prisma.setting.upsert({
    where: { key: SUITE_EMBEDS_KEY },
    update: { value: next },
    create: { key: SUITE_EMBEDS_KEY, value: next },
  });
  return next;
}
