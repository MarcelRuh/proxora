import { prisma } from "@/lib/db";
import {
  DISK_ALERT_SETTING_KEY,
  DISK_WATCH_STATE_KEY,
  parseDiskAlertSettings,
  parseDiskWatchState,
  type DiskAlertSettings,
  type DiskSample,
  type DiskWatchState,
} from "@/lib/disk-alerts";
import type { Prisma } from "@prisma/client";

export async function loadDiskAlertSettings(): Promise<DiskAlertSettings> {
  const row = await prisma.setting.findUnique({ where: { key: DISK_ALERT_SETTING_KEY } });
  return parseDiskAlertSettings(row?.value);
}

export async function loadDiskWatchState(): Promise<DiskWatchState> {
  const row = await prisma.setting.findUnique({ where: { key: DISK_WATCH_STATE_KEY } });
  return parseDiskWatchState(row?.value);
}

export async function saveDiskWatchState(state: DiskWatchState): Promise<void> {
  const value = state as unknown as Prisma.InputJsonValue;
  await prisma.setting.upsert({
    where: { key: DISK_WATCH_STATE_KEY },
    update: { value },
    create: { key: DISK_WATCH_STATE_KEY, value },
  });
}

export function samplesOverThreshold(samples: DiskSample[], alertPercent: number): DiskSample[] {
  return samples.filter((sample) => sample.percent >= alertPercent).sort((a, b) => b.percent - a.percent);
}
