"use client";

import { useQuery, type QueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import type { Dashboard, DashboardGuests, Guest } from "@/lib/types";

export const DASHBOARD_POLL_MS = 45_000;
export const GUEST_IP_RETRY_MS = 8_000;

export function invalidateDashboardQueries(qc: QueryClient) {
  return Promise.all([
    qc.invalidateQueries({ queryKey: ["dashboard"] }),
    qc.invalidateQueries({ queryKey: ["dashboard-guests"] }),
  ]);
}

export function useDashboard() {
  return useQuery({
    queryKey: ["dashboard"],
    queryFn: () => api<Dashboard>("/api/dashboard"),
    refetchInterval: DASHBOARD_POLL_MS,
    staleTime: 30_000,
    placeholderData: (previous) => previous,
  });
}

function guestsNeedIpRetry(data: DashboardGuests | undefined, kind: "vm" | "lxc" | "all") {
  if (!data) return true;
  const rows = kind === "vm" ? data.vms : kind === "lxc" ? data.containers : [...data.vms, ...data.containers];
  return rows.some((g) => g.status === "running" && !g.template && !(g.ips && g.ips.length));
}

export function useDashboardGuests(kind: "vm" | "lxc" | "all" = "all") {
  return useQuery({
    queryKey: ["dashboard-guests", kind],
    queryFn: () => api<DashboardGuests>(`/api/dashboard/guests?kind=${kind}`),
    refetchInterval: (query) => (guestsNeedIpRetry(query.state.data, kind) ? GUEST_IP_RETRY_MS : DASHBOARD_POLL_MS),
    staleTime: 15_000,
    placeholderData: (previous) => previous,
  });
}

export function dashboardGuests(data: DashboardGuests | undefined, kind: "vm" | "lxc"): Guest[] {
  const rows = kind === "vm" ? data?.vms : data?.containers;
  return (rows ?? []).map((g) => ({ ...g, kind }));
}
