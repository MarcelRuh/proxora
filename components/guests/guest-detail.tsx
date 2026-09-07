"use client";

import { useParams, usePathname, useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { ProgressBar } from "@/components/ui/misc";
import { GuestStateBadge } from "@/components/status-badge";
import { ConfirmAction } from "@/components/confirm-action";
import { GuestDeleteDialog } from "@/components/guests/guest-delete-dialog";
import { GuestConfigForm } from "@/components/guests/guest-config-form";
import { CloneDialog } from "@/components/guests/clone-dialog";
import { MigrateDialog } from "@/components/guests/migrate-dialog";
import { BackupNowDialog } from "@/components/backups/backup-now-dialog";
import { RestoreDialog } from "@/components/backups/restore-dialog";
import type { BackupFile, BackupOverview } from "@/components/backups/types";
import { api } from "@/lib/api";
import { bytesToSize, formatUptime, guestCpuPercent, guestSizeDetail, percentage } from "@/lib/utils";
import type { PublicHost } from "@/lib/types";
import { useI18n } from "@/components/i18n/locale-provider";
import { useCan, useCanAny } from "@/components/auth/session-user";
import { PageSkeleton } from "@/components/layout/page-skeleton";
import { QueryGate } from "@/components/layout/query-gate";
import { parseGuestConfigIps } from "@/lib/create-ip";
import { invalidateDashboardQueries } from "@/components/dashboard/use-dashboard";
import { peerHostAllowsPermission } from "@/lib/federation-access";
import { hostAllowsMigrate } from "@/lib/guest-migrate";
import { openGuestToolWindow } from "@/lib/guest-tool-window";
import { isWindowsOstype } from "@/lib/iso-images";
import { GuestHaCard } from "@/components/guests/guest-ha-card";
import { GuestFirewallCard } from "@/components/guests/guest-firewall-card";

type GuestPayload = {
  status: Record<string, unknown>;
  config: Record<string, unknown>;
  snapshots: Array<Record<string, unknown>>;
  agentDisk?: { used: number; total: number } | null;
  agentEnabled?: boolean;
  ips?: string[];
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
  const hostId = params.hostId;
  const vmid = Number(params.vmid);
  const guest = { hostId, kind, vmid };
  const can = {
    start: useCan(kind === "vm" ? "vm.start" : "lxc.start", hostId, guest),
    shutdown: useCan(kind === "vm" ? "vm.shutdown" : "lxc.shutdown", hostId, guest),
    stop: useCan(kind === "vm" ? "vm.force-stop" : "lxc.force-stop", hostId, guest),
    snapshotCreate: useCan(kind === "vm" ? "vm.snapshot.create" : "lxc.snapshot.create", hostId, guest),
    snapshotDelete: useCan(kind === "vm" ? "vm.snapshot.delete" : "lxc.snapshot.delete", hostId, guest),
    snapshotRollback: useCan(kind === "vm" ? "vm.snapshot.rollback" : "lxc.snapshot.rollback", hostId, guest),
    reboot: useCan(kind === "vm" ? "vm.reboot" : "lxc.reboot", hostId, guest),
    pause: useCan("vm.pause", hostId, guest),
    resume: useCan("vm.resume", hostId, guest),
    reset: useCan("vm.reset", hostId, guest),
    clone: useCan(kind === "vm" ? "vm.clone" : "lxc.clone", hostId, guest),
    migrate: useCan(kind === "vm" ? "vm.migrate" : "lxc.migrate", hostId, guest),
    delete: useCan(kind === "vm" ? "vm.delete" : "lxc.delete", hostId, guest),
    console: useCan(kind === "vm" ? "vm.console" : "lxc.console", hostId, guest),
    files: useCanAny(
      kind === "vm" ? ["vm.files.read", "vm.files.write"] : ["lxc.files.read", "lxc.files.write"],
      hostId,
      guest,
    ),
    config: useCan(kind === "vm" ? "vm.config" : "lxc.config", hostId, guest),
    backup: useCan("backup.run", hostId),
    restore: useCan("backup.restore", hostId),
    hostsView: useCan("hosts.view"),
  };
  const search = useSearchParams();
  const pathname = usePathname();
  const listPath = kind === "vm" ? "/vms" : "/containers";
  const kindLabel = kind === "vm" ? "VM" : "LXC";
  const [snap, setSnap] = useState("");
  const [saving, setSaving] = useState(false);
  const path = `/api/hosts/${params.hostId}/${kind === "vm" ? "vms" : "lxc"}/${params.node}/${params.vmid}`;
  const { data, refetch, isLoading, error } = useQuery({
    queryKey: ["guest", kind, params.hostId, params.node, params.vmid],
    queryFn: () => api<GuestPayload>(path),
  });
  const { data: live } = useQuery({
    queryKey: ["guest-live", kind, params.hostId, params.node, params.vmid],
    queryFn: () => api<Pick<GuestPayload, "status" | "agentDisk">>(`${path}?light=1`),
    refetchInterval: 15_000,
    staleTime: 8_000,
    placeholderData: (previous) => previous,
    enabled: Boolean(data),
  });
  const { data: hosts } = useQuery({
    queryKey: ["hosts"],
    queryFn: () => api<{ hosts: PublicHost[] }>("/api/hosts"),
  });
  const isCluster = hosts?.hosts.find((h) => h.id === params.hostId)?.isClusterMember === true;
  const { data: hostStatus } = useQuery({
    queryKey: ["host", params.hostId],
    queryFn: () => api<{ nodes: Array<{ node: string; online: string }> }>(`/api/hosts/${params.hostId}/status`),
    enabled: Boolean(can.migrate && isCluster),
    staleTime: 20_000,
  });
  const [restoreFile, setRestoreFile] = useState<BackupFile | null>(null);

  useEffect(() => {
    const tab = search.get("tab");
    const tool =
      search.get("console") === "1" || tab === "console"
        ? "console"
        : search.get("files") === "1" || tab === "files"
          ? "files"
          : null;
    if (!tool) return;
    openGuestToolWindow({
      kind,
      hostId: params.hostId,
      node: params.node,
      vmid: params.vmid,
      tool,
    });
    router.replace(pathname);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- open once from old ?console=1 links
  }, []);
  const { data: backupOverview } = useQuery({
    queryKey: ["backups", params.hostId],
    queryFn: () => api<BackupOverview>(`/api/hosts/${params.hostId}/backups`),
    enabled: Boolean(restoreFile),
    staleTime: 60_000,
  });
  const { data: backups } = useQuery({
    queryKey: ["backup-files", params.hostId],
    queryFn: () => api<{ files: BackupFile[] }>(`/api/hosts/${params.hostId}/backups/files`),
    enabled: Boolean(restoreFile),
    staleTime: 60_000,
  });

  async function action(name: string, extra: Record<string, unknown> = {}) {
    await api(path, { method: "POST", body: JSON.stringify({ action: name, ...extra }) });
    if (name === "delete") {
      toast.success(t("guest.deleted", { kind: kindLabel, id: params.vmid }));
      await invalidateDashboardQueries(qc);
      router.push(listPath);
      return;
    }
    toast.success(
      name === "config"
        ? t("guest.configSaved")
        : name === "resize"
          ? t("config.diskResized")
          : name === "snapshot"
            ? t("guest.snapshotCreated")
            : t("common.taskDone"),
    );
    void refetch();
    void qc.invalidateQueries({ queryKey: ["guest-live", kind, params.hostId, params.node, params.vmid] });
    invalidateDashboardQueries(qc);
  }

  const status = live?.status ?? data?.status ?? {};
  const config = data?.config ?? {};
  const runState = String(status.status ?? "unknown");
  const running = runState === "running";
  const paused = runState === "paused";
  const stopped = !running && !paused;
  const name = String(config.name ?? config.hostname ?? status.name ?? params.vmid);
  const hostName = hosts?.hosts.find((h) => h.id === params.hostId)?.name ?? params.hostId;
  const cores = num(status.cpus) || num(config.cores) * Math.max(1, num(config.sockets) || 1) || num(config.cores);
  const cpuUsage = num(status.cpu);
  const cpuPercent = guestCpuPercent(cpuUsage, cores);
  const mem = num(status.mem);
  const maxmem = num(status.maxmem) || num(config.memory) * 1024 * 1024;
  const disk = num(status.disk);
  const maxdisk = num(status.maxdisk);
  const netin = num(status.netin);
  const netout = num(status.netout);
  const ips = data?.ips?.length ? data.ips : parseGuestConfigIps(config);
  const hostMeta = hosts?.hosts.find((h) => h.id === params.hostId);
  const windows = kind === "vm" && isWindowsOstype(String(config.ostype ?? ""));
  const canFiles =
    !windows &&
    can.files &&
    peerHostAllowsPermission(
      hostMeta ?? { origin: "LOCAL" },
      kind === "vm" ? ["vm.files.read", "vm.files.write"] : ["lxc.files.read", "lxc.files.write"],
    );
  const showMigrate = can.migrate && hostAllowsMigrate(isCluster, hostStatus?.nodes, params.node);

  if (isLoading) return <PageSkeleton />;
  if (error) {
    return <QueryGate isLoading={false} error={error} onRetry={() => void refetch()}>{null}</QueryGate>;
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="proxora-section">{kindLabel}</p>
          <h1 className="proxora-title mt-1 text-3xl md:text-4xl">
            {params.vmid} · {name}
          </h1>
          <p className="text-sm text-muted-foreground">
            {can.hostsView ? (
              <>
                <Link className="hover:underline" href={`/hosts/${params.hostId}`}>
                  {hostName}
                </Link>
                {" / "}
                {params.node}
                {num(status.uptime) ? ` · ${t("guest.uptime", { time: formatUptime(num(status.uptime)) })}` : null}
              </>
            ) : num(status.uptime) ? (
              t("guest.uptime", { time: formatUptime(num(status.uptime)) })
            ) : null}
          </p>
        </div>
        <GuestStateBadge status={runState} />
      </div>

      <div className="flex flex-wrap gap-2">
        {can.start ? (
          <Button disabled={!stopped} onClick={() => void action("start")}>
            {t("guest.start")}
          </Button>
        ) : null}
        {can.shutdown ? (
          <Button variant="outline" disabled={!running} onClick={() => void action("shutdown")}>
            {t("guest.shutdown")}
          </Button>
        ) : null}
        {can.stop ? (
          <Button variant="outline" disabled={stopped} onClick={() => void action("stop")}>
            {t("guest.stop")}
          </Button>
        ) : null}
        {can.reboot ? (
          <Button variant="outline" disabled={!running} onClick={() => void action("reboot")}>
            {t("guest.reboot")}
          </Button>
        ) : null}
        {kind === "vm" ? (
          <>
            {can.pause ? (
              <Button variant="outline" disabled={!running} onClick={() => void action("pause")}>
                {t("guest.pause")}
              </Button>
            ) : null}
            {can.resume ? (
              <Button variant="outline" disabled={!paused} onClick={() => void action("resume")}>
                {t("guest.resume")}
              </Button>
            ) : null}
            {can.reset ? (
              stopped ? (
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
              )
            ) : null}
          </>
        ) : null}
        {can.clone ? (
          <CloneDialog
            kind={kind}
            hostId={params.hostId}
            vmid={Number(params.vmid)}
            name={name}
            path={path}
            onDone={() => void refetch()}
          />
        ) : null}
        {showMigrate ? (
          <MigrateDialog
            kind={kind}
            hostId={params.hostId}
            node={params.node}
            vmid={Number(params.vmid)}
            path={path}
            running={running || paused}
            onDone={(target) => {
              router.push(`/${kind === "lxc" ? "containers" : "vms"}/${params.hostId}/${encodeURIComponent(target)}/${params.vmid}`);
            }}
          />
        ) : null}
        {can.backup ? (
          <BackupNowDialog
            hostId={params.hostId}
            node={params.node}
            vmid={Number(params.vmid)}
            kind={kind}
            onDone={() => void qc.invalidateQueries({ queryKey: ["backups"] })}
          />
        ) : null}
        {can.restore ? (
          <Button
            variant="outline"
            onClick={() => {
              const latest = (backups?.files ?? []).find((f) => f.vmid === Number(params.vmid));
              if (latest) {
                setRestoreFile(latest);
                return;
              }
              void qc
                .fetchQuery({
                  queryKey: ["backup-files", params.hostId],
                  queryFn: () => api<{ files: BackupFile[] }>(`/api/hosts/${params.hostId}/backups/files`),
                  staleTime: 60_000,
                })
                .then((overview) => {
                  const file = (overview.files ?? []).find((f) => f.vmid === Number(params.vmid));
                  if (!file) {
                    toast.error(t("backup.noFiles"));
                    return;
                  }
                  setRestoreFile(file);
                })
                .catch((err: unknown) => toast.error(err instanceof Error ? err.message : t("common.failed")));
            }}
          >
            {t("backup.restore")}
          </Button>
        ) : null}
        {can.console ? (
          <Button
            variant="outline"
            onClick={() =>
              openGuestToolWindow({
                kind,
                hostId: params.hostId,
                node: params.node,
                vmid: params.vmid,
                tool: "console",
              })
            }
          >
            {t("guest.console")}
          </Button>
        ) : null}
        {canFiles ? (
          <Button
            variant="outline"
            onClick={() =>
              openGuestToolWindow({
                kind,
                hostId: params.hostId,
                node: params.node,
                vmid: params.vmid,
                tool: "files",
              })
            }
          >
            {t("files.show")}
          </Button>
        ) : null}
        {can.delete ? (
          <GuestDeleteDialog
            hostId={params.hostId}
            kind={kind}
            vmid={Number(params.vmid)}
            name={name}
            kindLabel={kindLabel}
            onConfirm={(backupVolids) => action("delete", { confirm: true, backupVolids })}
          >
            <Button variant="destructive">{t("guest.delete")}</Button>
          </GuestDeleteDialog>
        ) : null}
      </div>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Resource label={t("dashboard.cpu")} value={cpuPercent} detail={t("dashboard.cores", { n: cores || "—" }) + ` · ${Math.round(cpuPercent)}%`} />
        <Resource label={t("dashboard.ram")} value={percentage(mem, maxmem)} detail={`${bytesToSize(mem)} / ${bytesToSize(maxmem)}`} />
        <Resource
          label={t("dashboard.disk")}
          value={percentage(disk, maxdisk)}
          detail={
            kind === "vm" && !maxdisk
              ? data?.agentEnabled
                ? t("guest.diskAgentSilent")
                : t("guest.diskAgentOff")
              : guestSizeDetail(disk, maxdisk)
          }
        />
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-muted-foreground">{t("guest.network")}</CardTitle>
          </CardHeader>
          <CardContent>
            {ips.length ? <p className="mb-1 font-mono text-sm">{ips.join(", ")}</p> : null}
            <p className="text-sm">
              ↓ {bytesToSize(netin)} <span className="text-muted-foreground">in</span>
            </p>
            <p className="text-sm">
              ↑ {bytesToSize(netout)} <span className="text-muted-foreground">out</span>
            </p>
          </CardContent>
        </Card>
      </div>

      {data?.config ? (
        <GuestConfigForm
          kind={kind}
          vmid={Number(params.vmid)}
          config={data.config}
          busy={saving}
          readOnly={!can.config}
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
          onResize={async (disk, size) => {
            setSaving(true);
            try {
              await action("resize", { disk, size });
            } catch (e) {
              toast.error(e instanceof Error ? e.message : t("common.failed"));
              throw e;
            } finally {
              setSaving(false);
            }
          }}
        />
      ) : null}

      {isCluster ? (
        <GuestHaCard
          hostId={params.hostId}
          kind={kind}
          node={params.node}
          vmid={Number(params.vmid)}
          canEdit={can.config}
        />
      ) : null}

      <GuestFirewallCard
        hostId={params.hostId}
        kind={kind}
        node={params.node}
        vmid={Number(params.vmid)}
        canEdit={can.config}
      />

      <Card>
        <CardHeader>
          <CardTitle>{t("guest.snapshots")}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {can.snapshotCreate ? (
            <div className="flex gap-2">
              <Input placeholder={t("guest.snapshotName")} value={snap} onChange={(e) => setSnap(e.target.value)} />
              <Button onClick={() => void action("snapshot", { snapname: snap || `snap-${Date.now()}` })}>
                {t("guest.createSnapshot")}
              </Button>
            </div>
          ) : null}
          {(data?.snapshots ?? []).map((s) => (
            <div key={String(s.name)} className="flex items-center justify-between rounded-md border border-border px-3 py-2 text-sm">
              <span>{String(s.name)}</span>
              {String(s.name) === "current" ? null : (
                <div className="flex gap-2">
                  {can.snapshotRollback ? (
                    <Button size="sm" variant="outline" onClick={() => void action("snapshot-rollback", { snapname: s.name })}>
                      {t("guest.restore")}
                    </Button>
                  ) : null}
                  {can.snapshotDelete ? (
                    <Button size="sm" variant="destructive" onClick={() => void action("snapshot-delete", { snapname: s.name })}>
                      {t("guest.delete")}
                    </Button>
                  ) : null}
                </div>
              )}
            </div>
          ))}
        </CardContent>
      </Card>
      {backupOverview ? (
        <RestoreDialog
          hostId={params.hostId}
          overview={backupOverview}
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
