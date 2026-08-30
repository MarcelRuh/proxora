import { guestFilesystemUsage, parseGuestFsInfo } from "@/lib/disk-alerts";
import type { ProxmoxClient } from "@/server/proxmox/client";

const TTL_MS = 90_000;
const cache = new Map<string, { used: number; total: number; at: number }>();

export async function vmDiskFromAgent(
  client: ProxmoxClient,
  node: string,
  vmid: number,
): Promise<{ used: number; total: number } | null> {
  const key = `${client.http.baseUrl}:${node}:${vmid}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL_MS) return { used: hit.used, total: hit.total };
  const fs = await client.vms.agentFsInfo(node, vmid).catch(() => null);
  const usage = guestFilesystemUsage(parseGuestFsInfo(fs));
  if (!usage) return null;
  cache.set(key, { ...usage, at: Date.now() });
  return usage;
}

export function isQemuAgentEnabled(config: Record<string, unknown> | undefined | null): boolean {
  const raw = config?.agent;
  if (raw === 1 || raw === "1") return true;
  const text = String(raw ?? "");
  return /(?:^|,)enabled=1(?:$|,)/.test(text) || text === "1";
}
