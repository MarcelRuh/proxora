import { HOST_RECONNECT_KICK_MS, nextHostProbeDelayMs } from "@/lib/host-probe";
import { prisma } from "@/lib/db";
import { logger } from "@/lib/logger";
import { probeAllHosts } from "@/server/services/host-service";

let scheduled = false;
let running = false;
let timer: ReturnType<typeof setTimeout> | null = null;
let kickSoon = false;

function clearTimer() {
  if (!timer) return;
  clearTimeout(timer);
  timer = null;
}

function arm(delayMs: number) {
  clearTimer();
  timer = setTimeout(() => {
    timer = null;
    void tick();
  }, delayMs);
  timer.unref?.();
}

async function tick() {
  if (running) {
    kickSoon = true;
    return;
  }
  running = true;
  kickSoon = false;
  try {
    await probeAllHosts();
  } catch (error) {
    logger.warn({ err: error }, "Host reconnect cycle failed");
  } finally {
    running = false;
    if (kickSoon) {
      arm(HOST_RECONNECT_KICK_MS);
      return;
    }
    const hosts = await prisma.host.findMany({ select: { connectionState: true } });
    arm(nextHostProbeDelayMs(hosts.map((h) => h.connectionState)));
  }
}

/** Probe immediately after a drop so connections come back without waiting for the next health check. */
export function requestHostReconnect() {
  if (!scheduled) return;
  kickSoon = true;
  if (running) return;
  arm(HOST_RECONNECT_KICK_MS);
}

export function startHostReconnectScheduler() {
  if (scheduled) return;
  scheduled = true;
  logger.info("Host reconnect scheduler started");
  void tick();
}
