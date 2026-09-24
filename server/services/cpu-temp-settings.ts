import { prisma } from "@/lib/db";
import {
  CPU_TEMP_SETTING_KEY,
  CPU_TEMP_WATCH_STATE_KEY,
  parseCpuTempSettings,
  parseCpuTempWatchState,
  type CpuTempAlertSettings,
  type CpuTempSample,
  type CpuTempWatchState,
} from "@/lib/cpu-temp";
import type { Prisma } from "@prisma/client";

export async function loadCpuTempSettings(): Promise<CpuTempAlertSettings> {
  const row = await prisma.setting.findUnique({ where: { key: CPU_TEMP_SETTING_KEY } });
  return parseCpuTempSettings(row?.value);
}

export async function loadCpuTempWatchState(): Promise<CpuTempWatchState> {
  const row = await prisma.setting.findUnique({ where: { key: CPU_TEMP_WATCH_STATE_KEY } });
  return parseCpuTempWatchState(row?.value);
}

export async function saveCpuTempWatchState(state: CpuTempWatchState): Promise<void> {
  const value = state as unknown as Prisma.InputJsonValue;
  await prisma.setting.upsert({
    where: { key: CPU_TEMP_WATCH_STATE_KEY },
    update: { value },
    create: { key: CPU_TEMP_WATCH_STATE_KEY, value },
  });
}

export function samplesOverTemp(samples: CpuTempSample[], alertCelsius: number): CpuTempSample[] {
  return samples.filter((sample) => sample.celsius >= alertCelsius).sort((a, b) => b.celsius - a.celsius);
}
