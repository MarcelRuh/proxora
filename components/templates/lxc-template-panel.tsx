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
import { groupTemplatePackages, vztmplVolid, type CatalogTemplate, type TemplatePackageRow } from "@/lib/lxc-templates";

const selectClass =
  "h-9 rounded-[4px] border border-input bg-white/[0.03] px-2 text-sm";

type CatalogPayload = {
  nodes: string[];
  node: string;
  storages: string[];
  installed: string[];
  catalog: CatalogTemplate[];
};

type TaskPayload = {
  status: { status?: string; exitstatus?: string };
  log: Array<{ n: number; t: string }>;
};

type Job = {
  upid: string;
  node: string;
  template: string;
  kind: "download" | "update";
  replaceVolids: string[];
};

export function LxcTemplatePanel({ hostId }: { hostId: string }) {
  const { t } = useI18n();
  const [node, setNode] = useState("");
  const [storage, setStorage] = useState("");
  const [query, setQuery] = useState("");
  const [section, setSection] = useState("all");
  const [state, setState] = useState("all");
  const [busy, setBusy] = useState(false);
  const [job, setJob] = useState<Job | null>(null);
  const [finished, setFinished] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const settledRef = useRef(false);

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ["lxc-templates", hostId, node],
    enabled: Boolean(hostId),
    queryFn: () => {
      const q = node ? `?node=${encodeURIComponent(node)}` : "";
      return api<CatalogPayload>(`/api/hosts/${hostId}/templates${q}`);
    },
  });

  useEffect(() => {
    if (!data) return;
    setNode((current) => current || data.node || data.nodes[0] || "");
    setStorage((current) =>
      current && data.storages.includes(current) ? current : (data.storages[0] ?? ""),
    );
  }, [data]);

  const packages = useMemo(() => groupTemplatePackages(data?.catalog ?? []), [data?.catalog]);

  function volidsFor(row: TemplatePackageRow): string[] {
    if (row.installedVolids.length) return row.installedVolids;
    if (row.installedTemplate && storage) return [vztmplVolid(storage, row.installedTemplate)];
    return [];
  }
  const sections = useMemo(
    () => [...new Set(packages.map((row) => row.section).filter(Boolean))].sort(),
    [packages],
  );
  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return packages.filter((row) => {
      const hay = `${row.headline} ${row.package} ${row.latestTemplate} ${row.installedTemplate} ${row.section} ${row.latestVersion} ${row.installedVersion}`.toLowerCase();
      const textOk = !needle || hay.includes(needle);
      const sectionOk = section === "all" || row.section === section;
      const stateOk =
        state === "all" ||
        (state === "installed" && Boolean(row.installedVersion)) ||
        (state === "available" && !row.installedVersion) ||
        (state === "updates" && row.updateAvailable);
      return textOk && sectionOk && stateOk;
    });
  }, [packages, query, section, state]);

  const tracking = Boolean(job?.upid) && !finished && !errorMsg;
  const pollNode = job?.node || node;
  const { data: task } = useQuery({
    queryKey: ["lxc-template-task", hostId, pollNode, job?.upid],
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
      const message = st.exitstatus || t("tmpl.downloadFailed");
      setErrorMsg(message);
      setBusy(false);
      toast.error(message);
      return;
    }
    void (async () => {
      const oldFiles = job.replaceVolids.filter((volid) => !volid.endsWith(`/${job.template}`) && !volid.endsWith(job.template));
      for (const volid of oldFiles) {
        try {
          await api(`/api/hosts/${hostId}/templates`, {
            method: "POST",
            body: JSON.stringify({ action: "delete", node: job.node, volid }),
          });
        } catch {
          /* keep the new file even if old cleanup fails */
        }
      }
      setFinished(true);
      setBusy(false);
      toast.success(job.kind === "update" ? t("tmpl.updateDone") : t("tmpl.downloadDone"));
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

  async function startDownload(row: TemplatePackageRow, kind: "download" | "update") {
    if (!node || !storage || !row.latestTemplate) return;
    setBusy(true);
    setJob(null);
    setFinished(false);
    setErrorMsg(null);
    settledRef.current = false;
    try {
      const res = await api<{ upid?: string; node?: string }>(`/api/hosts/${hostId}/templates`, {
        method: "POST",
        body: JSON.stringify({ node, storage, template: row.latestTemplate }),
      });
      if (!res.upid) throw new Error(t("common.failed"));
      setJob({
        upid: res.upid,
        node: res.node || node,
        template: row.latestTemplate,
        kind,
        replaceVolids: kind === "update" ? volidsFor(row) : [],
      });
    } catch (e) {
      setBusy(false);
      toast.error(e instanceof Error ? e.message : t("common.failed"));
    }
  }

  async function deleteInstalled(row: TemplatePackageRow) {
    const volids = volidsFor(row);
    if (!node || !volids.length) throw new Error(t("common.failed"));
    setBusy(true);
    try {
      for (const volid of volids) {
        await api(`/api/hosts/${hostId}/templates`, {
          method: "POST",
          body: JSON.stringify({ action: "delete", node, volid }),
        });
      }
      toast.success(t("tmpl.deleted"));
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
          placeholder={t("tmpl.search")}
          disabled={isLoading}
        />
        <select className={selectClass} value={state} onChange={(e) => setState(e.target.value)}>
          <option value="all">{t("tmpl.allStates")}</option>
          <option value="updates">{t("tmpl.updates")}</option>
          <option value="installed">{t("tmpl.installed")}</option>
          <option value="available">{t("tmpl.available")}</option>
        </select>
        {sections.length > 0 ? (
          <select className={selectClass} value={section} onChange={(e) => setSection(e.target.value)}>
            <option value="all">{t("tmpl.allSections")}</option>
            {sections.map((item) => (
              <option key={item} value={item}>
                {item}
              </option>
            ))}
          </select>
        ) : null}
        <Button variant="outline" onClick={() => void refetch()} disabled={isLoading || busy}>
          {t("common.refresh")}
        </Button>
      </div>

      {error ? (
        <p className="text-sm text-destructive">{error instanceof Error ? error.message : t("common.failed")}</p>
      ) : isLoading ? (
        <p className="text-sm text-muted-foreground">{t("common.loading")}</p>
      ) : !data?.storages.length && !packages.length ? (
        <p className="text-sm text-muted-foreground">{t("tmpl.noStorage")}</p>
      ) : !packages.length ? (
        <p className="text-sm text-muted-foreground">{t("tmpl.emptyCatalog")}</p>
      ) : (
        <div className="max-h-[min(60vh,36rem)] overflow-auto rounded-[4px] border border-border">
          <table className="w-full min-w-[860px] text-left text-sm">
            <thead className="sticky top-0 z-10 bg-card font-[family-name:var(--font-display)] text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
              <tr>
                <th className="px-3 py-2 font-medium">{t("table.name")}</th>
                <th className="px-3 py-2 font-medium">{t("tmpl.section")}</th>
                <th className="px-3 py-2 font-medium">{t("tmpl.installedVersion")}</th>
                <th className="px-3 py-2 font-medium">{t("tmpl.latestVersion")}</th>
                <th className="px-3 py-2 font-medium">{t("table.status")}</th>
                <th className="px-3 py-2 font-medium">{t("table.actions")}</th>
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-3 py-6 text-sm text-muted-foreground">
                    {t("tmpl.noMatch")}
                  </td>
                </tr>
              ) : (
                filtered.map((row) => (
                  <tr key={row.key} className="border-t border-border">
                    <td className="px-3 py-2">
                      <div className="font-medium">{row.headline}</div>
                      <div className="text-xs text-muted-foreground">{row.latestTemplate || row.installedTemplate}</div>
                    </td>
                    <td className="px-3 py-2 text-muted-foreground">{row.section}</td>
                    <td className="px-3 py-2 tabular-nums text-muted-foreground">{row.installedVersion || "—"}</td>
                    <td className="px-3 py-2 tabular-nums text-muted-foreground">{row.latestVersion || "—"}</td>
                    <td className="px-3 py-2">
                      {row.updateAvailable ? (
                        <Badge variant="warning">{t("tmpl.updateAvailable")}</Badge>
                      ) : row.installedVersion ? (
                        <Badge variant="success">{t("tmpl.installed")}</Badge>
                      ) : (
                        <span className="text-muted-foreground">{t("tmpl.available")}</span>
                      )}
                    </td>
                    <td className="px-3 py-2">
                      <div className="flex flex-wrap gap-1">
                        {row.updateAvailable ? (
                          <Button
                            size="sm"
                            disabled={!storage || busy || Boolean(job)}
                            onClick={() => void startDownload(row, "update")}
                          >
                            {t("tmpl.update")}
                          </Button>
                        ) : !row.installedVersion ? (
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={!storage || busy || Boolean(job)}
                            onClick={() => void startDownload(row, "download")}
                          >
                            {t("tmpl.downloadAction")}
                          </Button>
                        ) : null}
                        {row.installedVersion ? (
                          <ConfirmAction
                            title={t("tmpl.deleteTitle")}
                            description={t("tmpl.deleteBody", { name: row.installedTemplate || row.headline })}
                            actionLabel={t("tmpl.delete")}
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
                ))
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
            <DialogTitle>
              {job?.kind === "update" ? t("tmpl.updating") : t("tmpl.downloading")}
            </DialogTitle>
            <DialogDescription>
              {finished
                ? job?.kind === "update"
                  ? t("tmpl.updateDone")
                  : t("tmpl.downloadDone")
                : errorMsg
                  ? t("tmpl.downloadFailed")
                  : job?.template}
            </DialogDescription>
          </DialogHeader>
          {errorMsg ? <p className="text-sm text-danger">{errorMsg}</p> : null}
          <ProxmoxTaskProgress
            lines={logLines}
            running={!finished && !errorMsg}
            fallbackDetail={job?.kind === "update" ? t("tmpl.updating") : t("tmpl.downloading")}
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
