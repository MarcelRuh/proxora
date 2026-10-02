"use client";

import Link from "next/link";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { ProgressBar, Skeleton } from "@/components/ui/misc";
import { HostStateBadge } from "@/components/status-badge";
import { Button } from "@/components/ui/button";
import { bytesToSize, formatPercent, formatUptime, percentage } from "@/lib/utils";
import { useAptSummary } from "@/components/layout/apt-update-alert";
import { useDashboard, useDashboardGuests } from "@/components/dashboard/use-dashboard";
import { GuestTable } from "@/components/guests/guest-table";
import { useI18n } from "@/components/i18n/locale-provider";
import type { Guest } from "@/lib/types";

export default function DashboardPage() {
  const { t } = useI18n();
  const { data, isLoading, error, refetch, isFetching } = useDashboard();
  const guestsQ = useDashboardGuests("all");
  const apt = useAptSummary();

  if (isLoading) {
    return (
      <div className="grid gap-4">
        <Skeleton className="h-16" />
        <Skeleton className="h-40" />
        <Skeleton className="h-40" />
      </div>
    );
  }
  if (error || !data) {
    return (
      <div className="proxora-panel p-6">
        <p className="font-medium">{t("dashboard.loadError")}</p>
        <p className="text-sm text-muted-foreground">{error instanceof Error ? error.message : t("guest.status.unknown")}</p>
        <button
          className="mt-3 text-sm text-primary"
          onClick={() => {
            void refetch();
            void guestsQ.refetch();
          }}
        >
          {t("common.retry")}
        </button>
      </div>
    );
  }

  const guests: Guest[] = [
    ...(guestsQ.data?.vms ?? []).map((g) => ({ ...g, kind: "vm" as const })),
    ...(guestsQ.data?.containers ?? []).map((g) => ({ ...g, kind: "lxc" as const })),
  ].sort((a, b) => a.vmid - b.vmid || a.name.localeCompare(b.name));

  const totalGuests = data.virtualization.vms + data.virtualization.lxc;
  const running = data.virtualization.running;
  const cpuCores = data.hosts.items.reduce((acc, h) => acc + (h.cpuCores ?? 0), 0);
  const unavailable = data.hosts.items.filter((h) => h.connectionState !== "ONLINE");
  const attention = guests.filter((guest) => guest.status !== "running");

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="proxora-section">{t("dashboard.kicker")}</p>
          <h1 className="proxora-title mt-1 text-3xl">{t("dashboard.title")}</h1>
        </div>
        <div className="flex items-center gap-3 text-xs">
          <Button
            size="sm"
            variant="outline"
            onClick={() => {
              void refetch();
              void guestsQ.refetch();
            }}
            disabled={isFetching || guestsQ.isFetching}
          >
            {t("common.refresh")}
          </Button>
        </div>
      </div>

      <p className="text-sm text-muted-foreground">
        {data.hosts.online}/{data.hosts.total} {t("dashboard.hosts")} · {running}/{totalGuests} {t("dashboard.running")}
        {apt.data?.total ? (
          <>
            {" · "}
            <Link href="/updates" className="text-warning">
              {t("dashboard.updatesCount", { n: apt.data.total })}
            </Link>
          </>
        ) : null}
      </p>

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
          ) : unavailable.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t("dashboard.allHostsOnline")}</p>
          ) : (
            unavailable.map((h) => (
              <Link key={h.id} href={`/hosts/${h.id}`} className="block rounded-[4px] border border-border p-3 hover:border-primary/40">
                <div className="mb-2 flex items-center justify-between">
                  <div>
                    <p className="font-medium">{h.name}</p>
                    {h.origin === "PEER" && h.peerName ? (
                      <p className="text-xs text-muted-foreground">{t("peers.sharedBy", { name: h.peerName })}</p>
                    ) : null}
                    <p className="text-xs text-muted-foreground">Proxmox VE {h.proxmoxVersion ?? t("dashboard.unknown")}</p>
                  </div>
                  <HostStateBadge state={h.connectionState} />
                </div>
                {h.connectionState === "ONLINE" ? (
                  <>
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
                    <p className="mt-2 text-sm">
                      <span className="text-muted-foreground">{t("hosts.cpuTemp")}</span>{" "}
                      {h.cpuTempC != null ? (
                        <span className={h.cpuTempHot ? "font-medium text-destructive" : undefined}>
                          {h.cpuTempC.toLocaleString("de-DE", { maximumFractionDigits: 1 })} °C
                          {h.cpuTempHot ? ` · ${t("hosts.cpuTempHot")}` : ""}
                        </span>
                      ) : (
                        <span className="text-muted-foreground" title={t("hosts.cpuTempMissing")}>
                          —
                        </span>
                      )}
                    </p>
                  </>
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
          <p className="proxora-section">{t("dashboard.attention")}</p>
          <span className="text-xs text-muted-foreground">
            <Link href="/vms" className="text-primary">{t("nav.vms")}</Link>
            {" · "}
            <Link href="/containers" className="text-primary">{t("nav.containers")}</Link>
          </span>
        </CardHeader>
        <CardContent className="space-y-3">
          {unavailable.length > 0 ? (
            <p className="text-sm text-warning">{t("dashboard.guestsHidden", { n: unavailable.length })}</p>
          ) : null}
          {guestsQ.isLoading && !guestsQ.data ? (
            <GuestTable kind="all" items={[]} loading compact />
          ) : attention.length === 0 ? (
            <p className="text-sm text-muted-foreground">{guests.length === 0 ? t("dashboard.noGuests") : t("dashboard.allRunning")}</p>
          ) : (
            <GuestTable kind="all" items={attention} compact />
          )}
        </CardContent>
      </Card>

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
    </div>
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
