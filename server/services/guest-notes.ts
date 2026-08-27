import { plainGuestNote } from "@/lib/guest-notes";
import type { ProxmoxClient } from "@/server/proxmox/client";
import type { GuestListItem } from "@/server/proxmox/types";

const TTL_MS = 120_000;
const cache = new Map<string, { value: string; at: number }>();

function cacheKey(baseUrl: string, kind: "vm" | "lxc", node: string, vmid: number) {
  return `${baseUrl}|${kind}|${node}|${vmid}`;
}

export function invalidateGuestNoteCache(baseUrl: string, kind: "vm" | "lxc", node: string, vmid: number) {
  cache.delete(cacheKey(baseUrl, kind, node, vmid));
}

export async function attachGuestNotes(
  client: ProxmoxClient,
  vms: GuestListItem[],
  containers: GuestListItem[],
): Promise<void> {
  const baseUrl = client.http.baseUrl;
  const jobs: Array<{ kind: "vm" | "lxc"; guest: GuestListItem }> = [
    ...vms.map((guest) => ({ kind: "vm" as const, guest })),
    ...containers.map((guest) => ({ kind: "lxc" as const, guest })),
  ].filter((job) => job.guest.vmid > 0 && job.guest.node);

  const now = Date.now();
  const toFetch: typeof jobs = [];
  for (const job of jobs) {
    const hit = cache.get(cacheKey(baseUrl, job.kind, job.guest.node, job.guest.vmid));
    if (hit && now - hit.at < TTL_MS) {
      if (hit.value) job.guest.description = hit.value;
    } else {
      toFetch.push(job);
    }
  }

  let i = 0;
  const workers = Array.from({ length: Math.min(6, toFetch.length) }, async () => {
    while (i < toFetch.length) {
      const job = toFetch[i++];
      if (!job) break;
      const cfg =
        job.kind === "vm"
          ? await client.vms.config(job.guest.node, job.guest.vmid).catch(() => null)
          : await client.lxc.config(job.guest.node, job.guest.vmid).catch(() => null);
      const note = plainGuestNote(cfg?.description) ?? "";
      cache.set(cacheKey(baseUrl, job.kind, job.guest.node, job.guest.vmid), { value: note, at: Date.now() });
      if (note) job.guest.description = note;
    }
  });
  await Promise.all(workers);
}
