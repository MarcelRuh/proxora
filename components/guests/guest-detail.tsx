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
import { actionDeniedTitle } from "@/lib/action-lock";
import { hostAllowsMigrate } from "@/lib/guest-migrate";
import { openGuestToolWindow } from "@/lib/guest-tool-window";
import { isWindowsOstype } from "@/lib/iso-images";
import type { Permission } from "@/lib/permissions";
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
    enabled: Boolean(isCluster),
    staleTime: 20_000,
  });
  const [restoreOpen, setRestoreOpen] = useState(false);

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

  function runAction(name: string, extra: Record<string, unknown> = {}) {
    void action(name, extra).catch((err: unknown) => {
      toast.error(err instanceof Error ? err.message : t("common.failed"));
    });
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
  const shareHost = hostMeta ?? { origin: "LOCAL" as const };
  const prefix = kind === "vm" ? "vm" : "lxc";
  const shareBlocked = t("peers.shareBlocked");
  const noPerm = t("common.noPermission");
  const deny = (rbac: boolean, shareOk: boolean) => actionDeniedTitle(rbac, shareOk, shareBlocked, noPerm);
  const gp = (action: string) => `${prefix}.${action}` as Permission;
  const share = {
    start: peerHostAllowsPermission(shareHost, gp("start")),
    shutdown: peerHostAllowsPermission(shareHost, gp("shutdown")),
    stop: peerHostAllowsPermission(shareHost, gp("force-stop")),
    reboot: peerHostAllowsPermission(shareHost, gp("reboot")),
    pause: peerHostAllowsPermission(shareHost, "vm.pause"),
    resume: peerHostAllowsPermission(shareHost, "vm.resume"),
    reset: peerHostAllowsPermission(shareHost, "vm.reset"),
    clone: peerHostAllowsPermission(shareHost, gp("clone")),
    migrate: peerHostAllowsPermission(shareHost, gp("migrate")),
    delete: peerHostAllowsPermission(shareHost, gp("delete")),
    console: peerHostAllowsPermission(shareHost, gp("console")),
    files: peerHostAllowsPermission(
      shareHost,
      kind === "vm" ? ["vm.files.read", "vm.files.write"] : ["lxc.files.read", "lxc.files.write"],
    ),
    config: peerHostAllowsPermission(shareHost, gp("config")),
    backup: peerHostAllowsPermission(shareHost, "backup.run"),
    restore: peerHostAllowsPermission(shareHost, "backup.restore"),
    snapshotCreate: peerHostAllowsPermission(shareHost, gp("snapshot.create")),
    snapshotDelete: peerHostAllowsPermission(shareHost, gp("snapshot.delete")),
    snapshotRollback: peerHostAllowsPermission(shareHost, gp("snapshot.rollback")),
  };
  const showMigrate = Boolean(isCluster);

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
        <Button
          disabled={Boolean(deny(can.start, share.start)) || !stopped}
          title={deny(can.start, share.start)}
          onClick={() => runAction("start")}
        >
          {t("guest.start")}
        </Button>
        <Button
          variant="outline"
          disabled={Boolean(deny(can.shutdown, share.shutdown)) || !running}
          title={deny(can.shutdown, share.shutdown)}
          onClick={() => runAction("shutdown")}
        >
          {t("guest.shutdown")}
        </Button>
        <Button
          variant="outline"
          disabled={Boolean(deny(can.stop, share.stop)) || stopped}
          title={deny(can.stop, share.stop)}
          onClick={() => runAction("stop")}
        >
          {t("guest.stop")}
        </Button>
        <Button
          variant="outline"
          disabled={Boolean(deny(can.reboot, share.reboot)) || !running}
          title={deny(can.reboot, share.reboot)}
          onClick={() => runAction("reboot")}
        >
          {t("guest.reboot")}
        </Button>
        {kind === "vm" ? (
          <>
            <Button
              variant="outline"
              disabled={Boolean(deny(can.pause, share.pause)) || !running}
              title={deny(can.pause, share.pause)}
              onClick={() => runAction("pause")}
            >
              {t("guest.pause")}
            </Button>
            <Button
              variant="outline"
              disabled={Boolean(deny(can.resume, share.resume)) || !paused}
              title={deny(can.resume, share.resume)}
              onClick={() => runAction("resume")}
            >
              {t("guest.resume")}
            </Button>
            {deny(can.reset, share.reset) || stopped ? (
              <Button variant="destructive" disabled title={deny(can.reset, share.reset)}>
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
          hostId={params.hostId}
          node={params.node}
          vmid={Number(params.vmid)}
          name={name}
          path={path}
          disabled={Boolean(deny(can.clone, share.clone))}
          disabledReason={deny(can.clone, share.clone)}
          onDone={() => void refetch()}
        />
        {showMigrate ? (
          <MigrateDialog
            kind={kind}
            hostId={params.hostId}
            node={params.node}
            vmid={Number(params.vmid)}
            path={path}
            running={running || paused}
            disabled={
              Boolean(deny(can.migrate, share.migrate)) ||
              !hostAllowsMigrate(isCluster, hostStatus?.nodes, params.node)
            }
            disabledReason={deny(can.migrate, share.migrate)}
            onDone={(target) => {
              router.push(`/${kind === "lxc" ? "containers" : "vms"}/${params.hostId}/${encodeURIComponent(target)}/${params.vmid}`);
            }}
          />
        ) : null}
        <BackupNowDialog
          hostId={params.hostId}
          node={params.node}
          vmid={Number(params.vmid)}
          kind={kind}
          disabled={Boolean(deny(can.backup, share.backup))}
          disabledReason={deny(can.backup, share.backup)}
          onDone={() => void qc.invalidateQueries({ queryKey: ["backups"] })}
        />
        <Button
          variant="outline"
          disabled={Boolean(deny(can.restore, share.restore))}
          title={deny(can.restore, share.restore)}
          onClick={() => setRestoreOpen(true)}
        >
          {t("backup.restore")}
        </Button>
        <Button
          variant="outline"
          disabled={Boolean(deny(can.console, share.console))}
          title={deny(can.console, share.console)}
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
        {windows ? null : (
          <Button
            variant="outline"
            disabled={Boolean(deny(can.files, share.files))}
            title={deny(can.files, share.files)}
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
        )}
        <GuestDeleteDialog
          hostId={params.hostId}
          node={params.node}
          kind={kind}
          vmid={Number(params.vmid)}
          name={name}
          kindLabel={kindLabel}
          disabled={Boolean(deny(can.delete, share.delete))}
          onConfirm={(backupVolids, phase) =>
            api<{ upid?: unknown; phase?: "shutdown" | "stop" | "delete" }>(path, {
              method: "POST",
              body: JSON.stringify({ action: "delete", confirm: true, wait: false, backupVolids, phase }),
            })
          }
          onFinished={() => {
            void invalidateDashboardQueries(qc);
            router.push(listPath);
          }}
        >
          <Button
            variant="destructive"
            disabled={Boolean(deny(can.delete, share.delete))}
            title={deny(can.delete, share.delete)}
          >
            {t("guest.delete")}
          </Button>
        </GuestDeleteDialog>
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
          readOnly={!can.config || !share.config}
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
          canEdit={can.config && share.config}
        />
      ) : null}

      <GuestFirewallCard
        hostId={params.hostId}
        kind={kind}
        node={params.node}
        vmid={Number(params.vmid)}
        canEdit={can.config && share.config}
      />

      <Card>
        <CardHeader>
          <CardTitle>{t("guest.snapshots")}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex gap-2">
            <Input
              placeholder={t("guest.snapshotName")}
              value={snap}
              onChange={(e) => setSnap(e.target.value)}
              disabled={Boolean(deny(can.snapshotCreate, share.snapshotCreate))}
            />
            <Button
              disabled={Boolean(deny(can.snapshotCreate, share.snapshotCreate))}
              title={deny(can.snapshotCreate, share.snapshotCreate)}
              onClick={() => runAction("snapshot", { snapname: snap || `snap-${Date.now()}` })}
            >
              {t("guest.createSnapshot")}
            </Button>
          </div>
          {(data?.snapshots ?? []).map((s) => (
            <div key={String(s.name)} className="flex items-center justify-between rounded-md border border-border px-3 py-2 text-sm">
              <span>{String(s.name)}</span>
              {String(s.name) === "current" ? null : (
                <div className="flex gap-2">
                  <ConfirmAction
                    title={t("guest.snapshotRestoreTitle")}
                    description={t("guest.snapshotRestoreBody", { name: String(s.name) })}
                    actionLabel={t("guest.restore")}
                    disabled={Boolean(deny(can.snapshotRollback, share.snapshotRollback))}
                    onConfirm={() => action("snapshot-rollback", { snapname: s.name })}
                  >
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={Boolean(deny(can.snapshotRollback, share.snapshotRollback))}
                      title={deny(can.snapshotRollback, share.snapshotRollback)}
                    >
                      {t("guest.restore")}
                    </Button>
                  </ConfirmAction>
                  <ConfirmAction
                    title={t("guest.snapshotDeleteTitle")}
                    description={t("guest.snapshotDeleteBody", { name: String(s.name) })}
                    actionLabel={t("guest.delete")}
                    destructive
                    disabled={Boolean(deny(can.snapshotDelete, share.snapshotDelete))}
                    onConfirm={() => action("snapshot-delete", { snapname: s.name })}
                  >
                    <Button
                      size="sm"
                      variant="destructive"
                      disabled={Boolean(deny(can.snapshotDelete, share.snapshotDelete))}
                      title={deny(can.snapshotDelete, share.snapshotDelete)}
                    >
                      {t("guest.delete")}
                    </Button>
                  </ConfirmAction>
                </div>
              )}
            </div>
          ))}
        </CardContent>
      </Card>
      <RestoreDialog
        hostId={params.hostId}
        pickFor={{ vmid: Number(params.vmid), kind }}
        open={restoreOpen}
        onOpenChange={setRestoreOpen}
        onDone={() => void refetch()}
      />
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
