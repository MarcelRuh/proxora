import { z } from "zod";
import { Prisma } from "@prisma/client";
import { apiRoute } from "@/server/http/api-route";
import { json } from "@/server/http/respond";
import { prisma } from "@/lib/db";
import { DISK_ALERT_SETTING_KEY, parseDiskAlertSettings } from "@/lib/disk-alerts";
import { canAccessHost } from "@/server/auth/session-core";
import { loadDiskAlertSettings, loadDiskWatchState, samplesOverThreshold } from "@/server/services/disk-settings";

export const GET = apiRoute(["storage.view", "hosts.view", "settings.view"], async (_req, session) => {
  const settings = await loadDiskAlertSettings();
  const state = await loadDiskWatchState();
  const samples = samplesOverThreshold(state.samples, settings.alertPercent).filter((sample) =>
    canAccessHost(session.user, sample.hostId),
  );
  return json({ ...settings, samples });
});

const patchSchema = z.object({
  alertPercent: z.number().min(1).max(99),
  clearPercent: z.number().min(1).max(99),
});

export const PATCH = apiRoute("settings.update", async (req) => {
  const body = patchSchema.parse(await req.json());
  const value = parseDiskAlertSettings(body);
  await prisma.setting.upsert({
    where: { key: DISK_ALERT_SETTING_KEY },
    update: { value: value as unknown as Prisma.InputJsonValue },
    create: { key: DISK_ALERT_SETTING_KEY, value: value as unknown as Prisma.InputJsonValue },
  });
  return json({ setting: value });
});
