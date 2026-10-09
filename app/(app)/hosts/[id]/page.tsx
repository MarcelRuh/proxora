"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useParams } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ProgressBar } from "@/components/ui/misc";
import { HostStateBadge, GuestStateBadge } from "@/components/status-badge";
import { ConfirmAction } from "@/components/confirm-action";
import { api } from "@/lib/api";
import { formatUptime, percentage } from "@/lib/utils";
import { PageHeader } from "@/components/layout/page-header";
import { useEffect, useState } from "react";
import { useCan, useCanAny } from "@/components/auth/session-user";
import { isClusterNodeOnline } from "@/lib/cluster-metrics";
import { peerHostAllowsPermission } from "@/lib/federation-access";
import { actionDeniedTitle } from "@/lib/action-lock";
import { useI18n } from "@/components/i18n/locale-provider";
import type { PublicHost } from "@/lib/types";
import { HostEditorDialog } from "@/components/hosts/host-editor";
import { HostMaintenanceButton } from "@/components/hosts/host-maintenance";
import { HostClusterCard } from "@/components/hosts/host-cluster-card";
import { QueryGate } from "@/components/layout/query-gate";

type Status = {
  host: string;
  cpuTempAlertC?: number;
  nodes: Array<{
    node: string;
    online: string;
    status: {
      cpu: number;
      memory: { used: number; total: number };
      rootfs?: { used: number; total: number };
      uptime: number;
      cpuTempC?: number | null;
      cpuTempHot?: boolean;
      cpuTempState?: "reading" | "none" | "value" | "failed";
    } | null;
  }>;
  vms: Array<{ vmid: number; name: string; status: string; node: string }>;
  containers: Array<{ vmid: number; name: string; status: string; node: string }>;
  storage: Array<{ storage: string; type: string; node?: string }>;
};

export default function HostDetailPage() {
  const { t, locale } = useI18n();
  const params = useParams<{ id: string }>();
  const qc = useQueryClient();
  const canConsole = useCan("hosts.console", params.id);
  const canReboot = useCan("hosts.reboot", params.id);
  const canShutdown = useCan("hosts.shutdown", params.id);
  const canEdit = useCanAny(["hosts.update", "hosts.credentials"], params.id);
  const [editOpen, setEditOpen] = useState(false);
  const { data, error, refetch, isPending } = useQuery({
    queryKey: ["host", params.id],
    queryFn: () => api<Status>(`/api/hosts/${params.id}/status`),
    refetchInterval: 45_000,
    staleTime: 20_000,
    placeholderData: (previous) => previous,
  });
  const [tempProbes, setTempProbes] = useState(0);
  const tempReading = Boolean(
    data?.nodes.some((node) => node.status?.cpuTempState === "reading"),
  );
  useEffect(() => {
    if (!data) return;
    if (!tempReading) {
      setTempProbes(0);
      return;
    }
    if (tempProbes >= 4) return;
    const id = setTimeout(() => {
      setTempProbes((n) => n + 1);
      void refetch();
    }, 8_000);
    return () => clearTimeout(id);
  }, [data, refetch, tempReading, tempProbes]);
  const { data: meta } = useQuery({
    queryKey: ["host-meta", params.id],
    queryFn: () => api<{ host: PublicHost }>(`/api/hosts/${params.id}`),
  });

  if (error && !data) {
    return (
      <div className="proxora-panel p-6">
        <p className="font-medium">{t("hosts.connectionFailed")}</p>
        <p className="text-sm text-muted-foreground">{error instanceof Error ? error.message : t("common.failed")}</p>
        <Button className="mt-3" variant="outline" onClick={() => void refetch()}>
          {t("common.retry")}
        </Button>
      </div>
    );
  }

  const remote = meta?.host.origin === "PEER";
  const canHostAdmin = !remote;
  const shareBlocked = t("peers.shareBlocked");
  const noPerm = t("common.noPermission");
  const canPeerConsole = peerHostAllowsPermission(meta?.host ?? { origin: "LOCAL" }, "hosts.console");
  const editDenied = actionDeniedTitle(canEdit, canHostAdmin, shareBlocked, noPerm);
  const maintenanceDenied = actionDeniedTitle(canEdit, canHostAdmin, shareBlocked, noPerm);
  const consoleDenied = actionDeniedTitle(canConsole, canPeerConsole, shareBlocked, noPerm);
  const rebootDenied = actionDeniedTitle(canReboot, canHostAdmin, shareBlocked, noPerm);
  const shutdownDenied = actionDeniedTitle(canShutdown, canHostAdmin, shareBlocked, noPerm);
  const nodes = data?.nodes ?? [];

  async function power(action: "reboot" | "shutdown", node: string) {
    await api(`/api/hosts/${params.id}/status`, {
      method: "POST",
      body: JSON.stringify({ action, node, confirm: true }),
    });
    toast.success(action === "reboot" ? t("hosts.rebootStarted") : t("hosts.shutdownStarted"));
  }

  return (
    <div className="space-y-6">
      <PageHeader
        kicker={t("hosts.kicker")}
        title={meta?.host.name ?? data?.host ?? t("nav.hosts")}
        description={
          remote && meta?.host.peerName
            ? `${t("peers.sharedBy", { name: meta.host.peerName })} · Proxmox VE ${meta.host.proxmoxVersion ?? "—"}`
            : `Proxmox VE ${meta?.host.proxmoxVersion ?? "—"}`
        }
        actions={
          <div className="flex flex-wrap items-center gap-2">
            {meta ? <HostStateBadge state={meta.host.connectionState} /> : null}
            {meta ? (
              <Button
                variant="outline"
                size="sm"
                disabled={Boolean(editDenied)}
                title={editDenied}
                onClick={() => setEditOpen(true)}
              >
                {t("hosts.edit")}
              </Button>
            ) : null}
            {meta ? (
              <HostMaintenanceButton
                host={meta.host}
                disabled={Boolean(maintenanceDenied)}
                disabledReason={maintenanceDenied}
                onDone={() => {
                  void qc.invalidateQueries({ queryKey: ["hosts"] });
                  void qc.invalidateQueries({ queryKey: ["host-meta", params.id] });
                  void qc.invalidateQueries({ queryKey: ["host", params.id] });
                }}
              />
            ) : null}
          </div>
        }
      />
      <QueryGate isLoading={isPending && !data} error={error} hasData={Boolean(data)} onRetry={() => void refetch()}>
      {meta?.host ? (
        <HostClusterCard hostId={params.id} isClusterMember={meta.host.isClusterMember} />
      ) : null}
      {nodes.map((item) => {
        const st = item.status;
        return (
          <Card key={item.node}>
            <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2">
              <CardTitle>
                {t("hosts.node")} {item.node}
                {item.online === "online" ? (
                  <span className="ml-2 text-sm font-normal text-muted-foreground">{t("cluster.online")}</span>
                ) : null}
              </CardTitle>
              <div className="flex flex-wrap items-center gap-2">
                {consoleDenied ? (
                  <Button size="sm" disabled title={consoleDenied}>
                    {t("hosts.terminal")}
                  </Button>
                ) : (
                  <Button size="sm" asChild>
                    <Link href={`/hosts/${params.id}/console?node=${encodeURIComponent(item.node)}`}>
                      {t("hosts.terminal")}
                    </Link>
                  </Button>
                )}
                <details className="relative">
                  <summary className="flex h-8 cursor-pointer list-none items-center rounded-[var(--ui-radius)] border border-border px-3 text-xs [&::-webkit-details-marker]:hidden">
                    {t("table.more")}
                  </summary>
                  <div className="absolute right-0 z-30 mt-1 grid w-56 gap-1 rounded-[var(--ui-radius)] border border-border bg-card p-2 shadow-lg">
                    <Button size="sm" variant="outline" className="w-full" asChild>
                      <Link href={`/updates?host=${params.id}`}>{t("nav.updates")}</Link>
                    </Button>
                    <Button size="sm" variant="outline" className="w-full" asChild>
                      <Link href="/backups">{t("nav.backups")}</Link>
                    </Button>
                    {rebootDenied ? (
                      <Button size="sm" variant="outline" className="w-full" disabled title={rebootDenied}>
                        {t("guest.reboot")}
                      </Button>
                    ) : (
                      <ConfirmAction
                        title={t("hosts.rebootTitle", { node: item.node })}
                        description={t("hosts.rebootBody")}
                        actionLabel={t("guest.reboot")}
                        destructive
                        onConfirm={() => power("reboot", item.node)}
                      >
                        <Button size="sm" variant="outline" className="w-full">
                          {t("guest.reboot")}
                        </Button>
                      </ConfirmAction>
                    )}
                    {shutdownDenied ? (
                      <Button size="sm" variant="outline" className="w-full" disabled title={shutdownDenied}>
                        {t("guest.shutdown")}
                      </Button>
                    ) : (
                      <ConfirmAction
                        title={t("hosts.shutdownTitle", { node: item.node })}
                        description={t("hosts.shutdownBody")}
                        actionLabel={t("guest.shutdown")}
                        destructive
                        onConfirm={() => power("shutdown", item.node)}
                      >
                        <Button size="sm" variant="destructive" className="w-full">
                          {t("guest.shutdown")}
                        </Button>
                      </ConfirmAction>
                    )}
                  </div>
                </details>
              </div>
            </CardHeader>
            {st && isClusterNodeOnline(item.online) ? (
              <CardContent className="space-y-3">
                <div className="grid gap-4 sm:grid-cols-3">
                  <Metric label={t("table.cpu")} value={st.cpu * 100} />
                  <Metric label={t("table.ram")} value={percentage(st.memory.used, st.memory.total)} />
                  <Metric label={t("hosts.rootfs")} value={percentage(st.rootfs?.used, st.rootfs?.total)} />
                </div>
                <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
                  <CpuTemp
                    celsius={st.cpuTempC}
                    hot={st.cpuTempHot}
                    state={st.cpuTempState}
                    alertC={data?.cpuTempAlertC ?? 85}
                    locale={locale}
                  />
                  <span className="text-muted-foreground">{t("guest.uptime", { time: formatUptime(st.uptime) })}</span>
                </div>
              </CardContent>
            ) : (
              <CardContent>
                <p className="text-sm text-destructive">{t("dashboard.unreachable")}</p>
              </CardContent>
            )}
          </Card>
        );
      })}
      <Section title={t("nav.vms")} href="/vms" viewAll={t("hosts.viewAll")}>
        {(data?.vms ?? []).length ? (
          (data?.vms ?? []).map((vm) => (
            <Row
              key={`${vm.node}-${vm.vmid}`}
              href={`/vms/${params.id}/${vm.node}/${vm.vmid}`}
              id={vm.vmid}
              name={`${vm.name} · ${vm.node}`}
              status={vm.status}
            />
          ))
        ) : (
          <p className="py-2 text-sm text-muted-foreground">{t("dashboard.noGuests")}</p>
        )}
      </Section>
      <Section title={t("nav.containers")} href="/containers" viewAll={t("hosts.viewAll")}>
        {(data?.containers ?? []).length ? (
          (data?.containers ?? []).map((ct) => (
            <Row
              key={`${ct.node}-${ct.vmid}`}
              href={`/containers/${params.id}/${ct.node}/${ct.vmid}`}
              id={ct.vmid}
              name={`${ct.name} · ${ct.node}`}
              status={ct.status}
            />
          ))
        ) : (
          <p className="py-2 text-sm text-muted-foreground">{t("dashboard.noGuests")}</p>
        )}
      </Section>
      <Section title={t("nav.storage")} href="/storage" viewAll={t("hosts.viewAll")}>
        {(data?.storage ?? []).length ? (
          (data?.storage ?? []).map((s) => (
            <div key={`${s.node ?? ""}-${s.storage}`} className="flex items-center justify-between border-t border-border py-2 text-sm">
              <span>{s.storage}</span>
              <span className="text-muted-foreground">{s.type}</span>
            </div>
          ))
        ) : (
          <p className="py-2 text-sm text-muted-foreground">{t("storage.empty")}</p>
        )}
      </Section>
      </QueryGate>
      {meta?.host ? (
        <HostEditorDialog
          mode="edit"
          host={meta.host}
          open={editOpen}
          onOpenChange={setEditOpen}
          onSaved={() => {
            void qc.invalidateQueries({ queryKey: ["hosts"] });
            void qc.invalidateQueries({ queryKey: ["host-meta", params.id] });
          }}
        />
      ) : null}
    </div>
  );
}

function CpuTemp({
  celsius,
  hot,
  state,
  alertC,
  locale,
}: {
  celsius?: number | null;
  hot?: boolean;
  state?: "reading" | "none" | "value" | "failed";
  alertC: number;
  locale: string;
}) {
  const { t } = useI18n();
  const numberLocale = locale === "en" ? "en-GB" : "de-DE";
  const value =
    celsius != null
      ? `${celsius.toLocaleString(numberLocale, { maximumFractionDigits: 1 })} °C${hot ? ` · ${t("hosts.cpuTempHotAt", { c: alertC })}` : ""}`
      : state === "reading"
        ? t("hosts.cpuTempReading")
        : state === "failed"
          ? t("hosts.cpuTempFailed")
          : t("hosts.cpuTempNone");
  return (
    <p>
      <span className="text-muted-foreground">{t("hosts.cpuTemp")}</span>{" "}
      <span className={hot && celsius != null ? "font-medium text-destructive" : undefined}>{value}</span>
    </p>
  );
}

function Metric({ label, value }: { label: string; value: number }) {
  return (
    <div>
      <div className="mb-1 flex justify-between text-sm">
        <span>{label}</span>
        <span>{Math.round(value)}%</span>
      </div>
      <ProgressBar value={value} />
    </div>
  );
}

function Section({ title, href, viewAll, children }: { title: string; href: string; viewAll: string; children: React.ReactNode }) {
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle>{title}</CardTitle>
        <Link href={href} className="text-xs text-muted-foreground hover:underline">
          {viewAll}
        </Link>
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  );
}

function Row({ href, id, name, status }: { href: string; id: number; name: string; status: string }) {
  return (
    <Link href={href} className="flex items-center justify-between border-t border-border py-2 text-sm hover:bg-muted/30">
      <span>
        {id} · {name}
      </span>
      <GuestStateBadge status={status} />
    </Link>
  );
}
