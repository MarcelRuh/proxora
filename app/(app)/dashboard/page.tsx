"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { ProgressBar, Skeleton } from "@/components/ui/misc";
import { HostStateBadge } from "@/components/status-badge";
import { HostUpgrade } from "@/components/dashboard/host-upgrade";
import { useAptSummary } from "@/components/layout/apt-update-alert";
import { useDashboard } from "@/components/dashboard/use-dashboard";
import { useCanAny } from "@/components/auth/session-user";
import { useI18n } from "@/components/i18n/locale-provider";
import { api } from "@/lib/api";
import { bytesToSize, formatUptime, percentage } from "@/lib/utils";
import type { DashboardHost } from "@/lib/types";
import type { SelfUpdateStatus } from "@/components/settings/self-update-section";

export default function DashboardPage() {
  const { t, locale } = useI18n();
  const { data, isLoading, error, refetch, isFetching } = useDashboard();
  const apt = useAptSummary();
  const canProxora = useCanAny(["updates.view", "proxora.update"]);
  const proxora = useQuery({
    queryKey: ["self-update"],
    queryFn: () => api<SelfUpdateStatus>("/api/system/self-update"),
    enabled: canProxora,
    refetchInterval: (query) => (query.state.data?.updating ? 1500 : 60_000),
    retry: false,
  });

  if (isLoading) {
    return (
      <div className="grid gap-4 lg:grid-cols-2">
        <Skeleton className="h-16 lg:col-span-2" />
        <Skeleton className="h-52" />
        <Skeleton className="h-52" />
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

  const totalGuests = data.virtualization.vms + data.virtualization.lxc;
  const running = data.virtualization.running;
  const aptByHost = new Map((apt.data?.hosts ?? []).map((host) => [host.id, host.count]));
  const proxoraStatus = proxora.data;
  const alertC = data.cpuTempAlertC ?? 85;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="proxora-section">{t("dashboard.kicker")}</p>
          <h1 className="proxora-title mt-1 text-3xl">{t("dashboard.title")}</h1>
        </div>
        <Button size="sm" variant="outline" onClick={() => void refetch()} disabled={isFetching}>
          {t("common.refresh")}
        </Button>
      </div>

      {proxoraStatus?.updating ? (
        <p className="text-sm">
          {t("dashboard.proxoraUpdating")}
          {proxoraStatus.progress?.percent != null ? ` · ${proxoraStatus.progress.percent} %` : ""}
          {" · "}
          <Link href="/proxora" className="text-primary">
            {t("dashboard.proxoraOpen")}
          </Link>
        </p>
      ) : null}

      <p className="text-sm text-muted-foreground">
        {data.hosts.online}/{data.hosts.total} {t("dashboard.hosts")} · {running}/{totalGuests} {t("dashboard.running")}
      </p>

      {data.hosts.items.length === 0 ? (
        <div className="proxora-panel p-6">
          <p className="text-sm text-muted-foreground">
            {t("dashboard.noHosts")}{" "}
            <Link className="text-primary" href="/hosts">
              {t("dashboard.addHost")}
            </Link>
            .
          </p>
        </div>
      ) : (
        <div className="grid gap-4 xl:grid-cols-2">
          {data.hosts.items.map((host) => (
            <HostLoad
              key={host.id}
              host={host}
              updateCount={aptByHost.get(host.id) ?? 0}
              locale={locale}
              alertC={alertC}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function HostLoad({
  host,
  updateCount,
  locale,
  alertC,
}: {
  host: DashboardHost;
  updateCount: number;
  locale: string;
  alertC: number;
}) {
  const { t } = useI18n();
  const online = host.connectionState === "ONLINE";
  const numberLocale = locale === "en" ? "en-GB" : "de-DE";

  return (
    <section className="proxora-panel space-y-3 p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <Link href={`/hosts/${host.id}`} className="font-medium hover:text-primary">
            {host.name}
          </Link>
          {host.origin === "PEER" && host.peerName ? (
            <p className="text-xs text-muted-foreground">{t("peers.sharedBy", { name: host.peerName })}</p>
          ) : null}
          <p className="text-xs text-muted-foreground">Proxmox VE {host.proxmoxVersion ?? t("dashboard.unknown")}</p>
        </div>
        <HostStateBadge state={host.connectionState} />
      </div>

      {online ? (
        <>
          <div className="grid gap-3 sm:grid-cols-3">
            <Metric
              label={t("dashboard.cpu")}
              value={(host.cpu ?? 0) * 100}
              detail={
                host.cpuCores
                  ? `${t("dashboard.cores", { n: host.cpuCores })} · ${Math.round((host.cpu ?? 0) * 100)}%`
                  : `${Math.round((host.cpu ?? 0) * 100)}%`
              }
            />
            <Metric
              label={t("dashboard.ram")}
              value={percentage(host.memUsed, host.memTotal)}
              detail={`${bytesToSize(host.memUsed)} / ${bytesToSize(host.memTotal)}`}
            />
            <Metric
              label={t("dashboard.storage")}
              value={percentage(host.diskUsed, host.diskTotal)}
              detail={`${bytesToSize(host.diskUsed)} / ${bytesToSize(host.diskTotal)}`}
            />
          </div>
          <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
            <CpuTempLine
              celsius={host.cpuTempC}
              hot={host.cpuTempHot}
              node={host.cpuTempNode}
              state={host.cpuTempState}
              alertC={alertC}
              locale={numberLocale}
            />
            {(host.nodeCount ?? 0) > 1 ? (
              <span className="text-muted-foreground">
                {t("dashboard.nodesOnline", { online: host.onlineNodes ?? 0, total: host.nodeCount ?? 0 })}
              </span>
            ) : null}
            {host.uptime ? (
              <span className="text-muted-foreground">
                {(host.nodeCount ?? 0) > 1
                  ? t("dashboard.minUptime", { time: formatUptime(host.uptime) })
                  : t("guest.uptime", { time: formatUptime(host.uptime) })}
              </span>
            ) : null}
          </div>
        </>
      ) : (
        <p className="text-sm text-destructive">{host.lastError ?? t("dashboard.unreachable")}</p>
      )}

      <HostUpgrade host={host} count={updateCount} />
    </section>
  );
}

function CpuTempLine({
  celsius,
  hot,
  node,
  state,
  alertC,
  locale,
}: {
  celsius?: number | null;
  hot?: boolean;
  node?: string | null;
  state?: "reading" | "none" | "value";
  alertC: number;
  locale: string;
}) {
  const { t } = useI18n();
  let value = t("hosts.cpuTempNone");
  if (celsius != null) {
    const degrees = `${celsius.toLocaleString(locale, { maximumFractionDigits: 1 })} °C`;
    const where = node ? ` · ${node}` : "";
    value = hot ? `${degrees}${where} · ${t("hosts.cpuTempHotAt", { c: alertC })}` : `${degrees}${where}`;
  } else if (state === "reading") {
    value = t("hosts.cpuTempReading");
  }
  return (
    <p>
      <span className="text-muted-foreground">{t("hosts.cpuTemp")}</span>{" "}
      <span className={hot && celsius != null ? "font-medium text-destructive" : undefined}>{value}</span>
    </p>
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
