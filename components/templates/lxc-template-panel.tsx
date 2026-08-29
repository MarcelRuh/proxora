"use client";

import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { ProxmoxTaskProgress } from "@/components/backups/task-progress";
import { api } from "@/lib/api";
import { isFailedTaskExit } from "@/lib/backup-tasks";
import { useI18n } from "@/components/i18n/locale-provider";
import type { CatalogTemplate } from "@/lib/lxc-templates";

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

export function LxcTemplatePanel({ hostId }: { hostId: string }) {
  const { t } = useI18n();
  const [node, setNode] = useState("");
  const [storage, setStorage] = useState("");
  const [query, setQuery] = useState("");
  const [section, setSection] = useState("all");
  const [state, setState] = useState("all");
  const [busy, setBusy] = useState(false);
  const [upid, setUpid] = useState<string | null>(null);
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

  const tracking = Boolean(upid) && !finished && !errorMsg;
  const { data: task } = useQuery({
    queryKey: ["lxc-template-task", hostId, node, upid],
    enabled: Boolean(upid && node),
    queryFn: () =>
      api<TaskPayload>(
        `/api/hosts/${hostId}/templates/task?node=${encodeURIComponent(node)}&upid=${encodeURIComponent(upid!)}`,
      ),
    refetchInterval: tracking ? 1200 : false,
  });

  const logLines = (task?.log ?? []).map((l) => l.t).filter(Boolean);
  const showProgress = busy || Boolean(upid);
  const sections = useMemo(
    () => [...new Set((data?.catalog ?? []).map((row) => row.section).filter(Boolean))].sort(),
    [data?.catalog],
  );

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
    void refetch();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [task]);

  useEffect(() => {
    if (!finished) return;
    const timer = window.setTimeout(() => {
      setBusy(false);
      setUpid(null);
      setFinished(false);
      setErrorMsg(null);
      settledRef.current = false;
    }, 800);
    return () => window.clearTimeout(timer);
  }, [finished]);

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return (data?.catalog ?? []).filter((row) => {
      const hay = `${row.headline} ${row.package} ${row.template} ${row.section} ${row.version} ${row.os}`.toLowerCase();
      const textOk = !needle || hay.includes(needle);
      const sectionOk = section === "all" || row.section === section;
      const stateOk = state === "all" || (state === "installed" ? row.installed : !row.installed);
      return textOk && sectionOk && stateOk;
    });
  }, [data?.catalog, query, section, state]);

  async function download(template: string) {
    if (!node || !storage) return;
    setBusy(true);
    setUpid(null);
    setFinished(false);
    setErrorMsg(null);
    settledRef.current = false;
    try {
      const res = await api<{ upid?: string; node?: string }>(`/api/hosts/${hostId}/templates`, {
        method: "POST",
        body: JSON.stringify({ node, storage, template }),
      });
      if (!res.upid) throw new Error(t("common.failed"));
      if (res.node) setNode(res.node);
      setUpid(res.upid);
    } catch (e) {
      setBusy(false);
      toast.error(e instanceof Error ? e.message : t("common.failed"));
    }
  }

  const rows = data?.catalog ?? [];

  return (
    <div className="grid gap-3">
      {showProgress ? (
        <div className="grid gap-3">
          {errorMsg ? <p className="text-sm text-danger">{errorMsg}</p> : null}
          <ProxmoxTaskProgress
            lines={logLines}
            running={!finished && !errorMsg}
            fallbackDetail={t("tmpl.downloading")}
          />
          {errorMsg ? (
            <div>
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  setBusy(false);
                  setUpid(null);
                  setFinished(false);
                  setErrorMsg(null);
                  settledRef.current = false;
                }}
              >
                {t("common.close")}
              </Button>
            </div>
          ) : null}
        </div>
      ) : null}

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
      ) : !data?.storages.length && !rows.length ? (
        <p className="text-sm text-muted-foreground">{t("tmpl.noStorage")}</p>
      ) : !rows.length ? (
        <p className="text-sm text-muted-foreground">{t("tmpl.emptyCatalog")}</p>
      ) : (
        <div className="max-h-[min(60vh,36rem)] overflow-auto rounded-[4px] border border-border">
          <table className="w-full min-w-[720px] text-left text-sm">
            <thead className="sticky top-0 z-10 bg-card font-[family-name:var(--font-display)] text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
              <tr>
                <th className="px-3 py-2 font-medium">{t("table.name")}</th>
                <th className="px-3 py-2 font-medium">{t("tmpl.section")}</th>
                <th className="px-3 py-2 font-medium">{t("tmpl.version")}</th>
                <th className="px-3 py-2 font-medium">{t("table.status")}</th>
                <th className="px-3 py-2 font-medium">{t("table.actions")}</th>
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-3 py-6 text-sm text-muted-foreground">
                    {t("tmpl.noMatch")}
                  </td>
                </tr>
              ) : (
                filtered.map((row) => (
                  <tr key={row.template} className="border-t border-border">
                    <td className="px-3 py-2">
                      <div className="font-medium">{row.headline}</div>
                      <div className="text-xs text-muted-foreground">{row.template}</div>
                    </td>
                    <td className="px-3 py-2 text-muted-foreground">{row.section}</td>
                    <td className="px-3 py-2 tabular-nums text-muted-foreground">{row.version || "—"}</td>
                    <td className="px-3 py-2">
                      {row.installed ? (
                        <Badge variant="success">{t("tmpl.installed")}</Badge>
                      ) : (
                        <span className="text-muted-foreground">{t("tmpl.available")}</span>
                      )}
                    </td>
                    <td className="px-3 py-2">
                      {row.installed ? null : (
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={!storage || busy || Boolean(upid)}
                          onClick={() => void download(row.template)}
                        >
                          {t("tmpl.downloadAction")}
                        </Button>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
