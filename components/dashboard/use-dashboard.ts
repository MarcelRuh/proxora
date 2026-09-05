"use client";

import { useQuery, type QueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import type { Dashboard, DashboardGuests, Guest } from "@/lib/types";

export const DASHBOARD_OVERVIEW_POLL_MS = 90_000;
export const DASHBOARD_GUESTS_POLL_MS = 45_000;
export const DASHBOARD_POLL_MS = DASHBOARD_GUESTS_POLL_MS;

export function invalidateDashboardQueries(qc: QueryClient) {
  return Promise.all([
    qc.invalidateQueries({ queryKey: ["dashboard"] }),
    qc.invalidateQueries({ queryKey: ["dashboard-guests"] }),
  ]);
}

export function applyGuestIpsToCache(
  qc: QueryClient,
  rows: Array<{ hostId: string; kind: "vm" | "lxc"; vmid: number; ips: string[] }>,
) {
  if (!rows.length) return;
  const map = new Map(rows.map((r) => [`${r.hostId}:${r.kind}:${r.vmid}`, r.ips]));
  qc.setQueriesData<DashboardGuests>({ queryKey: ["dashboard-guests"] }, (old) => {
    if (!old) return old;
    const patch = (list: DashboardGuests["vms"], kind: "vm" | "lxc") =>
      list.map((g) => {
        const ips = map.get(`${g.hostId}:${kind}:${g.vmid}`);
        return ips ? { ...g, ips } : g;
      });
    return { vms: patch(old.vms, "vm"), containers: patch(old.containers, "lxc") };
  });
}

export function useDashboard() {
  return useQuery({
    queryKey: ["dashboard"],
    queryFn: () => api<Dashboard>("/api/dashboard"),
    refetchInterval: DASHBOARD_OVERVIEW_POLL_MS,
    staleTime: 60_000,
    placeholderData: (previous) => previous,
  });
}

export function useDashboardGuests(kind: "vm" | "lxc" | "all" = "all") {
  return useQuery({
    queryKey: ["dashboard-guests", kind],
    queryFn: () => api<DashboardGuests>(`/api/dashboard/guests?kind=${kind}`),
    refetchInterval: DASHBOARD_GUESTS_POLL_MS,
    staleTime: 30_000,
    placeholderData: (previous) => previous,
  });
}

export function dashboardGuests(data: DashboardGuests | undefined, kind: "vm" | "lxc"): Guest[] {
  const rows = kind === "vm" ? data?.vms : data?.containers;
  return (rows ?? []).map((g) => ({ ...g, kind }));
}
