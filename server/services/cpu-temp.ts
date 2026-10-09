import { ProxmoxApiError } from "@/lib/errors";
import { cpuTempFromNodeStatus, cpuTempFromSensorRows, cpuTempFromSensorsJson, type CpuTempReading } from "@/lib/cpu-temp";
import type { ProxmoxClient } from "@/server/proxmox/client";
import { readNodeHwmon } from "@/server/services/node-hwmon";

const CACHE_MS = 60_000;
/** Keep “no sensors” / failed reads longer so host pages do not reopen termproxy often. */
const CACHE_NEGATIVE_MS = 5 * 60_000;

export type CpuTempOutcome = "value" | "none" | "failed";

type CachedTemp = { at: number; value: CpuTempReading | null; outcome: CpuTempOutcome };

const cache = new Map<string, CachedTemp>();
const inflight = new Map<string, Promise<CpuTempReading | null>>();

/** A failed refresh must not wipe a temperature that is already on screen. */
export function retainCpuTemp(previous: CpuTempReading | null, next: CpuTempReading | null): CpuTempReading | null {
  return next ?? previous;
}

export function mergeCpuTemp(
  previous: { value: CpuTempReading | null; outcome: CpuTempOutcome } | undefined,
  next: { reading: CpuTempReading | null; outcome: CpuTempOutcome },
): { value: CpuTempReading | null; outcome: CpuTempOutcome } {
  const value = retainCpuTemp(previous?.value ?? null, next.reading);
  if (value) return { value, outcome: "value" };
  if (next.outcome === "none" || previous?.outcome === "none") return { value: null, outcome: "none" };
  return { value: null, outcome: "failed" };
}

function cacheKey(client: ProxmoxClient, node: string): string {
  return `${client.http.baseUrl}\n${node}`;
}

function missingSensor(error: unknown): boolean {
  if (!(error instanceof ProxmoxApiError)) return false;
  return error.status === 404 || error.status === 501 || error.status === 500 || error.status === 400;
}

/**
 * Last temperature for this node. A stale reading stays visible while a refresh
 * runs. `null` means a finished read found no sensors and stays that way until a
 * later read finds one. `undefined` means no read has finished yet.
 * Does not start a new read.
 */
export function peekNodeCpuTemp(client: ProxmoxClient, node: string): CpuTempReading | null | undefined {
  const hit = cache.get(cacheKey(client, node));
  if (!hit) return undefined;
  return hit.value;
}

/** `undefined` means no read has finished. `failed` is a read that did not reach the sensors. */
export function peekNodeCpuTempOutcome(client: ProxmoxClient, node: string): CpuTempOutcome | undefined {
  return cache.get(cacheKey(client, node))?.outcome;
}

async function readUncached(
  client: ProxmoxClient,
  node: string,
): Promise<{ reading: CpuTempReading | null; outcome: CpuTempOutcome }> {
  try {
    const rows = await client.nodes.cpuTemperature(node);
    const fromApi = cpuTempFromSensorRows(rows) ?? cpuTempFromSensorsJson(rows);
    if (fromApi) return { reading: fromApi, outcome: "value" };
  } catch (error) {
    if (!missingSensor(error) && !(error instanceof ProxmoxApiError)) return { reading: null, outcome: "failed" };
  }
  try {
    const status = await client.nodes.status(node);
    const fromStatus = cpuTempFromNodeStatus(status);
    if (fromStatus) return { reading: fromStatus, outcome: "value" };
  } catch (error) {
    if (!missingSensor(error) && !(error instanceof ProxmoxApiError)) return { reading: null, outcome: "failed" };
  }
  const hwmon = await readNodeHwmon(client, node);
  if (hwmon.outcome === "value") return { reading: hwmon.reading, outcome: "value" };
  if (hwmon.outcome === "none") return { reading: null, outcome: "none" };
  return { reading: null, outcome: "failed" };
}

/** Sensors API, then node status, then one hwmon read over the node shell. */
export function readNodeCpuTemp(client: ProxmoxClient, node: string): Promise<CpuTempReading | null> {
  const key = cacheKey(client, node);
  const hit = cache.get(key);
  const ttl = hit?.outcome === "value" ? CACHE_MS : CACHE_NEGATIVE_MS;
  if (hit && Date.now() - hit.at < ttl) return Promise.resolve(hit.value);
  const pending = inflight.get(key);
  if (pending) return pending;
  const job = readUncached(client, node)
    .then((next) => {
      const merged = mergeCpuTemp(cache.get(key), next);
      cache.set(key, { at: Date.now(), ...merged });
      return merged.value;
    })
    .finally(() => {
      inflight.delete(key);
    });
  inflight.set(key, job);
  return job;
}
