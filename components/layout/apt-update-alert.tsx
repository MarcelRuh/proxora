"use client";

import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";

export type AptSummary = {
  total: number;
  fingerprint: string;
  checkedAt: string | Date | null;
  hosts: Array<{ id: string; name: string; count: number; checkedAt: string | Date | null }>;
};

export function useAptSummary() {
  return useQuery({
    queryKey: ["apt-summary"],
    queryFn: () => api<AptSummary>("/api/updates/summary"),
    refetchInterval: 60_000,
    retry: false,
  });
}
