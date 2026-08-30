"use client";

import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import type { Dashboard, Guest } from "@/lib/types";

export const DASHBOARD_POLL_MS = 30_000;

export function useDashboard() {
  return useQuery({
    queryKey: ["dashboard"],
    queryFn: () => api<Dashboard>("/api/dashboard"),
    refetchInterval: DASHBOARD_POLL_MS,
  });
}

export function dashboardGuests(data: Dashboard | undefined, kind: "vm" | "lxc"): Guest[] {
  const rows = kind === "vm" ? data?.guests.vms : data?.guests.containers;
  return (rows ?? []).map((g) => ({ ...g, kind }));
}
