"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ProgressBar, Skeleton } from "@/components/ui/misc";
import { HostStateBadge, GuestStateBadge } from "@/components/status-badge";
import { api } from "@/lib/api";
import { bytesToSize, formatUptime, percentage } from "@/lib/utils";
import { SelfUpdateSection } from "@/components/settings/self-update-section";

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
  activity: Array<{
    id: string;
    action: string;
    target: string | null;
    createdAt: string;
    result: string;
    user: { username: string } | null;
    host: { name: string } | null;
  }>;
  guests: {
    vms: Array<{
      vmid: number;
      name: string;
      node: string;
      status: string;
      hostId: string;
      hostName: string;
      template?: boolean;
    }>;
    containers: Array<{
      vmid: number;
      name: string;
      node: string;
      status: string;
      hostId: string;
      hostName: string;
      template?: boolean;
    }>;
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
        <p className="font-medium">Unable to load dashboard</p>
        <p className="text-sm text-muted-foreground">{error instanceof Error ? error.message : "Unknown error"}</p>
        <button className="mt-3 text-sm underline" onClick={() => void refetch()}>
          Retry
        </button>
      </div>
    );
  }

  const stats = [
    { label: "Hosts", value: data.hosts.total, hint: `${data.hosts.online} online` },
    { label: "Online", value: data.hosts.online, hint: `${data.hosts.offline} offline` },
    { label: "Warnings", value: data.hosts.warning, hint: "errors / maintenance" },
    { label: "VMs", value: data.virtualization.vms, hint: `${data.virtualization.running} running` },
    { label: "Containers", value: data.virtualization.lxc, hint: `${data.virtualization.stopped} stopped` },
    { label: "CPU", value: `${Math.round(data.resources.cpu * 100)}%`, hint: "average across online hosts" },
    {
      label: "Memory",
      value: `${percentage(data.resources.memUsed, data.resources.memTotal)}%`,
      hint: `${bytesToSize(data.resources.memUsed)} / ${bytesToSize(data.resources.memTotal)}`,
    },
    {
      label: "Storage",
      value: `${percentage(data.resources.diskUsed, data.resources.diskTotal)}%`,
      hint: `${bytesToSize(data.resources.diskUsed)} used`,
    },
  ];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Dashboard</h1>
        <p className="text-sm text-muted-foreground">Fleet overview across independent Proxmox hosts.</p>
      </div>
      <SelfUpdateSection compact />
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
      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Hosts</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {data.hosts.items.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No hosts yet. <Link className="underline" href="/hosts">Add a Proxmox host</Link>.
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
          <CardHeader>
            <CardTitle>Recent activity</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {data.activity.map((a) => (
              <div key={a.id} className="text-sm">
                <p>
                  <span className="font-medium">{a.user?.username ?? "system"}</span> {a.action.toLowerCase().replaceAll("_", " ")}{" "}
                  {a.target}
                </p>
                <p className="text-xs text-muted-foreground">
                  {a.host?.name} · {new Date(a.createdAt).toLocaleString()}
                </p>
              </div>
            ))}
            {data.activity.length === 0 ? <p className="text-sm text-muted-foreground">No activity yet.</p> : null}
          </CardContent>
        </Card>
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <GuestIdCard
          title="VMs"
          empty="Keine VMs"
          items={data.guests?.vms ?? []}
          href={(g) => `/vms/${g.hostId}/${g.node}/${g.vmid}`}
        />
        <GuestIdCard
          title="Container"
          empty="Keine Container"
          items={data.guests?.containers ?? []}
          href={(g) => `/containers/${g.hostId}/${g.node}/${g.vmid}`}
        />
      </div>
    </div>
  );
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

function GuestIdCard({
  title,
  empty,
  items,
  href,
}: {
  title: string;
  empty: string;
  items: Array<{
    vmid: number;
    name: string;
    node: string;
    status: string;
    hostId: string;
    hostName: string;
    template?: boolean;
  }>;
  href: (item: { vmid: number; node: string; hostId: string }) => string;
}) {
  const sorted = [...items].sort((a, b) => a.vmid - b.vmid);
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle>{title}</CardTitle>
        <span className="text-xs text-muted-foreground">{sorted.length}</span>
      </CardHeader>
      <CardContent className="max-h-[28rem] space-y-1 overflow-auto">
        {sorted.length === 0 ? <p className="text-sm text-muted-foreground">{empty}</p> : null}
        {sorted.map((g) => (
          <Link
            key={`${g.hostId}-${g.node}-${g.vmid}`}
            href={href(g)}
            className="flex items-center justify-between gap-3 rounded-md px-2 py-1.5 text-sm hover:bg-muted/40"
          >
            <span className="min-w-0 truncate">
              <span className="font-mono font-semibold">{g.vmid}</span>
              <span className="text-muted-foreground"> · </span>
              {g.name}
              {g.template ? <span className="text-xs text-muted-foreground"> (template)</span> : null}
              <span className="block text-xs text-muted-foreground">
                {g.hostName} / {g.node}
              </span>
            </span>
            <GuestStateBadge status={g.status} />
          </Link>
        ))}
      </CardContent>
    </Card>
  );
}
