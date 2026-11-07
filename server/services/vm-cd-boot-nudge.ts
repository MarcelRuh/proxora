import { cdBootNudgePlan } from "@/lib/vm-cd-boot-nudge";
import { logger } from "@/lib/logger";
import type { ProxmoxClient } from "@/server/proxmox/client";

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Fire-and-forget Space presses so Windows CD boot does not time out into PXE. */
export function scheduleVmCdBootNudge(client: ProxmoxClient, node: string, vmid: number) {
  void (async () => {
    for (const step of cdBootNudgePlan()) {
      await sleep(step.delayMs);
      try {
        await client.vms.sendkey(node, vmid, step.key);
      } catch (error) {
        logger.warn(
          { node, vmid, key: step.key, err: error instanceof Error ? error.message : String(error) },
          "VM CD boot nudge sendkey failed",
        );
      }
    }
  })();
}
