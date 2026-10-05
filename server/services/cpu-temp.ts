import { ProxmoxApiError } from "@/lib/errors";
import { cpuTempFromNodeStatus, cpuTempFromSensorRows, cpuTempFromSensorsJson, type CpuTempReading } from "@/lib/cpu-temp";
import type { ProxmoxClient } from "@/server/proxmox/client";
import { readNodeHwmon } from "@/server/services/node-hwmon";

const CACHE_MS = 60_000;
const cache = new Map<string, { at: number; value: CpuTempReading | null }>();
const inflight = new Map<string, Promise<CpuTempReading | null>>();

/** A failed refresh must not wipe a temperature that is already on screen. */
export function retainCpuTemp(previous: CpuTempReading | null, next: CpuTempReading | null): CpuTempReading | null {
  return next ?? previous;
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

async function readUncached(client: ProxmoxClient, node: string): Promise<CpuTempReading | null> {
  try {
    const rows = await client.nodes.cpuTemperature(node);
    const fromApi = cpuTempFromSensorRows(rows) ?? cpuTempFromSensorsJson(rows);
    if (fromApi) return fromApi;
  } catch (error) {
    if (!missingSensor(error) && !(error instanceof ProxmoxApiError)) return null;
  }
  try {
    const status = await client.nodes.status(node);
    const fromStatus = cpuTempFromNodeStatus(status);
    if (fromStatus) return fromStatus;
  } catch (error) {
    if (!missingSensor(error) && !(error instanceof ProxmoxApiError)) return null;
  }
  return readNodeHwmon(client, node);
}

/** Sensors API, then node status, then one hwmon read over the node shell. */
export function readNodeCpuTemp(client: ProxmoxClient, node: string): Promise<CpuTempReading | null> {
  const key = cacheKey(client, node);
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_MS) return Promise.resolve(hit.value);
  const pending = inflight.get(key);
  if (pending) return pending;
  const job = readUncached(client, node)
    .then((value) => {
      const kept = retainCpuTemp(cache.get(key)?.value ?? null, value);
      cache.set(key, { at: Date.now(), value: kept });
      return kept;
    })
    .finally(() => {
      inflight.delete(key);
    });
  inflight.set(key, job);
  return job;
}
