"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ConfirmAction } from "@/components/confirm-action";
import { PageHeader } from "@/components/layout/page-header";
import { api } from "@/lib/api";
import { bytesToSize } from "@/lib/utils";
import type { PublicHost } from "@/lib/types";
import { useI18n } from "@/components/i18n/locale-provider";
import { JobDialog } from "@/components/backups/job-dialog";
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
  const [jobOpen, setJobOpen] = useState(false);
  const [editJob, setEditJob] = useState<BackupJob | null>(null);
  const [restoreFile, setRestoreFile] = useState<BackupFile | null>(null);
  const dateLocale = locale === "en" ? "en-GB" : "de-DE";

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

  async function post(body: Record<string, unknown>, successKey: "backup.started" | "backup.jobDeleted" | "backup.fileDeleted") {
    try {
      await api(`/api/hosts/${hostId}/backups`, { method: "POST", body: JSON.stringify(body) });
      toast.success(t(successKey));
      onDone();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("common.failed"));
    }
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-3">
        <CardTitle>{hostName}</CardTitle>
        {overview ? (
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
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => void post({ action: "run-job", id: job.id, node: job.node || overview.primaryNode }, "backup.started")}
                              >
                                {t("backup.runJob")}
                              </Button>
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
              <p className="proxora-section mb-2">{t("backup.files")}</p>
              {overview.files.length === 0 ? (
                <p className="text-sm text-muted-foreground">{t("backup.noFiles")}</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[720px] text-left text-sm">
                    <thead className="font-[family-name:var(--font-display)] text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
                      <tr>
                        <th className="py-2 font-medium">{t("table.id")}</th>
                        <th className="font-medium">{t("table.type")}</th>
                        <th className="font-medium">{t("backup.date")}</th>
                        <th className="font-medium">{t("backup.size")}</th>
                        <th className="font-medium">{t("backup.storage")}</th>
                        <th className="font-medium">{t("table.actions")}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {overview.files.map((file) => (
                        <tr key={file.volid} className="border-t border-border">
                          <td className="py-2 font-mono">{file.vmid ?? "—"}</td>
                          <td>{file.kind === "lxc" ? "LXC" : file.kind === "vm" ? "VM" : "—"}</td>
                          <td>{file.ctime ? new Date(file.ctime).toLocaleString(dateLocale) : "—"}</td>
                          <td>{bytesToSize(file.size)}</td>
                          <td className="max-w-[220px] truncate text-muted-foreground" title={file.volid}>
                            {file.storage}
                          </td>
                          <td>
                            <div className="flex flex-wrap gap-1">
                              <Button size="sm" variant="outline" onClick={() => setRestoreFile(file)}>
                                {t("backup.restore")}
                              </Button>
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
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
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
