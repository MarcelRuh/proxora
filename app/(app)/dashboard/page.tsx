"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { EmptyState, ProgressBar, Skeleton } from "@/components/ui/misc";
import { PageHeader } from "@/components/layout/page-header";
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
      <div className="space-y-6" aria-busy="true">
        <Skeleton className="h-14 w-56" />
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <Skeleton className="h-24" />
          <Skeleton className="h-24" />
          <Skeleton className="h-24" />
          <Skeleton className="h-24" />
        </div>
        <div className="grid gap-4 xl:grid-cols-2">
          <Skeleton className="h-52" />
          <Skeleton className="h-52" />
        </div>
      </div>
    );
  }
  if (!data) {
    return (
      <div className="proxora-panel p-6" role="alert">
        <p className="font-medium">{t("dashboard.loadError")}</p>
        <p className="text-sm text-muted-foreground">
          {isNetworkFetchError(error)
            ? t("common.networkFailed")
            : error instanceof Error
              ? error.message
              : t("common.pageErrorBody")}
        </p>
        <Button className="mt-3" size="sm" variant="outline" onClick={() => void refetch()} disabled={isFetching}>
          {t("common.retry")}
        </Button>
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
      <PageHeader
        kicker={t("dashboard.kicker")}
        title={t("dashboard.title")}
        actions={
          <Button size="sm" variant="outline" onClick={() => void refetch()} disabled={isFetching}>
            <RefreshCw className={isFetching ? "animate-spin" : undefined} aria-hidden />
            {t("common.refresh")}
          </Button>
        }
      />

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

      {data.hosts.items.length === 0 ? (
        <EmptyState
          title={t("dashboard.emptyTitle")}
          description={t("dashboard.emptyBody")}
          action={
            <Button asChild className="mt-2">
              <Link href="/hosts">{t("dashboard.addHost")}</Link>
            </Button>
          }
        />
      ) : (
        <FleetSummary
          hostsOnline={data.hosts.online}
          hostsTotal={data.hosts.total}
          running={running}
          totalGuests={totalGuests}
          vms={data.virtualization.vms}
          lxc={data.virtualization.lxc}
          resources={data.resources}
          updates={apt.data?.total ?? null}
        />
      )}

      {data.hosts.items.length === 0 ? null : (
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

function FleetSummary({
  hostsOnline,
  hostsTotal,
  running,
  totalGuests,
  vms,
  lxc,
  resources,
  updates,
}: {
  hostsOnline: number;
  hostsTotal: number;
  running: number;
  totalGuests: number;
  vms: number;
  lxc: number;
  resources: { cpu: number; memUsed: number; memTotal: number; diskUsed: number; diskTotal: number };
  updates: number | null;
}) {
  const { t } = useI18n();
  const offline = Math.max(0, hostsTotal - hostsOnline);
  const stopped = Math.max(0, totalGuests - running);
  return (
    <section aria-label={t("dashboard.kicker")} className="grid grid-cols-2 gap-3 xl:grid-cols-4">
      <SummaryTile label={t("dashboard.hosts")} href="/hosts">
        <p className="proxora-stat text-2xl tabular-nums">
          {hostsOnline}
          <span className="text-base text-muted-foreground">/{hostsTotal}</span>
        </p>
        <p className={offline > 0 ? "text-xs font-medium text-warning" : "text-xs text-muted-foreground"}>
          {offline > 0 ? t("dashboard.offlineCount", { n: offline }) : t("dashboard.allHostsOnline")}
        </p>
      </SummaryTile>
      <SummaryTile label={t("dashboard.guests")} href="/vms">
        <p className="proxora-stat text-2xl tabular-nums">
          {running}
          <span className="text-base text-muted-foreground">/{totalGuests}</span>
        </p>
        <p className="text-xs text-muted-foreground">
          {t("dashboard.guestSplit", { vms, lxc })}
          {stopped > 0 ? ` · ${t("dashboard.stoppedCount", { n: stopped })}` : ""}
        </p>
      </SummaryTile>
      <SummaryTile label={t("dashboard.resources")} className="order-last col-span-2 xl:order-none xl:col-span-1">
        {hostsOnline > 0 ? (
          <div className="space-y-2 pt-1">
            <MiniMeter label={t("dashboard.cpu")} value={resources.cpu * 100} />
            <MiniMeter label={t("dashboard.ram")} value={percentage(resources.memUsed, resources.memTotal)} />
            <MiniMeter label={t("dashboard.storage")} value={percentage(resources.diskUsed, resources.diskTotal)} />
          </div>
        ) : (
          <p className="pt-1 text-sm text-muted-foreground">{t("dashboard.noLiveData")}</p>
        )}
      </SummaryTile>
      <SummaryTile label={t("dashboard.updates")} href="/updates" className="col-span-2 xl:col-span-1">
        {updates == null ? (
          <p className="text-sm text-muted-foreground">—</p>
        ) : updates > 0 ? (
          <>
            <p className="proxora-stat text-2xl tabular-nums text-warning">{updates}</p>
            <p className="text-xs text-muted-foreground">
              {updates === 1 ? t("dashboard.packageOne") : t("dashboard.packages", { n: updates })}
            </p>
          </>
        ) : (
          <>
            <p className="proxora-stat text-2xl tabular-nums">0</p>
            <p className="text-xs text-muted-foreground">{t("dashboard.noUpdates")}</p>
          </>
        )}
      </SummaryTile>
    </section>
  );
}

function SummaryTile({
  label,
  href,
  className,
  children,
}: {
  label: string;
  href?: string;
  className?: string;
  children: ReactNode;
}) {
  const body = (
    <>
      <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">{label}</p>
      <div className="mt-1.5 space-y-0.5">{children}</div>
    </>
  );
  const cls = `proxora-panel block min-h-24 min-w-0 p-4 ${className ?? ""}`;
  return href ? (
    <Link href={href} className={`${cls} transition-colors hover:border-primary/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring`}>
      {body}
    </Link>
  ) : (
    <div className={cls}>{body}</div>
  );
}

function MiniMeter({ label, value }: { label: string; value: number }) {
  return (
    <div className="grid grid-cols-[3.5rem_1fr_2.75rem] items-center gap-2 text-xs">
      <span className="text-muted-foreground">{label}</span>
      <ProgressBar value={value} />
      <span className="text-right font-medium tabular-nums">{Math.round(value)}%</span>
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
