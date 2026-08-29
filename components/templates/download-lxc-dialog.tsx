"use client";

import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { ProxmoxTaskProgress } from "@/components/backups/task-progress";
import { api } from "@/lib/api";
import { isFailedTaskExit } from "@/lib/backup-tasks";
import { useI18n } from "@/components/i18n/locale-provider";
import type { AplTemplate } from "@/lib/lxc-templates";

const selectClass =
  "mt-1 h-9 w-full rounded-[4px] border border-input bg-white/[0.03] px-2 text-sm";

type CatalogItem = AplTemplate & { installed: boolean };

type CatalogPayload = {
  nodes: string[];
  node: string;
  storages: string[];
  installed: string[];
  catalog: CatalogItem[];
};

type TaskPayload = {
  status: { status?: string; exitstatus?: string };
  log: Array<{ n: number; t: string }>;
};

export function DownloadLxcTemplateDialog({
  hostId,
  node: preferredNode,
  open,
  onOpenChange,
  onDownloaded,
}: {
  hostId: string;
  node?: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onDownloaded?: (volid: string) => void;
}) {
  const { t } = useI18n();
  const [node, setNode] = useState("");
  const [storage, setStorage] = useState("");
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState(false);
  const [upid, setUpid] = useState<string | null>(null);
  const [volid, setVolid] = useState<string | null>(null);
  const [finished, setFinished] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const settledRef = useRef(false);

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ["lxc-templates", hostId, node || preferredNode],
    enabled: Boolean(open && hostId),
    queryFn: () => {
      const n = node || preferredNode;
      const q = n ? `?node=${encodeURIComponent(n)}` : "";
      return api<CatalogPayload>(`/api/hosts/${hostId}/templates${q}`);
    },
  });

  useEffect(() => {
    if (!open) return;
    setQuery("");
    setNode(preferredNode ?? "");
    setStorage("");
    setBusy(false);
    setUpid(null);
    setVolid(null);
    setFinished(false);
    setErrorMsg(null);
    settledRef.current = false;
  }, [open, hostId]);

  useEffect(() => {
    if (!data) return;
    setNode((current) => current || data.node || preferredNode || data.nodes[0] || "");
    setStorage((current) =>
      current && data.storages.includes(current) ? current : (data.storages[0] ?? ""),
    );
  }, [data, preferredNode]);

  const tracking = Boolean(upid) && !finished && !errorMsg;
  const { data: task } = useQuery({
    queryKey: ["lxc-template-task", hostId, node, upid],
    enabled: Boolean(open && upid && node),
    queryFn: () =>
      api<TaskPayload>(
        `/api/hosts/${hostId}/templates/task?node=${encodeURIComponent(node)}&upid=${encodeURIComponent(upid!)}`,
      ),
    refetchInterval: tracking ? 1200 : false,
  });

  const logLines = (task?.log ?? []).map((l) => l.t).filter(Boolean);
  const showProgress = busy || Boolean(upid);

  useEffect(() => {
    if (!task?.status || finished || errorMsg || settledRef.current) return;
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
    setFinished(true);
    setBusy(false);
    toast.success(t("tmpl.downloadDone"));
    if (volid) onDownloaded?.(volid);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [task]);

  useEffect(() => {
    if (!finished) return;
    const timer = window.setTimeout(() => {
      setBusy(false);
      setUpid(null);
      setVolid(null);
      setFinished(false);
      setErrorMsg(null);
      settledRef.current = false;
      onOpenChange(false);
    }, 800);
    return () => window.clearTimeout(timer);
  }, [finished, onOpenChange]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const rows = data?.catalog ?? [];
    if (!q) return rows;
    return rows.filter((row) =>
      [row.headline, row.package, row.template, row.section, row.version, row.os]
        .join(" ")
        .toLowerCase()
        .includes(q),
    );
  }, [data?.catalog, query]);

  const locked = showProgress && !finished && !errorMsg;

  async function download(template: string) {
    if (!node || !storage) return;
    setBusy(true);
    setUpid(null);
    setFinished(false);
    setErrorMsg(null);
    settledRef.current = false;
    try {
      const res = await api<{ upid?: string; volid?: string; node?: string }>(`/api/hosts/${hostId}/templates`, {
        method: "POST",
        body: JSON.stringify({ node, storage, template }),
      });
      if (!res.upid) throw new Error(t("common.failed"));
      setVolid(res.volid ?? null);
      if (res.node) setNode(res.node);
      setUpid(res.upid);
    } catch (e) {
      setBusy(false);
      toast.error(e instanceof Error ? e.message : t("common.failed"));
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next && locked) return;
        if (!next) {
          setBusy(false);
          setUpid(null);
          setVolid(null);
          setFinished(false);
          setErrorMsg(null);
        }
        onOpenChange(next);
      }}
    >
      <DialogContent className="max-h-[90vh] max-w-3xl overflow-hidden">
        <DialogHeader>
          <DialogTitle>{t("tmpl.downloadTitle")}</DialogTitle>
          <DialogDescription>
            {showProgress
              ? finished
                ? t("tmpl.downloadDone")
                : errorMsg
                  ? t("tmpl.downloadFailed")
                  : t("tmpl.downloading")
              : t("tmpl.downloadHint")}
          </DialogDescription>
        </DialogHeader>

        {showProgress ? (
          <div className="grid gap-3">
            {errorMsg ? <p className="text-sm text-danger">{errorMsg}</p> : null}
            <ProxmoxTaskProgress
              lines={logLines}
              running={!finished && !errorMsg}
              fallbackDetail={t("tmpl.downloading")}
            />
            <div className="flex justify-end">
              <Button variant="outline" onClick={() => onOpenChange(false)} disabled={locked}>
                {finished || errorMsg ? t("common.close") : t("common.cancel")}
              </Button>
            </div>
          </div>
        ) : (
          <div className="grid gap-3">
            <div className={`grid gap-3 ${(data?.nodes.length ?? 0) > 1 ? "md:grid-cols-2" : ""}`}>
              {(data?.nodes.length ?? 0) > 1 ? (
                <label className="text-sm">
                  {t("create.node")}
                  <select className={selectClass} value={node} onChange={(e) => setNode(e.target.value)}>
                    {(data?.nodes ?? []).map((n) => (
                      <option key={n} value={n}>
                        {n}
                      </option>
                    ))}
                  </select>
                </label>
              ) : null}
              <label className="text-sm">
                {t("create.storage")}
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
              </label>
            </div>
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t("tmpl.search")}
              disabled={isLoading}
            />
            {error ? (
              <p className="text-sm text-destructive">{error instanceof Error ? error.message : t("common.failed")}</p>
            ) : isLoading ? (
              <p className="text-sm text-muted-foreground">{t("common.loading")}</p>
            ) : !data?.storages.length ? (
              <p className="text-sm text-muted-foreground">{t("tmpl.noStorage")}</p>
            ) : !(data?.catalog.length ?? 0) ? (
              <p className="text-sm text-muted-foreground">{t("tmpl.emptyCatalog")}</p>
            ) : !filtered.length ? (
              <p className="text-sm text-muted-foreground">{t("tmpl.noMatch")}</p>
            ) : (
              <div className="max-h-[48vh] overflow-auto rounded-[4px] border border-border">
                <table className="w-full text-sm">
                  <thead className="sticky top-0 bg-card font-[family-name:var(--font-display)] text-left text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
                    <tr>
                      <th className="px-3 py-2 font-medium">{t("table.name")}</th>
                      <th className="px-3 py-2 font-medium">{t("tmpl.section")}</th>
                      <th className="px-3 py-2 font-medium">{t("tmpl.version")}</th>
                      <th className="px-3 py-2 font-medium" />
                    </tr>
                  </thead>
                  <tbody>
                    {filtered.map((row) => (
                      <tr key={row.template} className="border-t border-border">
                        <td className="px-3 py-2">
                          <div className="font-medium">{row.headline}</div>
                          <div className="text-xs text-muted-foreground">{row.template}</div>
                        </td>
                        <td className="px-3 py-2 text-muted-foreground">{row.section}</td>
                        <td className="px-3 py-2 tabular-nums text-muted-foreground">{row.version}</td>
                        <td className="px-3 py-2 text-right">
                          {row.installed ? (
                            <Badge variant="success">{t("tmpl.installed")}</Badge>
                          ) : (
                            <Button
                              size="sm"
                              variant="outline"
                              disabled={!storage || busy}
                              onClick={() => void download(row.template)}
                            >
                              {t("tmpl.downloadAction")}
                            </Button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => void refetch()} disabled={isLoading || busy}>
                {t("common.refresh")}
              </Button>
              <Button variant="outline" onClick={() => onOpenChange(false)}>
                {t("common.close")}
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
