"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { ConfirmAction } from "@/components/confirm-action";
import { PageHeader } from "@/components/layout/page-header";
import { api } from "@/lib/api";
import { bytesToSize } from "@/lib/utils";
import { filterBackupFiles, type BackupFileFilter } from "@/lib/backup";
import type { PublicHost } from "@/lib/types";
import { useI18n } from "@/components/i18n/locale-provider";
import { useCan } from "@/components/auth/session-user";
import { JobDialog } from "@/components/backups/job-dialog";
import { BackupTaskDialog } from "@/components/backups/backup-task-dialog";
import { RestoreDialog } from "@/components/backups/restore-dialog";
import type { BackupFile, BackupJob, BackupOverview } from "@/components/backups/types";

export default function BackupsPage() {
  const { t, locale } = useI18n();
  const qc = useQueryClient();
  const { data: hosts } = useQuery({
    queryKey: ["hosts"],
    queryFn: () => api<{ hosts: PublicHost[] }>("/api/hosts"),
  });
  const hostIds = hosts?.hosts.map((h) => h.id);
  const { data } = useQuery({
    queryKey: ["backups", hostIds],
    enabled: Boolean(hosts),
    queryFn: async () => {
      const rows = await Promise.all(
        (hosts?.hosts ?? []).map(async (h) => {
          try {
            const overview = await api<BackupOverview>(`/api/hosts/${h.id}/backups`);
            return { host: h, overview };
          } catch (error) {
            return { host: h, overview: null as BackupOverview | null, error: error instanceof Error ? error.message : true };
          }
        }),
      );
      return rows;
    },
    refetchInterval: 20_000,
  });

  function refresh() {
    void qc.invalidateQueries({ queryKey: ["backups"] });
  }

  return (
    <div className="space-y-4">
      <PageHeader kicker={t("backup.kicker")} title={t("backup.title")} description={t("backup.description")} />
      {(data ?? []).map((block) => (
        <HostBackups
          key={block.host.id}
          hostId={block.host.id}
          hostName={block.host.name}
          overview={block.overview}
          error={"error" in block ? block.error : undefined}
          locale={locale}
          onDone={refresh}
        />
      ))}
    </div>
  );
}

function HostBackups({
  hostId,
  hostName,
  overview,
  error,
  locale,
  onDone,
}: {
  hostId: string;
  hostName: string;
  overview: BackupOverview | null;
  error?: string | boolean;
  locale: string;
  onDone: () => void;
}) {
  const { t } = useI18n();
  const canCreateJob = useCan("backup.job.create");
  const canUpdateJob = useCan("backup.job.update");
  const canDeleteJob = useCan("backup.job.delete");
  const canRun = useCan("backup.run");
  const canRestore = useCan("backup.restore");
  const canDeleteFile = useCan("backup.delete");
  const [jobOpen, setJobOpen] = useState(false);
  const [editJob, setEditJob] = useState<BackupJob | null>(null);
  const [restoreFile, setRestoreFile] = useState<BackupFile | null>(null);
  const [runTask, setRunTask] = useState<{ node: string; upid: string; title: string } | null>(null);
  const [fileQuery, setFileQuery] = useState("");
  const [fileKind, setFileKind] = useState<BackupFileFilter["kind"]>("all");
  const [fileStorage, setFileStorage] = useState("all");
  const [filePeriod, setFilePeriod] = useState<BackupFileFilter["period"]>("all");
  const dateLocale = locale === "en" ? "en-GB" : "de-DE";
  const guestNames = useMemo(() => new Map((overview?.guests ?? []).map((g) => [g.vmid, g.name])), [overview?.guests]);
  const storageOptions = useMemo(
    () => [...new Set([...(overview?.backupStorages ?? []), ...(overview?.files ?? []).map((f) => f.storage)])].filter(Boolean).sort(),
    [overview],
  );
  const filteredFiles = useMemo(
    () =>
      filterBackupFiles(
        overview?.files ?? [],
        { query: fileQuery, kind: fileKind, storage: fileStorage, period: filePeriod },
        guestNames,
      ),
    [overview?.files, fileQuery, fileKind, fileStorage, filePeriod, guestNames],
  );

  const guestLabel = useMemo(() => {
    const map = new Map((overview?.guests ?? []).map((g) => [g.vmid, g.name]));
    return (ids: string, all: boolean) => {
      if (all || !ids) return t("backup.allGuests");
      return ids
        .split(",")
        .map((id) => {
          const n = Number(id.trim());
          const name = map.get(n);
          return name ? `${n} ${name}` : id.trim();
        })
        .filter(Boolean)
        .join(", ");
    };
  }, [overview?.guests, t]);

  async function post(body: Record<string, unknown>, successKey: "backup.jobDeleted" | "backup.fileDeleted") {
    try {
      await api(`/api/hosts/${hostId}/backups`, { method: "POST", body: JSON.stringify(body) });
      toast.success(t(successKey));
      onDone();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("common.failed"));
    }
  }

  async function runJob(job: BackupJob) {
    try {
      const res = await api<{ upid?: string; node?: string }>(`/api/hosts/${hostId}/backups`, {
        method: "POST",
        body: JSON.stringify({ action: "run-job", id: job.id, node: job.node || overview?.primaryNode }),
      });
      if (!res.upid) throw new Error(t("common.failed"));
      setRunTask({
        node: res.node || job.node || overview?.primaryNode || "",
        upid: res.upid,
        title: t("backup.runJob"),
      });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("common.failed"));
    }
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-3">
        <CardTitle>{hostName}</CardTitle>
        {overview && canCreateJob ? (
          <Button
            size="sm"
            onClick={() => {
              setEditJob(null);
              setJobOpen(true);
            }}
          >
            {t("backup.addJob")}
          </Button>
        ) : null}
      </CardHeader>
      <CardContent className="space-y-6">
        {error ? (
          <p className="text-sm text-destructive">{typeof error === "string" ? error : t("common.failed")}</p>
        ) : null}
        {overview ? (
          <>
            <section>
              <p className="proxora-section mb-2">{t("backup.jobs")}</p>
              {overview.jobs.length === 0 ? (
                <p className="text-sm text-muted-foreground">{t("backup.noJobs")}</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[640px] text-left text-sm">
                    <thead className="font-[family-name:var(--font-display)] text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
                      <tr>
                        <th className="py-2 font-medium">{t("backup.schedule")}</th>
                        <th className="font-medium">{t("backup.storage")}</th>
                        <th className="font-medium">{t("backup.mode")}</th>
                        <th className="font-medium">{t("backup.guests")}</th>
                        <th className="font-medium">{t("table.status")}</th>
                        <th className="font-medium">{t("table.actions")}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {overview.jobs.map((job) => (
                        <tr key={job.id} className="border-t border-border">
                          <td className="py-2 font-mono text-xs">{job.schedule || "—"}</td>
                          <td>{job.storage}</td>
                          <td>{job.mode}</td>
                          <td className="max-w-xs truncate">{guestLabel(job.vmid, job.all)}</td>
                          <td>
                            <Badge variant={job.enabled ? "success" : "muted"}>
                              {job.enabled ? t("settings.enabled") : t("settings.disabled")}
                            </Badge>
                          </td>
                          <td>
                            <div className="flex flex-wrap gap-1">
                              {canUpdateJob ? (
                                <Button
                                  size="sm"
                                  variant="outline"
                                  onClick={() => {
                                    setEditJob(job);
                                    setJobOpen(true);
                                  }}
                                >
                                  {t("backup.editJob")}
                                </Button>
                              ) : null}
                              {canRun ? (
                                <Button
                                  size="sm"
                                  variant="outline"
                                  disabled={Boolean(runTask)}
                                  onClick={() => void runJob(job)}
                                >
                                  {t("backup.runJob")}
                                </Button>
                              ) : null}
                              {canDeleteJob ? (
                                <ConfirmAction
                                  title={t("backup.deleteJobTitle", { id: job.id })}
                                  description={t("backup.deleteJobBody")}
                                  actionLabel={t("backup.deleteJob")}
                                  destructive
                                  onConfirm={() => post({ action: "delete-job", id: job.id }, "backup.jobDeleted")}
                                >
                                  <Button size="sm" variant="destructive">
                                    {t("backup.deleteJob")}
                                  </Button>
                                </ConfirmAction>
                              ) : null}
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
            <section>
              <div className="mb-2 flex flex-wrap items-end justify-between gap-2">
                <p className="proxora-section">{t("backup.files")}</p>
                {overview.files.length ? (
                  <p className="text-xs text-muted-foreground">
                    {t("backup.filterCount", { shown: filteredFiles.length, total: overview.files.length })}
                  </p>
                ) : null}
              </div>
              {overview.files.length === 0 ? (
                <p className="text-sm text-muted-foreground">{t("backup.noFiles")}</p>
              ) : (
                <>
                  <div className="mb-3 flex flex-wrap gap-2">
                    <Input
                      placeholder={t("backup.filterSearch")}
                      value={fileQuery}
                      onChange={(e) => setFileQuery(e.target.value)}
                      className="max-w-xs"
                    />
                    <select
                      className="h-9 rounded-[4px] border border-input bg-white/[0.03] px-2 text-sm"
                      value={fileKind}
                      onChange={(e) => setFileKind(e.target.value as BackupFileFilter["kind"])}
                    >
                      <option value="all">{t("backup.allTypes")}</option>
                      <option value="vm">VM</option>
                      <option value="lxc">LXC</option>
                    </select>
                    <select
                      className="h-9 rounded-[4px] border border-input bg-white/[0.03] px-2 text-sm"
                      value={fileStorage}
                      onChange={(e) => setFileStorage(e.target.value)}
                    >
                      <option value="all">{t("backup.allStorages")}</option>
                      {storageOptions.map((s) => (
                        <option key={s} value={s}>
                          {s}
                        </option>
                      ))}
                    </select>
                    <select
                      className="h-9 rounded-[4px] border border-input bg-white/[0.03] px-2 text-sm"
                      value={filePeriod}
                      onChange={(e) => setFilePeriod(e.target.value as BackupFileFilter["period"])}
                    >
                      <option value="all">{t("backup.period.all")}</option>
                      <option value="day">{t("backup.period.day")}</option>
                      <option value="week">{t("backup.period.week")}</option>
                      <option value="month">{t("backup.period.month")}</option>
                    </select>
                  </div>
                  {filteredFiles.length === 0 ? (
                    <p className="text-sm text-muted-foreground">{t("backup.filterEmpty")}</p>
                  ) : (
                    <div className="overflow-x-auto">
                      <table className="w-full min-w-[720px] text-left text-sm">
                        <thead className="font-[family-name:var(--font-display)] text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
                          <tr>
                            <th className="py-2 font-medium">{t("table.id")}</th>
                            <th className="font-medium">{t("table.name")}</th>
                            <th className="font-medium">{t("table.type")}</th>
                            <th className="font-medium">{t("backup.date")}</th>
                            <th className="font-medium">{t("backup.size")}</th>
                            <th className="font-medium">{t("backup.storage")}</th>
                            <th className="font-medium">{t("table.actions")}</th>
                          </tr>
                        </thead>
                        <tbody>
                          {filteredFiles.map((file) => (
                            <tr key={file.volid} className="border-t border-border">
                              <td className="py-2 font-mono">{file.vmid ?? "—"}</td>
                              <td className="max-w-[180px] truncate">{file.vmid != null ? guestNames.get(file.vmid) ?? "—" : "—"}</td>
                              <td>{file.kind === "lxc" ? "LXC" : file.kind === "vm" ? "VM" : "—"}</td>
                              <td>{file.ctime ? new Date(file.ctime).toLocaleString(dateLocale) : "—"}</td>
                              <td>{bytesToSize(file.size)}</td>
                              <td className="max-w-[220px] truncate text-muted-foreground" title={file.volid}>
                                {file.storage}
                              </td>
                              <td>
                                <div className="flex flex-wrap gap-1">
                                  {canRestore ? (
                                    <Button size="sm" variant="outline" onClick={() => setRestoreFile(file)}>
                                      {t("backup.restore")}
                                    </Button>
                                  ) : null}
                                  {canDeleteFile ? (
                                    <ConfirmAction
                                      title={t("backup.deleteFileTitle")}
                                      description={t("backup.deleteFileBody", { volid: file.volid })}
                                      actionLabel={t("backup.deleteFile")}
                                      destructive
                                      onConfirm={() =>
                                        post({ action: "delete-file", node: file.node, volid: file.volid }, "backup.fileDeleted")
                                      }
                                    >
                                      <Button size="sm" variant="destructive">
                                        {t("backup.deleteFile")}
                                      </Button>
                                    </ConfirmAction>
                                  ) : null}
                                </div>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </>
              )}
            </section>
            <JobDialog
              hostId={hostId}
              overview={overview}
              job={editJob}
              open={jobOpen}
              onOpenChange={(next) => {
                setJobOpen(next);
                if (!next) setEditJob(null);
              }}
              onDone={onDone}
            />
            <BackupTaskDialog
              hostId={hostId}
              node={runTask?.node ?? ""}
              upid={runTask?.upid ?? null}
              open={Boolean(runTask)}
              title={runTask?.title ?? t("backup.runJob")}
              onOpenChange={(next) => {
                if (!next) setRunTask(null);
              }}
              onDone={onDone}
            />
            <RestoreDialog
              hostId={hostId}
              overview={overview}
              file={restoreFile}
              open={Boolean(restoreFile)}
              onOpenChange={(next) => {
                if (!next) setRestoreFile(null);
              }}
              onDone={onDone}
            />
          </>
        ) : null}
      </CardContent>
    </Card>
  );
}
