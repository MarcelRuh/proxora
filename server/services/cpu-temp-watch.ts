import { prisma } from "@/lib/db";
import { applyCpuTempWatchState, cpuTempKey, type CpuTempSample } from "@/lib/cpu-temp";
import { logger } from "@/lib/logger";
import { notifyTopic } from "@/server/notifications/dispatch";
import { loadCpuTempSettings, loadCpuTempWatchState, saveCpuTempWatchState } from "@/server/services/cpu-temp-settings";
import { readNodeCpuTemp } from "@/server/services/cpu-temp";
import { clientForHost } from "@/server/services/host-service";
import { loadHostInventory } from "@/server/services/inventory-cache";

export const CPU_TEMP_WATCH_INTERVAL_MS = 5 * 60_000;
export const CPU_TEMP_WATCH_STARTUP_DELAY_MS = 50_000;

let scheduled = false;
let running = false;
let timer: ReturnType<typeof setTimeout> | null = null;

async function remember(samples: CpuTempSample[], alertCelsius: number, clearCelsius: number): Promise<number> {
  const state = await loadCpuTempWatchState();
  const liveKeys = new Set(samples.map((sample) => sample.key));
  const notified: Record<string, boolean> = {};
  for (const [key, flag] of Object.entries(state.notified)) {
    if (liveKeys.has(key)) notified[key] = flag;
  }
  let count = 0;
  for (const sample of samples) {
    const prev = notified[sample.key] ?? false;
    const next = applyCpuTempWatchState(prev, sample.celsius, alertCelsius, clearCelsius);
    notified[sample.key] = next.notified;
    if (!next.notify) continue;
    count += 1;
    const degrees = sample.celsius.toLocaleString("de-DE", { maximumFractionDigits: 1 });
    notifyTopic("host.cpu.hot", {
      level: "warning",
      title: `CPU ${Math.round(sample.celsius)} °C`,
      message: `${sample.node} auf ${sample.hostName}: ${degrees} °C (${sample.label})`,
      hostId: sample.hostId,
      name: sample.node,
      id: sample.node,
      host: sample.hostName,
      node: sample.node,
      href: `/hosts/${sample.hostId}`,
    });
  }
  await saveCpuTempWatchState({ notified, samples });
  return count;
}

export async function scanCpuTemps(): Promise<number> {
  const { alertCelsius, clearCelsius } = await loadCpuTempSettings();
  const hosts = await prisma.host.findMany({ orderBy: { name: "asc" } });
  const samples: CpuTempSample[] = [];

  for (const host of hosts) {
    if (host.connectionState === "OFFLINE" || host.connectionState === "MAINTENANCE") continue;
    try {
      const client = await clientForHost(host);
      const inv = await loadHostInventory(client, host.id);
      for (const node of inv.nodes) {
        if (!node.node || node.status === "offline") continue;
        const reading = await readNodeCpuTemp(client, node.node).catch(() => null);
        if (!reading) continue;
        samples.push({
          key: cpuTempKey(host.id, node.node),
          celsius: reading.celsius,
          label: reading.label,
          hostId: host.id,
          hostName: host.name,
          node: node.node,
        });
      }
    } catch (error) {
      logger.warn({ err: error, host: host.name }, "CPU temperature scan skipped host");
    }
  }

  return remember(samples, alertCelsius, clearCelsius);
}

async function tick() {
  if (running) return;
  running = true;
  try {
    const notifiedCount = await scanCpuTemps();
    if (notifiedCount) logger.info({ notified: notifiedCount }, "CPU temperature notifications sent");
  } catch (error) {
    logger.warn({ err: error }, "CPU temperature watch cycle failed");
  } finally {
    running = false;
    timer = setTimeout(() => {
      void tick();
    }, CPU_TEMP_WATCH_INTERVAL_MS);
    timer.unref?.();
  }
}

export function startCpuTempWatchScheduler() {
  if (scheduled) return;
  scheduled = true;
  logger.info(
    { intervalMs: CPU_TEMP_WATCH_INTERVAL_MS, startupDelayMs: CPU_TEMP_WATCH_STARTUP_DELAY_MS },
    "CPU temperature watch scheduler started",
  );
  const startup = setTimeout(() => {
    void tick();
  }, CPU_TEMP_WATCH_STARTUP_DELAY_MS);
  startup.unref?.();
}
