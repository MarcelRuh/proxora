import { WireguardPeerKind } from "@prisma/client";
import { prisma } from "@/lib/db";
import { logger } from "@/lib/logger";
import {
  clearWireguardUnreachableState,
  notifyWireguardUnreachable,
} from "@/server/notifications/ops-alerts";
import { probeProxoraPeers } from "@/server/services/wireguard-service";

export const WG_PROBE_INTERVAL_MS = 2 * 60_000;
export const WG_PROBE_STARTUP_DELAY_MS = 90_000;

let scheduled = false;
let running = false;
let timer: ReturnType<typeof setTimeout> | null = null;

export async function scanWireguardPeerReachability(): Promise<number> {
  const peers = await prisma.wireguardPeer.count({ where: { kind: WireguardPeerKind.PROXORA } });
  if (peers === 0) {
    clearWireguardUnreachableState();
    return 0;
  }
  const reachability = await probeProxoraPeers();
  return notifyWireguardUnreachable(reachability);
}

async function tick(): Promise<void> {
  if (running) return;
  running = true;
  try {
    const notified = await scanWireguardPeerReachability();
    if (notified) logger.info({ notified }, "WireGuard peer reachability notifications sent");
  } catch (error) {
    logger.warn({ err: error }, "WireGuard peer probe cycle failed");
  } finally {
    running = false;
    timer = setTimeout(() => {
      void tick();
    }, WG_PROBE_INTERVAL_MS);
    timer.unref?.();
  }
}

export function startWireguardProbeWatchScheduler() {
  if (scheduled) return;
  scheduled = true;
  logger.info(
    { intervalMs: WG_PROBE_INTERVAL_MS, startupDelayMs: WG_PROBE_STARTUP_DELAY_MS },
    "WireGuard peer probe watch started",
  );
  const startup = setTimeout(() => {
    void tick();
  }, WG_PROBE_STARTUP_DELAY_MS);
  startup.unref?.();
}
