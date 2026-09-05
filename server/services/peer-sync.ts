import { logger } from "@/lib/logger";
import { syncPeerHosts } from "@/server/services/federation-service";

const INTERVAL_MS = 20_000;
let timer: ReturnType<typeof setInterval> | null = null;
let running = false;

export function startPeerSyncScheduler() {
  if (timer) return;
  timer = setInterval(() => {
    void tick();
  }, INTERVAL_MS);
  void tick();
}

async function tick() {
  if (running) return;
  running = true;
  try {
    await syncPeerHosts();
  } catch (error) {
    logger.warn({ err: error }, "Peer sync failed");
  } finally {
    running = false;
  }
}
