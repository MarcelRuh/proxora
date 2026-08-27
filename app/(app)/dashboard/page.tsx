"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ProgressBar, Skeleton } from "@/components/ui/misc";
import { HostStateBadge, GuestStateBadge } from "@/components/status-badge";
import { Badge } from "@/components/ui/badge";
import { api } from "@/lib/api";
import { bytesToSize, formatUptime, percentage } from "@/lib/utils";

type Guest = {
  vmid: number;
  name: string;
  node: string;
  status: string;
  hostId: string;
  hostName: string;
  template?: boolean;
  kind: "vm" | "lxc";
};

type Dashboard = {
  hosts: {
    total: number;
    online: number;
    offline: number;
    warning: number;
    items: Array<{
      id: string;
      name: string;
      connectionState: string;
      proxmoxVersion: string | null;
      cpu?: number;
      memUsed?: number;
      memTotal?: number;
      diskUsed?: number;
      diskTotal?: number;
      uptime?: number;
      lastError?: string | null;
    }>;
  };
  virtualization: { vms: number; lxc: number; running: number; stopped: number; paused: number };
  resources: { cpu: number; memUsed: number; memTotal: number; diskUsed: number; diskTotal: number };
  guests: {
    vms: Array<Omit<Guest, "kind">>;
    containers: Array<Omit<Guest, "kind">>;
  };
};

export default function DashboardPage() {
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ["dashboard"],
    queryFn: () => api<Dashboard>("/api/dashboard"),
    refetchInterval: 15_000,
  });

  if (isLoading) {
    return (
      <div className="grid gap-4 md:grid-cols-4">
        {Array.from({ length: 8 }).map((_, i) => (
          <Skeleton key={i} className="h-28" />
        ))}
      </div>
    );
  }
  if (error || !data) {
    return (
      <div className="rounded-xl border border-destructive/40 p-6">
        <p className="font-medium">Dashboard konnte nicht geladen werden</p>
        <p className="text-sm text-muted-foreground">{error instanceof Error ? error.message : "Unknown error"}</p>
        <button className="mt-3 text-sm underline" onClick={() => void refetch()}>
          Erneut versuchen
        </button>
      </div>
    );
  }

  const guests: Guest[] = [
    ...(data.guests?.vms ?? []).map((g) => ({ ...g, kind: "vm" as const })),
    ...(data.guests?.containers ?? []).map((g) => ({ ...g, kind: "lxc" as const })),
  ].sort((a, b) => a.vmid - b.vmid || a.name.localeCompare(b.name));

  const stats = [
    { label: "Hosts", value: data.hosts.total, hint: `${data.hosts.online} online` },
    { label: "VMs", value: data.virtualization.vms, hint: `${data.virtualization.running} running` },
    { label: "Container", value: data.virtualization.lxc, hint: `${data.virtualization.stopped} stopped` },
    {
      label: "RAM",
      value: `${percentage(data.resources.memUsed, data.resources.memTotal)}%`,
      hint: `${bytesToSize(data.resources.memUsed)} / ${bytesToSize(data.resources.memTotal)}`,
    },
  ];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Dashboard</h1>
        <p className="text-sm text-muted-foreground">Übersicht aller Hosts, VMs und Container.</p>
      </div>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {stats.map((s) => (
          <Card key={s.label}>
            <CardHeader>
              <CardTitle className="text-muted-foreground">{s.label}</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-2xl font-semibold">{s.value}</p>
              <p className="text-xs text-muted-foreground">{s.hint}</p>
            </CardContent>
          </Card>
        ))}
      </div>
      <Card>
        <CardHeader>
          <CardTitle>Hosts</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {data.hosts.items.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Noch keine Hosts. <Link className="underline" href="/hosts">Proxmox-Host hinzufügen</Link>.
            </p>
          ) : (
            data.hosts.items.map((h) => (
              <Link key={h.id} href={`/hosts/${h.id}`} className="block rounded-lg border border-border p-3 hover:bg-muted/40">
                <div className="mb-2 flex items-center justify-between">
                  <div>
                    <p className="font-medium">{h.name}</p>
                    <p className="text-xs text-muted-foreground">Proxmox VE {h.proxmoxVersion ?? "unknown"}</p>
                  </div>
                  <HostStateBadge state={h.connectionState as never} />
                </div>
                {h.connectionState === "ONLINE" ? (
                  <div className="grid gap-2 sm:grid-cols-3">
                    <Metric label="CPU" value={(h.cpu ?? 0) * 100} />
                    <Metric label="RAM" value={percentage(h.memUsed, h.memTotal)} />
                    <Metric label="Storage" value={percentage(h.diskUsed, h.diskTotal)} />
                  </div>
                ) : (
                  <p className="text-sm text-destructive">{h.lastError ?? "Unavailable"}</p>
                )}
                {h.uptime ? <p className="mt-2 text-xs text-muted-foreground">Uptime {formatUptime(h.uptime)}</p> : null}
              </Link>
            ))
          )}
        </CardContent>
      </Card>
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle>VMs &amp; Container</CardTitle>
          <span className="text-xs text-muted-foreground">{guests.length}</span>
        </CardHeader>
        <CardContent>
          {guests.length === 0 ? (
            <p className="text-sm text-muted-foreground">Keine VMs oder Container.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="text-[11px] uppercase tracking-wide text-muted-foreground">
                  <tr>
                    <th className="px-2 py-2 font-medium">ID</th>
                    <th className="px-2 py-2 font-medium">Typ</th>
                    <th className="px-2 py-2 font-medium">Name</th>
                    <th className="px-2 py-2 font-medium">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {guests.map((g) => (
                    <tr key={`${g.kind}-${g.hostId}-${g.node}-${g.vmid}`} className="border-t border-border hover:bg-muted/30">
                      <td className="px-2 py-2 font-mono font-semibold">
                        <Link href={guestHref(g)} className="hover:underline">
                          {g.vmid}
                        </Link>
                      </td>
                      <td className="px-2 py-2">
                        <Badge variant={g.kind === "vm" ? "default" : "muted"}>{g.kind === "vm" ? "VM" : "LXC"}</Badge>
                      </td>
                      <td className="px-2 py-2">
                        <Link href={guestHref(g)} className="hover:underline">
                          {g.name}
                          {g.template ? <span className="text-xs text-muted-foreground"> (template)</span> : null}
                        </Link>
                      </td>
                      <td className="px-2 py-2">
                        <GuestStateBadge status={g.status} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function guestHref(g: Guest) {
  return g.kind === "vm" ? `/vms/${g.hostId}/${g.node}/${g.vmid}` : `/containers/${g.hostId}/${g.node}/${g.vmid}`;
}

function Metric({ label, value }: { label: string; value: number }) {
  return (
    <div>
      <div className="mb-1 flex justify-between text-xs text-muted-foreground">
        <span>{label}</span>
        <span>{Math.round(value)}%</span>
      </div>
      <ProgressBar value={value} />
    </div>
  );
}
