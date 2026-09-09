"use client";

import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { createOptionsPath, mergeCreateOptions, sameHostPlaceholder, type CreateOptions } from "@/lib/guest-create-options";
import type { LxcIpMode } from "@/lib/lxc-net";

export type { CreateOptions };

export function useCreateOptions(hostId: string, ipMode: LxcIpMode, node = "") {
  const nodeParam = node.trim();
  const options = useQuery({
    queryKey: ["options", hostId, nodeParam],
    enabled: Boolean(hostId),
    queryFn: () => api<CreateOptions>(createOptionsPath(hostId, { node: nodeParam || undefined })),
    staleTime: 15_000,
    placeholderData: (previous, previousQuery) => sameHostPlaceholder(hostId, previous, previousQuery),
  });
  const media = useQuery({
    queryKey: ["options-media", hostId, nodeParam],
    enabled: Boolean(hostId),
    queryFn: () => api<CreateOptions>(createOptionsPath(hostId, { node: nodeParam || undefined, media: true })),
    staleTime: 20_000,
    placeholderData: (previous, previousQuery) => sameHostPlaceholder(hostId, previous, previousQuery),
  });
  const ips = useQuery({
    queryKey: ["options-ips", hostId],
    enabled: Boolean(hostId) && ipMode === "static",
    queryFn: () =>
      api<Pick<CreateOptions, "usedIps" | "usedVmids" | "nextid">>(createOptionsPath(hostId, { ips: true })),
    staleTime: 30_000,
  });

  const data = useMemo(
    () =>
      mergeCreateOptions(
        options.data,
        media.data,
        ipMode === "static" ? ips.data : undefined,
      ),
    [options.data, media.data, ips.data, ipMode],
  );

  return { data, isLoading: options.isLoading, error: options.error };
}
