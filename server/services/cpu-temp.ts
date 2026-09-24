import { ProxmoxApiError } from "@/lib/errors";
import { cpuTempFromNodeStatus, cpuTempFromSensorRows, cpuTempFromSensorsJson, type CpuTempReading } from "@/lib/cpu-temp";
import type { ProxmoxClient } from "@/server/proxmox/client";

function missingSensor(error: unknown): boolean {
  if (!(error instanceof ProxmoxApiError)) return false;
  return error.status === 404 || error.status === 501 || error.status === 500 || error.status === 400;
}

/** Stock PVE has no temperature API. Try the sensors endpoint, then node status extras. */
export async function readNodeCpuTemp(client: ProxmoxClient, node: string): Promise<CpuTempReading | null> {
  try {
    const rows = await client.nodes.cpuTemperature(node);
    const fromApi = cpuTempFromSensorRows(rows) ?? cpuTempFromSensorsJson(rows);
    if (fromApi) return fromApi;
  } catch (error) {
    if (!missingSensor(error) && !(error instanceof ProxmoxApiError)) return null;
  }
  try {
    const status = await client.nodes.status(node);
    return cpuTempFromNodeStatus(status);
  } catch {
    return null;
  }
}
