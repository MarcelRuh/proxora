"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { ProgressBar, Skeleton } from "@/components/ui/misc";
import { HostStateBadge, GuestStateBadge } from "@/components/status-badge";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/api";
import { bytesToSize, formatPercent, formatUptime, percentage } from "@/lib/utils";
import { useAptSummary } from "@/components/layout/apt-update-alert";
import { useI18n } from "@/components/i18n/locale-provider";

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
      cpuCores?: number;
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
  const { t, locale } = useI18n();
  const { data, isLoading, error, refetch, isFetching } = useQuery({
    queryKey: ["dashboard"],
    queryFn: () => api<Dashboard>("/api/dashboard"),
    refetchInterval: 15_000,
  });
  const apt = useAptSummary();
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

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
      <div className="proxora-panel p-6">
        <p className="font-medium">{t("dashboard.loadError")}</p>
        <p className="text-sm text-muted-foreground">{error instanceof Error ? error.message : t("guest.status.unknown")}</p>
        <button className="mt-3 text-sm text-primary" onClick={() => void refetch()}>
          {t("common.retry")}
        </button>
      </div>
    );
  }

  const guests: Guest[] = [
    ...(data.guests?.vms ?? []).map((g) => ({ ...g, kind: "vm" as const })),
    ...(data.guests?.containers ?? []).map((g) => ({ ...g, kind: "lxc" as const })),
  ].sort((a, b) => a.vmid - b.vmid || a.name.localeCompare(b.name));

  const running = guests.filter((g) => g.status === "running").length;
  const stopped = guests.filter((g) => g.status === "stopped").length;
  const bad = guests.filter((g) => g.status !== "running" && g.status !== "stopped").length;
  const allOnline = data.hosts.total > 0 && data.hosts.online === data.hosts.total;
  const cpuCores = data.hosts.items.reduce((acc, h) => acc + (h.cpuCores ?? 0), 0);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="proxora-section">{t("dashboard.kicker")}</p>
          <h1 className="proxora-title mt-1 text-4xl md:text-5xl">{t("dashboard.title")}</h1>
        </div>
        <div className="flex items-center gap-3 text-xs uppercase tracking-wider">
          <span className="flex items-center gap-2 text-success">
            <span className="proxora-pulse inline-block h-2 w-2 rounded-full bg-success" />
            {t("common.live", { time: now.toLocaleTimeString(locale === "en" ? "en-US" : "de-DE") })}
          </span>
          <Button size="sm" variant="outline" onClick={() => void refetch()} disabled={isFetching}>
            {t("common.refresh")}
          </Button>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <MiniStat label={t("dashboard.hostStatus")} value={allOnline ? t("dashboard.online") : `${data.hosts.online}/${data.hosts.total}`} ok={allOnline} />
        <MiniStat label={t("dashboard.hosts")} value={String(data.hosts.total)} />
        <MiniStat
          label="Proxmox VE"
          value={data.hosts.items[0]?.proxmoxVersion ?? "—"}
        />
      </div>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <CountStat label={t("dashboard.total")} value={guests.length} />
        <CountStat label={t("dashboard.running")} value={running} />
        <CountStat label={t("dashboard.stopped")} value={stopped} />
        <CountStat label={t("dashboard.error")} value={bad} />
      </div>

      <div className="grid gap-3 md:grid-cols-3">
        <ResourceStat
          label={t("dashboard.cpu")}
          primary={formatPercent(Math.round(data.resources.cpu * 1000) / 10)}
          secondary={cpuCores ? t("dashboard.cores", { n: cpuCores }) : undefined}
          ratio={data.resources.cpu * 100}
        />
        <ResourceStat
          label={t("dashboard.ram")}
          primary={formatPercent(percentage(data.resources.memUsed, data.resources.memTotal))}
          secondary={`${bytesToSize(data.resources.memUsed)} / ${bytesToSize(data.resources.memTotal)}`}
          ratio={percentage(data.resources.memUsed, data.resources.memTotal)}
        />
        <ResourceStat
          label={t("dashboard.disk")}
          primary={formatPercent(percentage(data.resources.diskUsed, data.resources.diskTotal))}
          secondary={`${bytesToSize(data.resources.diskUsed)} / ${bytesToSize(data.resources.diskTotal)}`}
          ratio={percentage(data.resources.diskUsed, data.resources.diskTotal)}
        />
      </div>

      <Card>
        <CardHeader>
          <p className="proxora-section">{t("dashboard.updates")}</p>
        </CardHeader>
        <CardContent>
          <p className={apt.data?.total ? "text-warning" : "text-muted-foreground"}>
            {apt.data?.total ? t("dashboard.updatesCount", { n: apt.data.total }) : t("dashboard.noUpdates")}
          </p>
          {apt.data?.total ? (
            <Link href="/updates" className="mt-2 inline-block text-sm text-primary">
              {t("dashboard.toUpdates")}
            </Link>
          ) : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <p className="proxora-section">{t("dashboard.hosts")}</p>
        </CardHeader>
        <CardContent className="space-y-4">
          {data.hosts.items.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              {t("dashboard.noHosts")}{" "}
              <Link className="text-primary" href="/hosts">
                {t("dashboard.addHost")}
              </Link>
              .
            </p>
          ) : (
            data.hosts.items.map((h) => (
              <Link key={h.id} href={`/hosts/${h.id}`} className="block rounded-[4px] border border-border p-3 hover:border-primary/40">
                <div className="mb-2 flex items-center justify-between">
                  <div>
                    <p className="font-medium">{h.name}</p>
                    <p className="text-xs text-muted-foreground">Proxmox VE {h.proxmoxVersion ?? t("dashboard.unknown")}</p>
                  </div>
                  <HostStateBadge state={h.connectionState as never} />
                </div>
                {h.connectionState === "ONLINE" ? (
                  <div className="grid gap-2 sm:grid-cols-3">
                    <Metric
                      label={t("dashboard.cpu")}
                      value={(h.cpu ?? 0) * 100}
                      detail={h.cpuCores ? `${t("dashboard.cores", { n: h.cpuCores })} · ${Math.round((h.cpu ?? 0) * 100)}%` : `${Math.round((h.cpu ?? 0) * 100)}%`}
                    />
                    <Metric
                      label={t("dashboard.ram")}
                      value={percentage(h.memUsed, h.memTotal)}
                      detail={`${bytesToSize(h.memUsed)} / ${bytesToSize(h.memTotal)}`}
                    />
                    <Metric
                      label={t("dashboard.storage")}
                      value={percentage(h.diskUsed, h.diskTotal)}
                      detail={`${bytesToSize(h.diskUsed)} / ${bytesToSize(h.diskTotal)}`}
                    />
                  </div>
                ) : (
                  <p className="text-sm text-destructive">{h.lastError ?? t("dashboard.unreachable")}</p>
                )}
                {h.uptime ? <p className="mt-2 text-xs text-muted-foreground">Uptime {formatUptime(h.uptime)}</p> : null}
              </Link>
            ))
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <p className="proxora-section">{t("dashboard.guests")}</p>
          <span className="text-xs text-muted-foreground">{guests.length}</span>
        </CardHeader>
        <CardContent>
          {guests.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t("dashboard.noGuests")}</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="font-[family-name:var(--font-display)] text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
                  <tr>
                    <th className="px-2 py-2 font-medium">{t("table.id")}</th>
                    <th className="px-2 py-2 font-medium">{t("table.type")}</th>
                    <th className="px-2 py-2 font-medium">{t("table.name")}</th>
                    <th className="px-2 py-2 font-medium">{t("table.host")}</th>
                    <th className="px-2 py-2 font-medium">{t("table.status")}</th>
                  </tr>
                </thead>
                <tbody>
                  {guests.map((g) => (
                    <tr key={`${g.kind}-${g.hostId}-${g.node}-${g.vmid}`} className="border-t border-border hover:bg-white/[0.03]">
                      <td className="px-2 py-2 font-mono font-semibold">
                        <Link href={guestHref(g)} className="hover:text-primary">
                          {g.vmid}
                        </Link>
                      </td>
                      <td className="px-2 py-2">
                        <Badge variant={g.kind === "vm" ? "default" : "muted"}>{g.kind === "vm" ? "VM" : "LXC"}</Badge>
                      </td>
                      <td className="px-2 py-2">
                        <Link href={guestHref(g)} className="hover:text-primary">
                          {g.name}
                          {g.template ? <span className="text-xs text-muted-foreground"> (template)</span> : null}
                        </Link>
                      </td>
                      <td className="px-2 py-2 text-muted-foreground">
                        {g.hostName}
                        {g.node && g.node !== g.hostName ? <span className="block text-xs">{g.node}</span> : null}
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

function MiniStat({ label, value, ok }: { label: string; value: string; ok?: boolean }) {
  return (
    <Card>
      <CardHeader>
        <p className="proxora-section">{label}</p>
      </CardHeader>
      <CardContent>
        <p className={ok ? "text-lg font-semibold text-success" : "text-lg font-semibold"}>{value}</p>
      </CardContent>
    </Card>
  );
}

function CountStat({ label, value }: { label: string; value: number }) {
  return (
    <Card>
      <CardHeader>
        <p className="proxora-section">{label}</p>
      </CardHeader>
      <CardContent>
        <p className="proxora-stat text-4xl leading-none">{value}</p>
      </CardContent>
    </Card>
  );
}

function ResourceStat({
  label,
  primary,
  secondary,
  ratio,
}: {
  label: string;
  primary: string;
  secondary?: string;
  ratio: number;
}) {
  return (
    <Card>
      <CardHeader>
        <p className="proxora-section">{label}</p>
      </CardHeader>
      <CardContent className="space-y-2">
        <p className="proxora-stat text-3xl leading-none">{primary}</p>
        {secondary ? <p className="text-xs text-muted-foreground">{secondary}</p> : null}
        <ProgressBar value={ratio} />
      </CardContent>
    </Card>
  );
}

function guestHref(g: Guest) {
  return g.kind === "vm" ? `/vms/${g.hostId}/${g.node}/${g.vmid}` : `/containers/${g.hostId}/${g.node}/${g.vmid}`;
}

function Metric({ label, value, detail }: { label: string; value: number; detail?: string }) {
  return (
    <div>
      <div className="mb-1 flex justify-between gap-2 text-xs text-muted-foreground">
        <span>{label}</span>
        <span className="text-right font-medium text-foreground">{detail ?? `${Math.round(value)}%`}</span>
      </div>
      <ProgressBar value={value} />
    </div>
  );
}
