"use client";

import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import type { GuestIpNetwork } from "@/lib/create-ip";
import type { LxcIpMode } from "@/lib/lxc-net";
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

export function useCreateOptions(hostId: string, ipMode: LxcIpMode) {
  const options = useQuery({
    queryKey: ["options", hostId],
    enabled: Boolean(hostId),
    queryFn: () => api<CreateOptions>(`/api/hosts/${hostId}/options`),
    staleTime: 15_000,
    placeholderData: (previous) => previous,
  });
  const media = useQuery({
    queryKey: ["options-media", hostId],
    enabled: Boolean(hostId),
    queryFn: () => api<CreateOptions>(`/api/hosts/${hostId}/options?media=1`),
    staleTime: 20_000,
    placeholderData: (previous) => previous,
  });
  const ips = useQuery({
    queryKey: ["options-ips", hostId],
    enabled: Boolean(hostId) && ipMode === "static",
    queryFn: () => api<Pick<CreateOptions, "usedIps" | "usedVmids" | "nextid">>(`/api/hosts/${hostId}/options?ips=1`),
    staleTime: 30_000,
  });

  const data = options.data
    ? {
        ...options.data,
        isos: media.data?.isos ?? options.data.isos,
        templates: media.data?.templates ?? options.data.templates,
        usedIps: ips.data?.usedIps ?? options.data.usedIps ?? [],
      }
    : undefined;

  return { data, isLoading: options.isLoading, error: options.error };
}
