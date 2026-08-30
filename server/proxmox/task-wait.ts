import { ProxmoxApiError } from "@/lib/errors";
import type { ProxmoxClient } from "@/server/proxmox/client";

export const TASK_TIMEOUT = {
  start: 120_000,
  stop: 120_000,
  reboot: 180_000,
  delete: 300_000,
  create: 300_000,
  backup: 14_400_000,
  snapshot: 180_000,
  clone: 600_000,
  migrate: 600_000,
  config: 60_000,
  resize: 180_000,
} as const;

export function isUpid(value: unknown): value is string {
  return typeof value === "string" && value.includes("UPID:");
}

export function timeoutForGuestAction(action: string): number {
  switch (action) {
    case "start":
    case "stop":
    case "shutdown":
    case "pause":
    case "resume":
      return TASK_TIMEOUT.start;
    case "reboot":
    case "reset":
      return TASK_TIMEOUT.reboot;
    case "delete":
      return TASK_TIMEOUT.delete;
    case "clone":
      return TASK_TIMEOUT.clone;
    case "migrate":
      return TASK_TIMEOUT.migrate;
    case "snapshot":
    case "snapshot-delete":
    case "snapshot-rollback":
      return TASK_TIMEOUT.snapshot;
    case "resize":
      return TASK_TIMEOUT.resize;
    default:
      return TASK_TIMEOUT.config;
  }
}

export async function waitUpid(
  client: ProxmoxClient,
  node: string,
  upid: unknown,
  timeoutMs: number,
): Promise<{ durationMs: number; upid?: string }> {
  const started = Date.now();
  if (!isUpid(upid)) return { durationMs: Date.now() - started };
  await client.tasks.wait(node, upid, timeoutMs);
  return { durationMs: Date.now() - started, upid };
}

export async function waitGuestAction(
  client: ProxmoxClient,
  node: string,
  upid: unknown,
  action: string,
): Promise<unknown> {
  try {
    await waitUpid(client, node, upid, timeoutForGuestAction(action));
    return upid;
  } catch (error) {
    if (error instanceof ProxmoxApiError) throw error;
    throw error;
  }
}
