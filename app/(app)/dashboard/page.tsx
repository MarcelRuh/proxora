"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { ProgressBar, Skeleton } from "@/components/ui/misc";
import { HostStateBadge } from "@/components/status-badge";
import { Button } from "@/components/ui/button";
import { uniqueNonEmpty } from "@/lib/cluster-metrics";
import { bytesToSize, formatPercent, formatUptime, percentage } from "@/lib/utils";
import { useAptSummary } from "@/components/layout/apt-update-alert";
import { useDashboard } from "@/components/dashboard/use-dashboard";
import { GuestTable } from "@/components/guests/guest-table";
import { useI18n } from "@/components/i18n/locale-provider";
import type { Guest } from "@/lib/types";

export default function DashboardPage() {
  const { t } = useI18n();
  const { data, isLoading, error, refetch, isFetching } = useDashboard();
  const apt = useAptSummary();

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
  const versions = uniqueNonEmpty(data.hosts.items.map((h) => h.proxmoxVersion));
  const unavailable = data.hosts.items.filter((h) => h.connectionState !== "ONLINE");

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="proxora-section">{t("dashboard.kicker")}</p>
          <h1 className="proxora-title mt-1 text-4xl md:text-5xl">{t("dashboard.title")}</h1>
        </div>
        <div className="flex items-center gap-3 text-xs uppercase tracking-wider">
            <LiveClock />
          <Button size="sm" variant="outline" onClick={() => void refetch()} disabled={isFetching}>
            {t("common.refresh")}
          </Button>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <MiniStat label={t("dashboard.hostStatus")} value={allOnline ? t("dashboard.online") : `${data.hosts.online}/${data.hosts.total}`} ok={allOnline} />
        <MiniStat label={t("dashboard.hosts")} value={String(data.hosts.total)} />
        <MiniStat label="Proxmox VE" value={versions.length ? versions.join(" · ") : "—"} />
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
                  <HostStateBadge state={h.connectionState} />
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
                <div className="mt-2 flex flex-wrap gap-x-3 text-xs text-muted-foreground">
                  {(h.nodeCount ?? 0) > 1 ? (
                    <span>{t("dashboard.nodesOnline", { online: h.onlineNodes ?? 0, total: h.nodeCount ?? 0 })}</span>
                  ) : null}
                  {h.uptime ? (
                    <span>
                      {(h.nodeCount ?? 0) > 1
                        ? t("dashboard.minUptime", { time: formatUptime(h.uptime) })
                        : t("guest.uptime", { time: formatUptime(h.uptime) })}
                    </span>
                  ) : null}
                </div>
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
        <CardContent className="space-y-3">
          {unavailable.length > 0 ? (
            <p className="text-sm text-warning">{t("dashboard.guestsHidden", { n: unavailable.length })}</p>
          ) : null}
          {guests.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t("dashboard.noGuests")}</p>
          ) : (
            <GuestTable kind="all" items={guests} />
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

function LiveClock() {
  const { t, locale } = useI18n();
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);
  return (
    <span className="flex items-center gap-2 text-success">
      <span className="proxora-pulse inline-block h-2 w-2 rounded-full bg-success" />
      {t("common.live", { time: now.toLocaleTimeString(locale === "en" ? "en-US" : "de-DE") })}
    </span>
  );
}
