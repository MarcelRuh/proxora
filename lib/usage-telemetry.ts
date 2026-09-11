import { APP_VERSION, DEFAULT_GITHUB_REPO } from "@/lib/version";

export const USAGE_RELEASE_TAG = "stats";
export const USAGE_ASSET_INSTALL = "install";
export const USAGE_ASSET_LIVE = "live";
export const USAGE_PING_INTERVAL_MS = 7 * 24 * 60 * 60 * 1000;
export const USAGE_LIVE_PING_SETTING_KEY = "telemetry.livePing";

export type UsageSnapshot = {
  at: string;
  install: number;
  live: number;
};

export function usageTelemetryEnabled(env: NodeJS.Dict<string | undefined> = process.env): boolean {
  if ((env.NODE_ENV ?? "").trim() !== "production") return false;
  const raw = (env.PROXORA_TELEMETRY ?? "1").trim().toLowerCase();
  return raw !== "0" && raw !== "false" && raw !== "off" && raw !== "no";
}

export function usageAssetUrl(asset: "install" | "live", repo?: string): string {
  const name = (repo || process.env.PROXORA_REPO || DEFAULT_GITHUB_REPO).trim() || DEFAULT_GITHUB_REPO;
  return `https://github.com/${name}/releases/download/${USAGE_RELEASE_TAG}/${asset}`;
}

export function usageUserAgent(version = APP_VERSION): string {
  return `Proxora/${version} (+https://github.com/${DEFAULT_GITHUB_REPO})`;
}

export function shouldSendLivePing(lastPingAt: number | null | undefined, now: number, intervalMs = USAGE_PING_INTERVAL_MS): boolean {
  if (!lastPingAt || lastPingAt <= 0) return true;
  return now - lastPingAt >= intervalMs;
}

export function parseLivePingAt(value: unknown): number | null {
  if (!value || typeof value !== "object") return null;
  const at = (value as { at?: unknown }).at;
  const n = typeof at === "number" ? at : Number(at);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/** If each instance pings at most once per week, the 7-day live delta ≈ active installs. */
export function weeklyActive(history: UsageSnapshot[], now = Date.now(), windowMs = USAGE_PING_INTERVAL_MS): number {
  if (!history.length) return 0;
  const latest = history[history.length - 1]!;
  const cutoff = now - windowMs;
  let baseline = history[0]!.live;
  for (const row of history) {
    if (new Date(row.at).getTime() <= cutoff) baseline = row.live;
  }
  return Math.max(0, latest.live - baseline);
}
