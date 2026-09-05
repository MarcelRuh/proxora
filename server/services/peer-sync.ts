import { logger } from "@/lib/logger";
import { syncPeerHosts } from "@/server/services/federation-service";

export const PEER_SYNC_INTERVAL_MS = 60_000;
let timer: ReturnType<typeof setInterval> | null = null;
let running = false;
let kickQueued = false;

export function startPeerSyncScheduler() {
  if (timer) return;
  timer = setInterval(() => {
    void tick();
  }, PEER_SYNC_INTERVAL_MS);
  void tick();
}

/** Run a sync soon after pairing or share changes instead of waiting for the interval. */
export function requestPeerSync() {
  if (!timer) return;
  if (running) {
    kickQueued = true;
    return;
  }
  void tick();
}

async function tick() {
  if (running) {
    kickQueued = true;
    return;
  }
  running = true;
  kickQueued = false;
  try {
    await syncPeerHosts();
  } catch (error) {
    logger.warn({ err: error }, "Peer sync failed");
  } finally {
    running = false;
    if (kickQueued) void tick();
  }
}
