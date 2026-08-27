"use client";

import { useParams, useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { useQuery, useQueryClient } from "@tanstack/react-query";
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
import { CloneDialog } from "@/components/guests/clone-dialog";
import { BackupNowDialog } from "@/components/backups/backup-now-dialog";
import { RestoreDialog } from "@/components/backups/restore-dialog";
import type { BackupFile, BackupOverview } from "@/components/backups/types";
import { api } from "@/lib/api";
import { bytesToSize, formatUptime, percentage } from "@/lib/utils";
import type { PublicHost } from "@/lib/types";
import { useI18n } from "@/components/i18n/locale-provider";

type GuestPayload = {
  status: Record<string, unknown>;
  config: Record<string, unknown>;
  snapshots: Array<Record<string, unknown>>;
};

function num(value: unknown): number {
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : 0;
}

export default function GuestDetailPage({ kind }: { kind: "vm" | "lxc" }) {
  const { t } = useI18n();
  const router = useRouter();
  const qc = useQueryClient();
  const params = useParams<{ hostId: string; node: string; vmid: string }>();
  const search = useSearchParams();
  const listPath = kind === "vm" ? "/vms" : "/containers";
  const listQueryKey = kind === "vm" ? ["all-vms"] : ["all-lxc"];
  const kindLabel = kind === "vm" ? "VM" : "LXC";
  const [snap, setSnap] = useState("");
  const [saving, setSaving] = useState(false);
  const [consoleOpen, setConsoleOpen] = useState(search.get("tab") === "console" || search.get("console") === "1");
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
  const { data: options } = useQuery({
    queryKey: ["options", params.hostId],
    queryFn: () => api<{ nextid: number | null }>(`/api/hosts/${params.hostId}/options`),
  });
  const { data: backups } = useQuery({
    queryKey: ["backups", params.hostId],
    queryFn: () => api<BackupOverview>(`/api/hosts/${params.hostId}/backups`),
  });
  const [restoreFile, setRestoreFile] = useState<BackupFile | null>(null);

  async function action(name: string, extra: Record<string, unknown> = {}) {
    await api(path, { method: "POST", body: JSON.stringify({ action: name, ...extra }) });
    if (name === "delete") {
      toast.success(t("guest.deleted", { kind: kindLabel, id: params.vmid }));
      await qc.invalidateQueries({ queryKey: listQueryKey });
      router.push(listPath);
      return;
    }
    toast.success(name === "config" ? t("guest.configSaved") : t("common.taskDone"));
    void refetch();
  }

  const status = data?.status ?? {};
  const config = data?.config ?? {};
  const runState = String(status.status ?? "unknown");
  const running = runState === "running";
  const paused = runState === "paused";
  const stopped = !running && !paused;
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
  const guestFiles = (backups?.files ?? []).filter((f) => f.vmid === Number(params.vmid));
  const latestBackup = guestFiles[0] ?? null;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="proxora-section">{kindLabel}</p>
          <h1 className="proxora-title mt-1 text-3xl md:text-4xl">
            {params.vmid} · {name}
          </h1>
          <p className="text-sm text-muted-foreground">
            <Link className="hover:underline" href={`/hosts/${params.hostId}`}>
              {hostName}
            </Link>
            {" / "}
            {params.node}
            {num(status.uptime) ? ` · ${t("guest.uptime", { time: formatUptime(num(status.uptime)) })}` : null}
          </p>
        </div>
        <GuestStateBadge status={runState} />
      </div>

      <div className="flex flex-wrap gap-2">
        <Button disabled={!stopped} onClick={() => void action("start")}>
          {t("guest.start")}
        </Button>
        <Button variant="outline" disabled={!running} onClick={() => void action("shutdown")}>
          {t("guest.shutdown")}
        </Button>
        <Button variant="outline" disabled={stopped} onClick={() => void action("stop")}>
          {t("guest.stop")}
        </Button>
        <Button variant="outline" disabled={!running} onClick={() => void action("reboot")}>
          {t("guest.reboot")}
        </Button>
        {kind === "vm" ? (
          <>
            <Button variant="outline" disabled={!running} onClick={() => void action("pause")}>
              {t("guest.pause")}
            </Button>
            <Button variant="outline" disabled={!paused} onClick={() => void action("resume")}>
              {t("guest.resume")}
            </Button>
            {stopped ? (
              <Button variant="destructive" disabled>
                {t("guest.reset")}
              </Button>
            ) : (
              <ConfirmAction
                title={t("guest.resetTitle")}
                description={t("guest.resetBody")}
                actionLabel={t("guest.reset")}
                destructive
                onConfirm={() => action("reset", { confirm: true })}
              >
                <Button variant="destructive">{t("guest.reset")}</Button>
              </ConfirmAction>
            )}
          </>
        ) : null}
        <CloneDialog
          kind={kind}
          vmid={Number(params.vmid)}
          name={name}
          nextid={options?.nextid}
          path={path}
          onDone={() => void refetch()}
        />
        <BackupNowDialog
          hostId={params.hostId}
          node={params.node}
          vmid={Number(params.vmid)}
          kind={kind}
          storages={backups?.backupStorages ?? []}
        />
        {latestBackup ? (
          <Button variant="outline" onClick={() => setRestoreFile(latestBackup)}>
            {t("backup.restore")}
          </Button>
        ) : null}
        <Button variant={consoleOpen ? "default" : "outline"} onClick={() => setConsoleOpen((v) => !v)}>
          {consoleOpen ? t("guest.consoleHide") : t("guest.console")}
        </Button>
        {running || paused ? (
          <Button variant="destructive" disabled>
            {t("guest.delete")}
          </Button>
        ) : (
          <ConfirmAction
            title={t("guest.deleteTitle", { kind: kindLabel, id: params.vmid })}
            description={t("guest.deleteBody", { id: params.vmid, name })}
            actionLabel={t("guest.delete")}
            destructive
            onConfirm={() => action("delete", { confirm: true })}
          >
            <Button variant="destructive">{t("guest.delete")}</Button>
          </ConfirmAction>
        )}
      </div>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Resource label={t("dashboard.cpu")} value={cpuPercent} detail={t("dashboard.cores", { n: cores || "—" }) + ` · ${Math.round(cpuPercent)}%`} />
        <Resource label={t("dashboard.ram")} value={percentage(mem, maxmem)} detail={`${bytesToSize(mem)} / ${bytesToSize(maxmem)}`} />
        <Resource label={t("dashboard.disk")} value={percentage(disk, maxdisk)} detail={`${bytesToSize(disk)} / ${bytesToSize(maxdisk)}`} />
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-muted-foreground">{t("guest.network")}</CardTitle>
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

      {consoleOpen ? (
        <WebConsole hostId={params.hostId} node={params.node} kind={kind} vmid={Number(params.vmid)} />
      ) : null}

      {isLoading ? <p className="text-sm text-muted-foreground">{t("common.loading")}</p> : null}

      {data?.config ? (
        <GuestConfigForm
          kind={kind}
          vmid={Number(params.vmid)}
          config={data.config}
          busy={saving}
          onSave={async (payload) => {
            setSaving(true);
            try {
              await action("config", { config: payload });
            } catch (e) {
              toast.error(e instanceof Error ? e.message : t("common.failed"));
              throw e;
            } finally {
              setSaving(false);
            }
          }}
        />
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>{t("guest.snapshots")}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex gap-2">
            <Input placeholder={t("guest.snapshotName")} value={snap} onChange={(e) => setSnap(e.target.value)} />
            <Button onClick={() => void action("snapshot", { snapname: snap || `snap-${Date.now()}` })}>
              {t("guest.createSnapshot")}
            </Button>
          </div>
          {(data?.snapshots ?? []).map((s) => (
            <div key={String(s.name)} className="flex items-center justify-between rounded-md border border-border px-3 py-2 text-sm">
              <span>{String(s.name)}</span>
              {String(s.name) === "current" ? null : (
                <div className="flex gap-2">
                  <Button size="sm" variant="outline" onClick={() => void action("snapshot-rollback", { snapname: s.name })}>
                    {t("guest.restore")}
                  </Button>
                  <Button size="sm" variant="destructive" onClick={() => void action("snapshot-delete", { snapname: s.name })}>
                    {t("guest.delete")}
                  </Button>
                </div>
              )}
            </div>
          ))}
        </CardContent>
      </Card>
      {backups ? (
        <RestoreDialog
          hostId={params.hostId}
          overview={backups}
          file={restoreFile}
          open={Boolean(restoreFile)}
          onOpenChange={(next) => {
            if (!next) setRestoreFile(null);
          }}
          onDone={() => void refetch()}
        />
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
