"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ConfirmAction } from "@/components/confirm-action";
import { ProxmoxTaskProgress } from "@/components/backups/task-progress";
import { PageHeader } from "@/components/layout/page-header";
import { api } from "@/lib/api";
import type { PublicHost } from "@/lib/types";
import { useI18n } from "@/components/i18n/locale-provider";
import { useCan } from "@/components/auth/session-user";
import {
  filterTasks,
  taskGuestHref,
  taskGuestLabel,
  taskRunState,
  taskTypeLabel,
  type TaskKindGroup,
  type TaskStatusFilter,
} from "@/lib/proxmox-tasks";

const selectClass = "h-9 rounded-[4px] border border-input bg-white/[0.03] px-2 text-sm";

type Task = {
  upid: string;
  type: string;
  status?: string;
  exitstatus?: string;
  starttime: number;
  endtime?: number;
  node: string;
  user: string;
  id?: string;
  guestName?: string;
  guestKind?: "vm" | "lxc";
};

type Row = Task & { hostId: string; hostName: string };

export default function TasksPage() {
  const { t, locale } = useI18n();
  const canCancel = useCan("tasks.cancel");
  const qc = useQueryClient();
  const { data: hosts } = useQuery({
    queryKey: ["hosts"],
    queryFn: () => api<{ hosts: PublicHost[] }>("/api/hosts"),
  });
  const { data } = useQuery({
    queryKey: ["tasks", hosts?.hosts.map((h) => h.id)],
    enabled: Boolean(hosts),
    queryFn: async () => {
      const rows = await Promise.all(
        (hosts?.hosts ?? []).map(async (h) => {
          try {
            const r = await api<{ tasks: Task[] }>(`/api/hosts/${h.id}/tasks`);
            return r.tasks.map((row) => ({ ...row, hostId: h.id, hostName: h.name }));
          } catch {
            return [];
          }
        }),
      );
      return rows.flat().sort((a, b) => b.starttime - a.starttime);
    },
    refetchInterval: 10_000,
  });

  const [hostId, setHostId] = useState("all");
  const [kind, setKind] = useState<TaskKindGroup | "all">("all");
  const [status, setStatus] = useState<TaskStatusFilter>("all");
  const [type, setType] = useState("all");
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState<Row | null>(null);

  const filtered = useMemo(
    () =>
      filterTasks(data ?? [], {
        hostId: hostId === "all" ? undefined : hostId,
        kind,
        status,
        type,
        query,
      }),
    [data, hostId, kind, status, type, query],
  );
  const types = useMemo(
    () => [...new Set((data ?? []).map((row) => row.type).filter(Boolean))].sort(),
    [data],
  );

  const { data: detail } = useQuery({
    queryKey: ["task", open?.hostId, open?.node, open?.upid],
    enabled: Boolean(open),
    queryFn: () =>
      api<{ status: Task; log: Array<{ n: number; t: string }> }>(
        `/api/hosts/${open!.hostId}/tasks/${open!.node}/${encodeURIComponent(open!.upid)}`,
      ),
    refetchInterval: open && taskRunState(open) === "running" ? 1_500 : false,
  });

  const live = detail?.status ?? open;
  const running = live ? taskRunState(live) === "running" : false;
  const logLines = (detail?.log ?? []).map((line) => line.t);
  const openLabel = open ? taskTypeLabel(open.type, locale) : "";
  const openGuest = open ? taskGuestLabel(open) : "";

  async function cancel(row: Row) {
    await api(`/api/hosts/${row.hostId}/tasks`, {
      method: "POST",
      body: JSON.stringify({ action: "stop", node: row.node, upid: row.upid }),
    });
    toast.success(t("tasks.cancelled"));
    void qc.invalidateQueries({ queryKey: ["tasks"] });
    void qc.invalidateQueries({ queryKey: ["task", row.hostId, row.node, row.upid] });
  }

  function statusBadge(task: Task) {
    const state = taskRunState(task);
    if (state === "running") return <Badge variant="warning">{t("tasks.statusRunning")}</Badge>;
    if (state === "ok") return <Badge variant="success">{t("tasks.statusOk")}</Badge>;
    return <Badge variant="danger">{t("tasks.statusFailed")}</Badge>;
  }

  return (
    <div className="space-y-4">
      <PageHeader kicker={t("page.ops")} title={t("tasks.title")} description={t("tasks.description")} />
      <Card>
        <CardHeader>
          <CardTitle>{t("tasks.title")}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex flex-wrap gap-2">
            <Input
              className="max-w-xs"
              placeholder={t("tasks.search")}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
            <select className={selectClass} value={hostId} onChange={(e) => setHostId(e.target.value)}>
              <option value="all">{t("tasks.filterHost")}</option>
              {(hosts?.hosts ?? []).map((h) => (
                <option key={h.id} value={h.id}>
                  {h.name}
                </option>
              ))}
            </select>
            <select className={selectClass} value={kind} onChange={(e) => setKind(e.target.value as TaskKindGroup | "all")}>
              <option value="all">{t("tasks.filterKind")}</option>
              <option value="vm">{t("tasks.kindVm")}</option>
              <option value="lxc">{t("tasks.kindLxc")}</option>
              <option value="backup">{t("tasks.kindBackup")}</option>
              <option value="storage">{t("tasks.kindStorage")}</option>
              <option value="system">{t("tasks.kindSystem")}</option>
              <option value="other">{t("tasks.kindOther")}</option>
            </select>
            <select className={selectClass} value={status} onChange={(e) => setStatus(e.target.value as TaskStatusFilter)}>
              <option value="all">{t("table.allStatuses")}</option>
              <option value="running">{t("tasks.statusRunning")}</option>
              <option value="ok">{t("tasks.statusOk")}</option>
              <option value="failed">{t("tasks.statusFailed")}</option>
            </select>
            <select className={selectClass} value={type} onChange={(e) => setType(e.target.value)}>
              <option value="all">{t("table.type")}</option>
              {types.map((item) => (
                <option key={item} value={item}>
                  {taskTypeLabel(item, locale)}
                </option>
              ))}
            </select>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="font-[family-name:var(--font-display)] text-left text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
                <tr>
                  <th className="py-2 font-medium">{t("table.host")}</th>
                  <th className="font-medium">{t("table.type")}</th>
                  <th className="font-medium">{t("tasks.guest")}</th>
                  <th className="font-medium">{t("table.status")}</th>
                  <th className="font-medium">{t("tasks.start")}</th>
                  <th className="font-medium">{t("table.actions")}</th>
                </tr>
              </thead>
              <tbody>
                {filtered.length === 0 ? (
                  <tr>
                    <td className="py-6 text-muted-foreground" colSpan={6}>
                      {t("tasks.empty")}
                    </td>
                  </tr>
                ) : (
                  filtered.map((row) => (
                    <tr key={row.upid} className="border-t border-border">
                      <td className="py-2">{row.hostName}</td>
                      <td>
                        <div>{taskTypeLabel(row.type, locale)}</div>
                        <p className="text-[11px] text-muted-foreground">{row.type}</p>
                      </td>
                      <td>
                        {(() => {
                          const href = taskGuestHref(row);
                          const label = taskGuestLabel(row);
                          if (!label) return "—";
                          if (!href) return label;
                          return (
                            <Link className="hover:underline" href={href}>
                              {label}
                            </Link>
                          );
                        })()}
                        {row.guestKind ? (
                          <span className="ml-1 text-[11px] uppercase text-muted-foreground">{row.guestKind}</span>
                        ) : null}
                      </td>
                      <td>{statusBadge(row)}</td>
                      <td>{new Date(row.starttime * 1000).toLocaleString(locale === "en" ? "en-GB" : "de-DE")}</td>
                      <td>
                        <div className="flex flex-wrap gap-1">
                          <Button size="sm" variant="outline" onClick={() => setOpen(row)}>
                            {t("tasks.log")}
                          </Button>
                          {canCancel && taskRunState(row) === "running" ? (
                            <ConfirmAction
                              title={t("tasks.cancelTitle")}
                              description={t("tasks.cancelBody", {
                                label: taskTypeLabel(row.type, locale),
                                guest: taskGuestLabel(row) || row.node,
                              })}
                              actionLabel={t("tasks.cancel")}
                              destructive
                              onConfirm={() => cancel(row)}
                            >
                              <Button size="sm" variant="destructive">
                                {t("tasks.cancel")}
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
        </CardContent>
      </Card>
      {open ? (
        <Card>
          <CardHeader className="flex flex-row items-center justify-between gap-3">
            <CardTitle>
              {openLabel}
              {openGuest ? ` — ${openGuest}` : ""}
            </CardTitle>
            <div className="flex items-center gap-2">
              {live ? statusBadge(live) : null}
              {canCancel && running ? (
                <ConfirmAction
                  title={t("tasks.cancelTitle")}
                  description={t("tasks.cancelBody", { label: openLabel, guest: openGuest || open.node })}
                  actionLabel={t("tasks.cancel")}
                  destructive
                  onConfirm={() => cancel(open)}
                >
                  <Button size="sm" variant="destructive">
                    {t("tasks.cancel")}
                  </Button>
                </ConfirmAction>
              ) : null}
              <Button size="sm" variant="outline" onClick={() => setOpen(null)}>
                {t("common.close")}
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            <ProxmoxTaskProgress
              lines={logLines}
              running={running}
              fallbackDetail={openLabel}
            />
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
