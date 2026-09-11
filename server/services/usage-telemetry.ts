import { prisma } from "@/lib/db";
import { logger } from "@/lib/logger";
import {
  parseLivePingAt,
  shouldSendLivePing,
  usageAssetUrl,
  USAGE_LIVE_PING_SETTING_KEY,
  usageTelemetryEnabled,
  usageUserAgent,
} from "@/lib/usage-telemetry";

export const USAGE_TELEMETRY_CHECK_MS = 6 * 60 * 60 * 1000;

let scheduled = false;

async function pingLive(): Promise<boolean> {
  const res = await fetch(usageAssetUrl("live"), {
    method: "GET",
    redirect: "follow",
    headers: { "User-Agent": usageUserAgent() },
    signal: AbortSignal.timeout(8_000),
  });
  return res.ok;
}

async function tick(): Promise<void> {
  if (!usageTelemetryEnabled()) return;
  const row = await prisma.setting.findUnique({ where: { key: USAGE_LIVE_PING_SETTING_KEY } });
  const last = parseLivePingAt(row?.value);
  const now = Date.now();
  if (!shouldSendLivePing(last, now)) return;
  const ok = await pingLive();
  if (!ok) return;
  await prisma.setting.upsert({
    where: { key: USAGE_LIVE_PING_SETTING_KEY },
    update: { value: { at: now } },
    create: { key: USAGE_LIVE_PING_SETTING_KEY, value: { at: now } },
  });
}

export function startUsageTelemetry(): void {
  if (scheduled) return;
  scheduled = true;
  const run = () => {
    void tick().catch((error) => logger.debug({ err: error }, "usage telemetry ping skipped"));
  };
  setTimeout(run, 20_000);
  setInterval(run, USAGE_TELEMETRY_CHECK_MS);
}
