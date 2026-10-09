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
import { api, isNetworkFetchError } from "@/lib/api";
import { groupSharedDashboardHosts, ownDashboardHosts, sharedDashboardHosts } from "@/lib/dashboard-hosts";
import { hostErrorText } from "@/lib/host-error-text";
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
  if (!data) {
    return (
      <div className="proxora-panel p-6">
        <p className="font-medium">{t("dashboard.loadError")}</p>
        <p className="text-sm text-muted-foreground">
          {isNetworkFetchError(error)
            ? t("common.networkFailed")
            : error instanceof Error
              ? error.message
              : t("common.pageErrorBody")}
        </p>
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

      {error ? (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-[var(--ui-radius)] border border-warning/40 bg-warning/10 px-3 py-2 text-sm">
          <p className="text-muted-foreground">
            {isNetworkFetchError(error)
              ? t("common.networkFailed")
              : error instanceof Error
                ? error.message
                : t("common.pageErrorBody")}
          </p>
          <Button size="sm" variant="outline" onClick={() => void refetch()}>
            {t("common.retry")}
          </Button>
        </div>
      ) : null}

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
        {running}/{totalGuests} {t("dashboard.running")}
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
        <DashboardHosts
          hosts={data.hosts.items}
          aptByHost={aptByHost}
          locale={locale}
          alertC={alertC}
        />
      )}
    </div>
  );
}

function DashboardHosts({
  hosts,
  aptByHost,
  locale,
  alertC,
}: {
  hosts: DashboardHost[];
  aptByHost: Map<string, number>;
  locale: string;
  alertC: number;
}) {
  const { t } = useI18n();
  const own = ownDashboardHosts(hosts);
  const shared = sharedDashboardHosts(hosts);
  const groups = groupSharedDashboardHosts(shared, t("peers.unknown"));

  return (
    <div className="space-y-8">
      {own.length > 0 ? (
        <HostGroup title={t("dashboard.own")} hosts={own} aptByHost={aptByHost} locale={locale} alertC={alertC} />
      ) : (
        <section className="space-y-3">
          <h2 className="text-sm font-medium uppercase tracking-wide text-muted-foreground">{t("dashboard.own")}</h2>
          <div className="proxora-panel p-6">
            <p className="text-sm text-muted-foreground">
              {t("dashboard.noHosts")}{" "}
              <Link className="text-primary" href="/hosts">
                {t("dashboard.addHost")}
              </Link>
              .
            </p>
          </div>
        </section>
      )}
      {shared.length > 0 ? (
        <section className="space-y-6">
          <HostGroupHeading title={t("dashboard.shared")} hosts={shared} />
          {groups.map(([owner, group]) => (
            <div key={owner} className="space-y-3">
              {groups.length > 1 ? (
                <h3 className="text-xs font-medium text-muted-foreground">{t("peers.sharedBy", { name: owner })}</h3>
              ) : null}
              <HostGrid
                hosts={group}
                aptByHost={aptByHost}
                locale={locale}
                alertC={alertC}
                showOwner={groups.length === 1}
              />
            </div>
          ))}
        </section>
      ) : null}
    </div>
  );
}

function HostGroup({
  title,
  hosts,
  aptByHost,
  locale,
  alertC,
}: {
  title: string;
  hosts: DashboardHost[];
  aptByHost: Map<string, number>;
  locale: string;
  alertC: number;
}) {
  return (
    <section className="space-y-3">
      <HostGroupHeading title={title} hosts={hosts} />
      <HostGrid hosts={hosts} aptByHost={aptByHost} locale={locale} alertC={alertC} showOwner={false} />
    </section>
  );
}

function HostGroupHeading({ title, hosts }: { title: string; hosts: DashboardHost[] }) {
  const { t } = useI18n();
  const online = hosts.filter((host) => host.connectionState === "ONLINE").length;
  return (
    <div className="flex items-baseline justify-between gap-3">
      <h2 className="text-sm font-medium uppercase tracking-wide text-muted-foreground">{title}</h2>
      <p className="text-xs text-muted-foreground">
        {online}/{hosts.length} {t("dashboard.online")}
      </p>
    </div>
  );
}

function HostGrid({
  hosts,
  aptByHost,
  locale,
  alertC,
  showOwner,
}: {
  hosts: DashboardHost[];
  aptByHost: Map<string, number>;
  locale: string;
  alertC: number;
  showOwner: boolean;
}) {
  return (
    <div className="grid gap-4 xl:grid-cols-2">
      {hosts.map((host) => (
        <HostLoad
          key={host.id}
          host={host}
          updateCount={aptByHost.get(host.id) ?? 0}
          locale={locale}
          alertC={alertC}
          showOwner={showOwner}
        />
      ))}
    </div>
  );
}

function HostLoad({
  host,
  updateCount,
  locale,
  alertC,
  showOwner,
}: {
  host: DashboardHost;
  updateCount: number;
  locale: string;
  alertC: number;
  showOwner: boolean;
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
          {showOwner && host.origin === "PEER" && host.peerName ? (
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
        <p className="text-sm text-destructive">{hostErrorText(host.lastError, t) ?? t("dashboard.unreachable")}</p>
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
  state?: "reading" | "none" | "value" | "failed";
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
  } else if (state === "failed") {
    value = t("hosts.cpuTempFailed");
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
