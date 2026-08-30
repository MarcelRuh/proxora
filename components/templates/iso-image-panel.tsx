"use client";

import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ConfirmAction } from "@/components/confirm-action";
import { ProxmoxTaskProgress } from "@/components/backups/task-progress";
import { api } from "@/lib/api";
import { isFailedTaskExit } from "@/lib/backup-tasks";
import { useI18n } from "@/components/i18n/locale-provider";
import { useCan } from "@/components/auth/session-user";
import {
  filenameFromUrl,
  isoVolid,
  type IsoPackageRow,
} from "@/lib/iso-images";
import { formatVolumeUsers, usersForVolids, type VolumeUser } from "@/lib/volume-usage";

const selectClass =
  "h-9 rounded-[4px] border border-input bg-white/[0.03] px-2 text-sm";

type CatalogPayload = {
  nodes: string[];
  node: string;
  storages: string[];
  installed: string[];
  catalog: IsoPackageRow[];
  usedBy?: Record<string, VolumeUser[]>;
};

type TaskPayload = {
  status: { status?: string; exitstatus?: string };
  log: Array<{ n: number; t: string }>;
};

type Job = {
  upid: string;
  node: string;
  filename: string;
  kind: "download" | "update";
  replaceVolids: string[];
};

export function IsoImagePanel({ hostId }: { hostId: string }) {
  const { t } = useI18n();
  const canDelete = useCan("storage.delete");
  const [node, setNode] = useState("");
  const [storage, setStorage] = useState("");
  const [query, setQuery] = useState("");
  const [state, setState] = useState("all");
  const [customUrl, setCustomUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [job, setJob] = useState<Job | null>(null);
  const [finished, setFinished] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const settledRef = useRef(false);

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ["iso-images", hostId, node],
    enabled: Boolean(hostId),
    queryFn: () => {
      const q = node ? `?node=${encodeURIComponent(node)}` : "";
      return api<CatalogPayload>(`/api/hosts/${hostId}/isos${q}`);
    },
  });

  useEffect(() => {
    if (!data) return;
    setNode((current) => current || data.node || data.nodes[0] || "");
    setStorage((current) =>
      current && data.storages.includes(current) ? current : (data.storages[0] ?? ""),
    );
  }, [data]);

  function volidsFor(row: IsoPackageRow): string[] {
    if (row.installedVolids.length) return row.installedVolids;
    if (row.installedFilename && storage) return [isoVolid(storage, row.installedFilename)];
    return [];
  }

  const usedBy = data?.usedBy ?? {};
  const rows = data?.catalog ?? [];
  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return rows.filter((row) => {
      const hay = `${row.headline} ${row.latestFilename} ${row.installedFilename} ${row.section}`.toLowerCase();
      const textOk = !needle || hay.includes(needle);
      const stateOk =
        state === "all" ||
        (state === "installed" && Boolean(row.installedFilename)) ||
        (state === "available" && !row.installedFilename) ||
        (state === "updates" && row.updateAvailable);
      return textOk && stateOk;
    });
  }, [rows, query, state]);

  const tracking = Boolean(job?.upid) && !finished && !errorMsg;
  const pollNode = job?.node || node;
  const { data: task } = useQuery({
    queryKey: ["iso-image-task", hostId, pollNode, job?.upid],
    enabled: Boolean(job?.upid && pollNode),
    queryFn: () =>
      api<TaskPayload>(
        `/api/hosts/${hostId}/templates/task?node=${encodeURIComponent(pollNode)}&upid=${encodeURIComponent(job!.upid)}`,
      ),
    refetchInterval: tracking ? 1200 : false,
  });

  const logLines = (task?.log ?? []).map((l) => l.t).filter(Boolean);
  const showProgress = Boolean(job) || busy;

  useEffect(() => {
    if (!task?.status || finished || errorMsg || settledRef.current || !job) return;
    const st = task.status;
    if (!st.status || st.status === "running") return;
    settledRef.current = true;
    if (isFailedTaskExit(st)) {
      const message = st.exitstatus || t("iso.downloadFailed");
      setErrorMsg(message);
      setBusy(false);
      toast.error(message);
      return;
    }
    void (async () => {
      const oldFiles = canDelete
        ? job.replaceVolids.filter(
            (volid) => !volid.endsWith(`/${job.filename}`) && !volid.endsWith(job.filename),
          )
        : [];
      for (const volid of oldFiles) {
        try {
          await api(`/api/hosts/${hostId}/isos`, {
            method: "POST",
            body: JSON.stringify({ action: "delete", node: job.node, volid }),
          });
        } catch {
          /* keep the new file even if old cleanup fails */
        }
      }
      setFinished(true);
      setBusy(false);
      toast.success(job.kind === "update" ? t("iso.updateDone") : t("iso.downloadDone"));
      void refetch();
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [task]);

  useEffect(() => {
    if (!finished) return;
    const timer = window.setTimeout(() => {
      clearJob();
    }, 800);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [finished]);

  function clearJob() {
    setBusy(false);
    setJob(null);
    setFinished(false);
    setErrorMsg(null);
    settledRef.current = false;
  }

  async function startDownload(row: IsoPackageRow, kind: "download" | "update") {
    if (!node || !storage || !row.url || !row.latestFilename) return;
    setBusy(true);
    setJob(null);
    setFinished(false);
    setErrorMsg(null);
    settledRef.current = false;
    try {
      const res = await api<{ upid?: string; node?: string }>(`/api/hosts/${hostId}/isos`, {
        method: "POST",
        body: JSON.stringify({ node, storage, url: row.url, filename: row.latestFilename }),
      });
      if (!res.upid) throw new Error(t("common.failed"));
      setJob({
        upid: res.upid,
        node: res.node || node,
        filename: row.latestFilename,
        kind,
        replaceVolids: kind === "update" ? volidsFor(row) : [],
      });
    } catch (e) {
      setBusy(false);
      toast.error(e instanceof Error ? e.message : t("common.failed"));
    }
  }

  async function startCustom() {
    const url = customUrl.trim();
    const filename = filenameFromUrl(url);
    if (!node || !storage || !url) return;
    setBusy(true);
    setJob(null);
    setFinished(false);
    setErrorMsg(null);
    settledRef.current = false;
    try {
      const res = await api<{ upid?: string; node?: string; filename?: string }>(`/api/hosts/${hostId}/isos`, {
        method: "POST",
        body: JSON.stringify({ node, storage, url, filename }),
      });
      if (!res.upid) throw new Error(t("common.failed"));
      setJob({
        upid: res.upid,
        node: res.node || node,
        filename: res.filename || filename,
        kind: "download",
        replaceVolids: [],
      });
      setCustomUrl("");
    } catch (e) {
      setBusy(false);
      toast.error(e instanceof Error ? e.message : t("common.failed"));
    }
  }

  async function deleteInstalled(row: IsoPackageRow) {
    const volids = volidsFor(row);
    if (!node || !volids.length) throw new Error(t("common.failed"));
    setBusy(true);
    try {
      for (const volid of volids) {
        await api(`/api/hosts/${hostId}/isos`, {
          method: "POST",
          body: JSON.stringify({ action: "delete", node, volid }),
        });
      }
      toast.success(t("iso.deleted"));
      await refetch();
    } finally {
      setBusy(false);
    }
  }

  const locked = showProgress && !finished && !errorMsg;

  return (
    <div className="grid gap-3">
      <div className="flex flex-wrap gap-2">
        {(data?.nodes.length ?? 0) > 1 ? (
          <select className={selectClass} value={node} onChange={(e) => setNode(e.target.value)}>
            {(data?.nodes ?? []).map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        ) : null}
        <select
          className={selectClass}
          value={storage}
          onChange={(e) => setStorage(e.target.value)}
          disabled={!data?.storages.length}
        >
          {(data?.storages ?? []).map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
        <Input
          className="max-w-xs"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t("iso.search")}
          disabled={isLoading}
        />
        <select className={selectClass} value={state} onChange={(e) => setState(e.target.value)}>
          <option value="all">{t("tmpl.allStates")}</option>
          <option value="updates">{t("tmpl.updates")}</option>
          <option value="installed">{t("tmpl.installed")}</option>
          <option value="available">{t("tmpl.available")}</option>
        </select>
        <Button variant="outline" onClick={() => void refetch()} disabled={isLoading || busy}>
          {t("common.refresh")}
        </Button>
      </div>

      <div className="flex flex-wrap gap-2">
        <Input
          className="min-w-[16rem] flex-1"
          value={customUrl}
          onChange={(e) => setCustomUrl(e.target.value)}
          placeholder={t("iso.urlPlaceholder")}
          disabled={busy}
        />
        <Button
          variant="outline"
          disabled={!storage || busy || Boolean(job) || !customUrl.trim()}
          onClick={() => void startCustom()}
        >
          {t("iso.downloadUrl")}
        </Button>
      </div>

      {error ? (
        <p className="text-sm text-destructive">{error instanceof Error ? error.message : t("common.failed")}</p>
      ) : isLoading ? (
        <p className="text-sm text-muted-foreground">{t("common.loading")}</p>
      ) : !data?.storages.length && !rows.length ? (
        <p className="text-sm text-muted-foreground">{t("iso.noStorage")}</p>
      ) : !rows.length ? (
        <p className="text-sm text-muted-foreground">{t("iso.empty")}</p>
      ) : (
        <div className="max-h-[min(60vh,36rem)] overflow-auto rounded-[4px] border border-border">
          <table className="w-full min-w-[860px] text-left text-sm">
            <thead className="sticky top-0 z-10 bg-card font-[family-name:var(--font-display)] text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
              <tr>
                <th className="px-3 py-2 font-medium">{t("table.name")}</th>
                <th className="px-3 py-2 font-medium">{t("tmpl.installedVersion")}</th>
                <th className="px-3 py-2 font-medium">{t("tmpl.latestVersion")}</th>
                <th className="px-3 py-2 font-medium">{t("table.status")}</th>
                <th className="px-3 py-2 font-medium">{t("table.actions")}</th>
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-3 py-6 text-sm text-muted-foreground">
                    {t("iso.noMatch")}
                  </td>
                </tr>
              ) : (
                filtered.map((row) => {
                  const users = usersForVolids(usedBy, volidsFor(row));
                  const name = row.installedFilename || row.latestFilename;
                  return (
                    <tr key={row.key} className="border-t border-border">
                      <td className="px-3 py-2">
                        <div className="font-medium">{row.headline}</div>
                        <div className="text-xs text-muted-foreground">{row.latestFilename || row.installedFilename}</div>
                      </td>
                      <td className="px-3 py-2 tabular-nums text-muted-foreground">{row.installedVersion || "—"}</td>
                      <td className="px-3 py-2 tabular-nums text-muted-foreground">{row.latestVersion || "—"}</td>
                      <td className="px-3 py-2">
                        <div className="flex flex-wrap gap-1">
                          {row.updateAvailable ? (
                            <Badge variant="warning">{t("tmpl.updateAvailable")}</Badge>
                          ) : row.installedFilename ? (
                            <Badge variant="success">{t("tmpl.installed")}</Badge>
                          ) : (
                            <span className="text-muted-foreground">{t("tmpl.available")}</span>
                          )}
                          {users.length ? <Badge variant="warning">{t("tmpl.inUse")}</Badge> : null}
                        </div>
                      </td>
                      <td className="px-3 py-2">
                        <div className="flex flex-wrap gap-1">
                          {row.updateAvailable ? (
                            <Button
                              size="sm"
                              disabled={!storage || busy || Boolean(job) || !row.url}
                              onClick={() => void startDownload(row, "update")}
                            >
                              {t("tmpl.update")}
                            </Button>
                          ) : !row.installedFilename && row.url ? (
                            <Button
                              size="sm"
                              variant="outline"
                              disabled={!storage || busy || Boolean(job)}
                              onClick={() => void startDownload(row, "download")}
                            >
                              {t("tmpl.downloadAction")}
                            </Button>
                          ) : null}
                          {row.installedFilename && canDelete ? (
                            <ConfirmAction
                              title={t("iso.deleteTitle")}
                              description={
                                users.length
                                  ? t("iso.deleteInUse", { name, guests: formatVolumeUsers(users) })
                                  : t("iso.deleteBody", { name })
                              }
                              actionLabel={users.length ? t("tmpl.deleteAnyway") : t("tmpl.delete")}
                              destructive
                              onConfirm={() => deleteInstalled(row)}
                            >
                              <Button size="sm" variant="destructive" disabled={busy || Boolean(job)}>
                                {t("tmpl.delete")}
                              </Button>
                            </ConfirmAction>
                          ) : null}
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      )}

      <Dialog
        open={showProgress}
        onOpenChange={(next) => {
          if (!next && locked) return;
          if (!next) clearJob();
        }}
      >
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>{job?.kind === "update" ? t("iso.updating") : t("iso.downloading")}</DialogTitle>
            <DialogDescription>
              {finished
                ? job?.kind === "update"
                  ? t("iso.updateDone")
                  : t("iso.downloadDone")
                : errorMsg
                  ? t("iso.downloadFailed")
                  : job?.filename}
            </DialogDescription>
          </DialogHeader>
          {errorMsg ? <p className="text-sm text-danger">{errorMsg}</p> : null}
          <ProxmoxTaskProgress
            lines={logLines}
            running={!finished && !errorMsg}
            fallbackDetail={job?.kind === "update" ? t("iso.updating") : t("iso.downloading")}
          />
          <div className="flex justify-end">
            <Button variant="outline" onClick={clearJob} disabled={locked}>
              {finished || errorMsg ? t("common.close") : t("common.cancel")}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
