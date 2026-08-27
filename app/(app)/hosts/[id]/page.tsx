"use client";

import { useQuery } from "@tanstack/react-query";
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

type Status = {
  host: string;
  nodes: Array<{
    node: string;
    status: { cpu: number; memory: { used: number; total: number }; rootfs?: { used: number; total: number }; uptime: number } | null;
  }>;
  vms: Array<{ vmid: number; name: string; status: string; node: string }>;
  containers: Array<{ vmid: number; name: string; status: string; node: string }>;
  storage: Array<{ storage: string; type: string; used?: number; total?: number }>;
};

export default function HostDetailPage() {
  const params = useParams<{ id: string }>();
  const [consoleNode, setConsoleNode] = useState<string | null>(null);
  const { data, error, refetch, isLoading } = useQuery({
    queryKey: ["host", params.id],
    queryFn: () => api<Status>(`/api/hosts/${params.id}/status`),
    refetchInterval: 8_000,
  });
  const { data: meta } = useQuery({
    queryKey: ["host-meta", params.id],
    queryFn: () => api<{ host: { name: string; connectionState: "ONLINE"; proxmoxVersion: string | null } }>(
      `/api/hosts/${params.id}`,
    ),
  });

  if (error) {
    return (
      <div className="proxora-panel p-6">
        <p className="font-medium">Verbindung zum Host fehlgeschlagen</p>
        <p className="text-sm text-muted-foreground">{error instanceof Error ? error.message : "Zeitüberschreitung"}</p>
        <Button className="mt-3" variant="outline" onClick={() => void refetch()}>
          Erneut versuchen
        </Button>
      </div>
    );
  }

  const node = data?.nodes[0];
  const st = node?.status;

  return (
    <div className="space-y-6">
      <PageHeader
        kicker="Host"
        title={meta?.host.name ?? data?.host ?? "Host"}
        description={`Proxmox VE ${meta?.host.proxmoxVersion ?? "—"}`}
        actions={meta ? <HostStateBadge state={meta.host.connectionState} /> : undefined}
      />
      {st ? (
        <Card>
          <CardContent className="grid gap-4 p-5 sm:grid-cols-3">
            <Metric label="CPU" value={st.cpu * 100} />
            <Metric label="Memory" value={percentage(st.memory.used, st.memory.total)} />
            <Metric label="Storage" value={percentage(st.rootfs?.used, st.rootfs?.total)} />
            <p className="text-sm text-muted-foreground sm:col-span-3">Uptime {formatUptime(st.uptime)}</p>
          </CardContent>
        </Card>
      ) : null}
      <div className="flex flex-wrap gap-2">
        <Button onClick={() => setConsoleNode(node?.node ?? null)}>Console</Button>
        <Button variant="outline" asChild>
          <Link href={`/updates?host=${params.id}`}>Updates</Link>
        </Button>
        <Button variant="outline" asChild>
          <Link href="/backups">Backups</Link>
        </Button>
        <ConfirmAction
          title="Reboot this node?"
          description="Running guests will be interrupted. Confirm you have a maintenance window."
          actionLabel="Reboot"
          destructive
          onConfirm={async () => {
            await api(`/api/hosts/${params.id}/status`, {
              method: "POST",
              body: JSON.stringify({ action: "reboot", node: node?.node, confirm: true }),
            });
            toast.success("Reboot task started");
          }}
        >
          <Button variant="destructive">Reboot</Button>
        </ConfirmAction>
        <ConfirmAction
          title="Shutdown this node?"
          description="The host will power off. You must start it out-of-band."
          actionLabel="Shutdown"
          destructive
          onConfirm={async () => {
            await api(`/api/hosts/${params.id}/status`, {
              method: "POST",
              body: JSON.stringify({ action: "shutdown", node: node?.node, confirm: true }),
            });
            toast.success("Shutdown task started");
          }}
        >
          <Button variant="destructive">Shutdown</Button>
        </ConfirmAction>
      </div>
      {consoleNode ? <WebConsole hostId={params.id} node={consoleNode} kind="node" /> : null}
      <Section title="Virtual Machines" href="/vms">
        {(data?.vms ?? []).map((vm) => (
          <Row key={vm.vmid} href={`/vms/${params.id}/${vm.node}/${vm.vmid}`} id={vm.vmid} name={vm.name} status={vm.status} />
        ))}
      </Section>
      <Section title="Containers" href="/containers">
        {(data?.containers ?? []).map((ct) => (
          <Row key={ct.vmid} href={`/containers/${params.id}/${ct.node}/${ct.vmid}`} id={ct.vmid} name={ct.name} status={ct.status} />
        ))}
      </Section>
      <Section title="Storage" href="/storage">
        {(data?.storage ?? []).map((s) => (
          <div key={s.storage} className="flex items-center justify-between border-t border-border py-2 text-sm">
            <span>{s.storage}</span>
            <span className="text-muted-foreground">{s.type}</span>
          </div>
        ))}
      </Section>
      {isLoading ? <p className="text-sm text-muted-foreground">Loading host telemetry…</p> : null}
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

function Section({ title, href, children }: { title: string; href: string; children: React.ReactNode }) {
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle>{title}</CardTitle>
        <Link href={href} className="text-xs text-muted-foreground hover:underline">
          View all
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
