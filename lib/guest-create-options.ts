import type { GuestIpNetwork } from "@/lib/create-ip";
import type { StorageOverviewItem } from "@/lib/storage-overview";

export type CreateOptions = {
  nodes: Array<{ node: string }>;
  nextid: number | null;
  storage: StorageOverviewItem[];
  isos: Array<{ volid?: string }>;
  templates: Array<{ volid?: string }>;
  bridges: Array<{ iface?: string; type?: string }>;
  networks?: GuestIpNetwork[];
  usedIps?: string[];
  usedVmids?: number[];
};

/** Keep cached create-options only when the host id in queryKey[1] still matches. */
export function sameHostPlaceholder<T>(
  hostId: string,
  previous: T | undefined,
  previousQuery: { queryKey: readonly unknown[] } | undefined,
): T | undefined {
  return previousQuery?.queryKey[1] === hostId ? previous : undefined;
}

export function createOptionsPath(
  hostId: string,
  extras?: { node?: string; media?: boolean; ips?: boolean },
): string {
  const q = new URLSearchParams();
  if (extras?.node) q.set("node", extras.node);
  if (extras?.media) q.set("media", "1");
  if (extras?.ips) q.set("ips", "1");
  const qs = q.toString();
  return `/api/hosts/${hostId}/options${qs ? `?${qs}` : ""}`;
}

export function mergeCreateOptions(
  shell: CreateOptions | undefined,
  media?: Pick<CreateOptions, "isos" | "templates">,
  identity?: Pick<CreateOptions, "usedIps" | "usedVmids" | "nextid">,
): CreateOptions | undefined {
  if (!shell) return undefined;
  return {
    ...shell,
    isos: media?.isos ?? shell.isos,
    templates: media?.templates ?? shell.templates,
    usedIps: identity?.usedIps ?? shell.usedIps ?? [],
    usedVmids: identity?.usedVmids ?? shell.usedVmids,
    nextid: identity?.nextid ?? shell.nextid,
  };
}

/** Keep a user-edited VMID; follow server suggestions while the field is still auto-filled. */
export function nextAutoVmid(current: number, suggested: number, lastAuto: number): number {
  if (suggested <= 0) return current;
  if (current <= 0 || current === lastAuto) return suggested;
  return current;
}
