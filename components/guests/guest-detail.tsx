"use client";

import { useParams, useSearchParams } from "next/navigation";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { ProgressBar } from "@/components/ui/misc";
import { GuestStateBadge } from "@/components/status-badge";
import { ConfirmAction } from "@/components/confirm-action";
import { WebConsole } from "@/components/console/web-console";
import { GuestConfigForm } from "@/components/guests/guest-config-form";
import { api } from "@/lib/api";
import { bytesToSize, formatUptime, percentage } from "@/lib/utils";
import type { PublicHost } from "@/lib/types";

type GuestPayload = {
  status: Record<string, unknown>;
  config: Record<string, unknown>;
  snapshots: Array<Record<string, unknown>>;
};

const TABS = [
  { id: "overview", label: "Übersicht" },
  { id: "config", label: "Config" },
  { id: "console", label: "Konsole" },
  { id: "snapshots", label: "Snapshots" },
] as const;

function num(value: unknown): number {
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : 0;
}

export default function GuestDetailPage({ kind }: { kind: "vm" | "lxc" }) {
  const params = useParams<{ hostId: string; node: string; vmid: string }>();
  const search = useSearchParams();
  const [tab, setTab] = useState(search.get("tab") ?? "overview");
  const [snap, setSnap] = useState("");
  const [saving, setSaving] = useState(false);
  const path = `/api/hosts/${params.hostId}/${kind === "vm" ? "vms" : "lxc"}/${params.node}/${params.vmid}`;
  const { data, refetch, isLoading } = useQuery({
    queryKey: ["guest", kind, params.hostId, params.node, params.vmid],
    queryFn: () => api<GuestPayload>(path),
    refetchInterval: 5_000,
  });
  const { data: hosts } = useQuery({
    queryKey: ["hosts"],
    queryFn: () => api<{ hosts: PublicHost[] }>("/api/hosts"),
  });

  async function action(name: string, extra: Record<string, unknown> = {}) {
    await api(path, { method: "POST", body: JSON.stringify({ action: name, ...extra }) });
    toast.success(name === "config" ? "Config gespeichert" : "Task gestartet");
    void refetch();
  }

  const status = data?.status ?? {};
  const config = data?.config ?? {};
  const runState = String(status.status ?? "unknown");
  const name = String(config.name ?? config.hostname ?? status.name ?? params.vmid);
  const hostName = hosts?.hosts.find((h) => h.id === params.hostId)?.name ?? params.hostId;
  const cores = num(status.cpus) || num(config.cores) * Math.max(1, num(config.sockets) || 1) || num(config.cores);
  const cpuUsage = num(status.cpu);
  const cpuPercent = cores > 0 ? (cpuUsage / cores) * 100 : cpuUsage * 100;
  const mem = num(status.mem);
  const maxmem = num(status.maxmem) || num(config.memory) * 1024 * 1024;
  const disk = num(status.disk);
  const maxdisk = num(status.maxdisk);
  const netin = num(status.netin);
  const netout = num(status.netout);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs uppercase tracking-wide text-muted-foreground">{kind === "vm" ? "VM" : "LXC"}</p>
          <h1 className="text-2xl font-semibold tracking-tight">
            {params.vmid} · {name}
          </h1>
          <p className="text-sm text-muted-foreground">
            <Link className="hover:underline" href={`/hosts/${params.hostId}`}>
              {hostName}
            </Link>
            {" / "}
            {params.node}
            {num(status.uptime) ? ` · Uptime ${formatUptime(num(status.uptime))}` : null}
          </p>
        </div>
        <GuestStateBadge status={runState} />
      </div>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Resource
          label="CPU"
          value={cpuPercent}
          detail={`${cores || "—"} Kerne · ${Math.round(cpuPercent)}%`}
        />
        <Resource
          label="RAM"
          value={percentage(mem, maxmem)}
          detail={`${bytesToSize(mem)} / ${bytesToSize(maxmem)}`}
        />
        <Resource
          label="Disk"
          value={percentage(disk, maxdisk)}
          detail={`${bytesToSize(disk)} / ${bytesToSize(maxdisk)}`}
        />
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-muted-foreground">Netzwerk</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm">
              ↓ {bytesToSize(netin)} <span className="text-muted-foreground">in</span>
            </p>
            <p className="text-sm">
              ↑ {bytesToSize(netout)} <span className="text-muted-foreground">out</span>
            </p>
          </CardContent>
        </Card>
      </div>

      <div className="flex flex-wrap gap-2">
        {TABS.map((t) => (
          <Button key={t.id} size="sm" variant={tab === t.id ? "default" : "outline"} onClick={() => setTab(t.id)}>
            {t.label}
          </Button>
        ))}
      </div>

      {isLoading ? <p className="text-sm text-muted-foreground">Lade…</p> : null}

      {tab === "overview" ? (
        <Card>
          <CardHeader>
            <CardTitle>Power</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-wrap gap-2">
            <Button onClick={() => void action("start")}>Start</Button>
            <Button variant="outline" onClick={() => void action("shutdown")}>
              Shutdown
            </Button>
            <Button variant="outline" onClick={() => void action("stop")}>
              Stop
            </Button>
            <Button variant="outline" onClick={() => void action("reboot")}>
              Reboot
            </Button>
            {kind === "vm" ? (
              <>
                <Button variant="outline" onClick={() => void action("pause")}>
                  Pause
                </Button>
                <Button variant="outline" onClick={() => void action("resume")}>
                  Resume
                </Button>
                <ConfirmAction
                  title="Hard reset?"
                  description="Entspricht Strom ziehen und wieder einschalten."
                  actionLabel="Reset"
                  destructive
                  onConfirm={() => action("reset", { confirm: true })}
                >
                  <Button variant="destructive">Reset</Button>
                </ConfirmAction>
              </>
            ) : null}
            <ConfirmAction
              title={`${kind === "vm" ? "VM" : "LXC"} ${params.vmid} löschen?`}
              description={`Kann nicht rückgängig gemacht werden. ${params.vmid} — ${name}`}
              confirmText="DELETE"
              actionLabel="Löschen"
              destructive
              onConfirm={() => action("delete", { confirm: true })}
            >
              <Button variant="destructive">Löschen</Button>
            </ConfirmAction>
          </CardContent>
        </Card>
      ) : null}

      {tab === "config" && data?.config ? (
        <GuestConfigForm
          kind={kind}
          config={data.config}
          busy={saving}
          onSave={async (payload) => {
            setSaving(true);
            try {
              await action("config", { config: payload });
            } catch (e) {
              toast.error(e instanceof Error ? e.message : "Speichern fehlgeschlagen");
              throw e;
            } finally {
              setSaving(false);
            }
          }}
        />
      ) : null}

      {tab === "console" ? (
        <WebConsole hostId={params.hostId} node={params.node} kind={kind} vmid={Number(params.vmid)} />
      ) : null}

      {tab === "snapshots" ? (
        <Card>
          <CardHeader>
            <CardTitle>Snapshots</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex gap-2">
              <Input placeholder="Snapshot-Name" value={snap} onChange={(e) => setSnap(e.target.value)} />
              <Button onClick={() => void action("snapshot", { snapname: snap || `snap-${Date.now()}` })}>Erstellen</Button>
            </div>
            {(data?.snapshots ?? []).map((s) => (
              <div key={String(s.name)} className="flex items-center justify-between rounded-md border border-border px-3 py-2 text-sm">
                <span>{String(s.name)}</span>
                {String(s.name) === "current" ? null : (
                  <div className="flex gap-2">
                    <Button size="sm" variant="outline" onClick={() => void action("snapshot-rollback", { snapname: s.name })}>
                      Restore
                    </Button>
                    <Button size="sm" variant="destructive" onClick={() => void action("snapshot-delete", { snapname: s.name })}>
                      Löschen
                    </Button>
                  </div>
                )}
              </div>
            ))}
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}

function Resource({ label, value, detail }: { label: string; value: number; detail: string }) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-muted-foreground">{label}</CardTitle>
      </CardHeader>
      <CardContent>
        <p className="mb-2 text-sm font-medium">{detail}</p>
        <ProgressBar value={value} />
      </CardContent>
    </Card>
  );
}
