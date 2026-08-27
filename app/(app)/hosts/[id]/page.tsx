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
import { WebConsole } from "@/components/console/web-console";
import { api } from "@/lib/api";
import { formatUptime, percentage } from "@/lib/utils";
import { PageHeader } from "@/components/layout/page-header";
import { useState } from "react";
import { useCan } from "@/components/auth/session-user";
import { useI18n } from "@/components/i18n/locale-provider";
import type { PublicHost } from "@/lib/types";
import { HostEditorDialog } from "@/components/hosts/host-editor";

type Status = {
  host: string;
  nodes: Array<{
    node: string;
    online: string;
    status: { cpu: number; memory: { used: number; total: number }; rootfs?: { used: number; total: number }; uptime: number } | null;
  }>;
  vms: Array<{ vmid: number; name: string; status: string; node: string }>;
  containers: Array<{ vmid: number; name: string; status: string; node: string }>;
  storage: Array<{ storage: string; type: string; node?: string }>;
};

export default function HostDetailPage() {
  const { t } = useI18n();
  const params = useParams<{ id: string }>();
  const qc = useQueryClient();
  const canConsole = useCan("hosts.console");
  const canReboot = useCan("hosts.reboot");
  const canShutdown = useCan("hosts.shutdown");
  const canEdit = useCan("hosts.update") || useCan("hosts.credentials");
  const [consoleNode, setConsoleNode] = useState<string | null>(null);
  const [editOpen, setEditOpen] = useState(false);
  const { data, error, refetch, isLoading } = useQuery({
    queryKey: ["host", params.id],
    queryFn: () => api<Status>(`/api/hosts/${params.id}/status`),
    refetchInterval: 8_000,
  });
  const { data: meta } = useQuery({
    queryKey: ["host-meta", params.id],
    queryFn: () => api<{ host: PublicHost }>(`/api/hosts/${params.id}`),
  });

  if (error) {
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
        description={`Proxmox VE ${meta?.host.proxmoxVersion ?? "—"}`}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            {meta ? <HostStateBadge state={meta.host.connectionState} /> : null}
            {canEdit && meta ? (
              <Button variant="outline" size="sm" onClick={() => setEditOpen(true)}>
                {t("hosts.edit")}
              </Button>
            ) : null}
          </div>
        }
      />
      {nodes.map((item) => {
        const st = item.status;
        return (
          <Card key={item.node}>
            <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2">
              <CardTitle>
                {t("hosts.node")} {item.node}
                <span className="ml-2 text-sm font-normal text-muted-foreground">{item.online}</span>
              </CardTitle>
              <div className="flex flex-wrap gap-2">
                {canConsole ? (
                  <Button size="sm" onClick={() => setConsoleNode(item.node)}>
                    {t("guest.console")}
                  </Button>
                ) : null}
                <Button size="sm" variant="outline" asChild>
                  <Link href={`/updates?host=${params.id}`}>{t("nav.updates")}</Link>
                </Button>
                <Button size="sm" variant="outline" asChild>
                  <Link href="/backups">{t("nav.backups")}</Link>
                </Button>
                {canReboot ? (
                  <ConfirmAction
                    title={t("hosts.rebootTitle", { node: item.node })}
                    description={t("hosts.rebootBody")}
                    actionLabel={t("guest.reboot")}
                    destructive
                    onConfirm={() => power("reboot", item.node)}
                  >
                    <Button size="sm" variant="destructive">
                      {t("guest.reboot")}
                    </Button>
                  </ConfirmAction>
                ) : null}
                {canShutdown ? (
                  <ConfirmAction
                    title={t("hosts.shutdownTitle", { node: item.node })}
                    description={t("hosts.shutdownBody")}
                    actionLabel={t("guest.shutdown")}
                    destructive
                    onConfirm={() => power("shutdown", item.node)}
                  >
                    <Button size="sm" variant="destructive">
                      {t("guest.shutdown")}
                    </Button>
                  </ConfirmAction>
                ) : null}
              </div>
            </CardHeader>
            {st ? (
              <CardContent className="grid gap-4 sm:grid-cols-3">
                <Metric label={t("table.cpu")} value={st.cpu * 100} />
                <Metric label={t("table.ram")} value={percentage(st.memory.used, st.memory.total)} />
                <Metric label={t("hosts.rootfs")} value={percentage(st.rootfs?.used, st.rootfs?.total)} />
                <p className="text-sm text-muted-foreground sm:col-span-3">{t("guest.uptime", { time: formatUptime(st.uptime) })}</p>
              </CardContent>
            ) : null}
          </Card>
        );
      })}
      {consoleNode && canConsole ? <WebConsole hostId={params.id} node={consoleNode} kind="node" /> : null}
      <Section title={t("nav.vms")} href="/vms" viewAll={t("hosts.viewAll")}>
        {(data?.vms ?? []).map((vm) => (
          <Row
            key={`${vm.node}-${vm.vmid}`}
            href={`/vms/${params.id}/${vm.node}/${vm.vmid}`}
            id={vm.vmid}
            name={`${vm.name} · ${vm.node}`}
            status={vm.status}
          />
        ))}
      </Section>
      <Section title={t("nav.containers")} href="/containers" viewAll={t("hosts.viewAll")}>
        {(data?.containers ?? []).map((ct) => (
          <Row
            key={`${ct.node}-${ct.vmid}`}
            href={`/containers/${params.id}/${ct.node}/${ct.vmid}`}
            id={ct.vmid}
            name={`${ct.name} · ${ct.node}`}
            status={ct.status}
          />
        ))}
      </Section>
      <Section title={t("nav.storage")} href="/storage" viewAll={t("hosts.viewAll")}>
        {(data?.storage ?? []).map((s) => (
          <div key={`${s.node ?? ""}-${s.storage}`} className="flex items-center justify-between border-t border-border py-2 text-sm">
            <span>{s.storage}</span>
            <span className="text-muted-foreground">{s.type}</span>
          </div>
        ))}
      </Section>
      {isLoading ? <p className="text-sm text-muted-foreground">{t("hosts.loadingTelemetry")}</p> : null}
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
