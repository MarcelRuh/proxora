import { z } from "zod";
import { Prisma } from "@prisma/client";
import { CPU_TEMP_SETTING_KEY, parseCpuTempSettings } from "@/lib/cpu-temp";
import { prisma } from "@/lib/db";
import { apiRoute } from "@/server/http/api-route";
import { json } from "@/server/http/respond";
import { canAccessHost } from "@/server/auth/session-core";
import { loadCpuTempSettings, loadCpuTempWatchState, samplesOverTemp } from "@/server/services/cpu-temp-settings";

export const GET = apiRoute(["hosts.view", "settings.view"], async (_req, session) => {
  const settings = await loadCpuTempSettings();
  const state = await loadCpuTempWatchState();
  const samples = samplesOverTemp(state.samples, settings.alertCelsius).filter((sample) =>
    canAccessHost(session.user, sample.hostId),
  );
  return json({ ...settings, samples });
});

const patchSchema = z.object({
  alertCelsius: z.number().min(40).max(120),
  clearCelsius: z.number().min(40).max(120),
});

export const PATCH = apiRoute("settings.update", async (req) => {
  const body = patchSchema.parse(await req.json());
  const value = parseCpuTempSettings(body);
  await prisma.setting.upsert({
    where: { key: CPU_TEMP_SETTING_KEY },
    update: { value: value as unknown as Prisma.InputJsonValue },
    create: { key: CPU_TEMP_SETTING_KEY, value: value as unknown as Prisma.InputJsonValue },
  });
  return json({ setting: value });
});
