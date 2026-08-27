"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { Play, Square, RotateCcw, Terminal } from "lucide-react";
import { toast } from "sonner";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { GuestStateBadge } from "@/components/status-badge";
import { ConfirmAction } from "@/components/confirm-action";
import { GuestCpuBar, GuestDiskBar, GuestRamBar } from "@/components/guests/guest-usage";
import { api } from "@/lib/api";
import { formatUptime } from "@/lib/utils";
import type { Guest } from "@/lib/types";
import { useI18n } from "@/components/i18n/locale-provider";
import { useCan } from "@/components/auth/session-user";

export function GuestTable({
  kind,
  items,
  hostId,
}: {
  kind: "vm" | "lxc" | "all";
  items: Guest[];
  hostId?: string;
}) {
  const { t } = useI18n();
  const mixed = kind === "all";
  const can = {
    vm: {
      start: useCan("vm.start"),
      shutdown: useCan("vm.shutdown"),
      reboot: useCan("vm.reboot"),
      console: useCan("vm.console"),
      delete: useCan("vm.delete"),
    },
    lxc: {
      start: useCan("lxc.start"),
      shutdown: useCan("lxc.shutdown"),
      reboot: useCan("lxc.reboot"),
      console: useCan("lxc.console"),
      delete: useCan("lxc.delete"),
    },
  };
  const qc = useQueryClient();
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("all");
  const filtered = useMemo(
    () =>
      items.filter((g) => {
        const match = g.name.toLowerCase().includes(q.toLowerCase()) || String(g.vmid).includes(q);
        return match && (status === "all" || g.status === status);
      }),
    [items, q, status],
  );

  function rowKind(g: Guest): "vm" | "lxc" {
    if (g.kind === "vm" || g.kind === "lxc") return g.kind;
    return kind === "lxc" ? "lxc" : "vm";
  }

  async function guestAction(hid: string, node: string, vmid: number, action: string, row: "vm" | "lxc") {
    const permPath = row === "vm" ? "vms" : "lxc";
    try {
      await api(`/api/hosts/${hid}/${permPath}/${node}/${vmid}`, {
        method: "POST",
        body: JSON.stringify({ action, confirm: action === "delete" }),
      });
      toast.success(t("common.taskDone"));
      await Promise.all([
        qc.invalidateQueries({ queryKey: ["all-vms"] }),
        qc.invalidateQueries({ queryKey: ["all-lxc"] }),
        qc.invalidateQueries({ queryKey: ["dashboard"] }),
      ]);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("common.failed"));
      throw err;
    }
  }

  const colCount = mixed ? 10 : 9;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        <Input placeholder={t("table.search")} value={q} onChange={(e) => setQ(e.target.value)} className="max-w-xs" />
        <select
          className="h-9 rounded-[4px] border border-input bg-white/[0.03] px-2 text-sm"
          value={status}
          onChange={(e) => setStatus(e.target.value)}
        >
          <option value="all">{t("table.allStatuses")}</option>
          <option value="running">{t("guest.status.running")}</option>
          <option value="stopped">{t("guest.status.stopped")}</option>
          <option value="paused">{t("guest.status.paused")}</option>
        </select>
      </div>
      <div className="overflow-x-auto rounded-[4px] border border-border">
        <table className={`w-full text-left text-sm ${mixed ? "min-w-[960px]" : "min-w-[720px]"}`}>
          <thead className="font-[family-name:var(--font-display)] text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
            <tr>
              <th className="px-3 py-2 font-medium">{t("table.id")}</th>
              {mixed ? <th className="px-3 py-2 font-medium">{t("table.type")}</th> : null}
              <th className="px-3 py-2 font-medium">{t("table.name")}</th>
              <th className="px-3 py-2 font-medium">{t("table.hostNode")}</th>
              <th className="px-3 py-2 font-medium">{t("table.status")}</th>
              <th className="px-3 py-2 font-medium">{t("table.cpu")}</th>
              <th className="px-3 py-2 font-medium">{t("table.ram")}</th>
              <th className="px-3 py-2 font-medium">{t("table.disk")}</th>
              <th className="px-3 py-2 font-medium">{t("table.uptime")}</th>
              <th className="px-3 py-2 font-medium">{t("table.actions")}</th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr>
                <td colSpan={colCount} className="px-3 py-6 text-sm text-muted-foreground">
                  {items.length === 0 ? t("dashboard.noGuests") : t("table.noMatches")}
                </td>
              </tr>
            ) : (
              filtered.map((g) => {
                const hid = g.hostId ?? hostId ?? "";
                const row = rowKind(g);
                const perms = can[row];
                const kindLabel = row === "vm" ? "VM" : "LXC";
                const detailBase = row === "vm" ? "vms" : "containers";
                return (
                  <tr key={`${row}-${hid}-${g.node}-${g.vmid}`} className="border-t border-border">
                    <td className="px-3 py-2 font-mono">{g.vmid}</td>
                    {mixed ? (
                      <td className="px-3 py-2">
                        <Badge variant={row === "vm" ? "default" : "muted"}>{kindLabel}</Badge>
                      </td>
                    ) : null}
                    <td className="px-3 py-2">
                      <Link className="hover:underline" href={`/${detailBase}/${hid}/${g.node}/${g.vmid}`}>
                        {g.name}
                        {g.template ? <span className="text-xs text-muted-foreground"> {t("dashboard.template")}</span> : null}
                      </Link>
                    </td>
                    <td className="px-3 py-2 text-muted-foreground">
                      {g.hostName ?? hid} / {g.node}
                    </td>
                    <td className="px-3 py-2">
                      <GuestStateBadge status={g.status} />
                    </td>
                    <td className="px-3 py-2">
                      <GuestCpuBar guest={g} />
                    </td>
                    <td className="px-3 py-2">
                      <GuestRamBar guest={g} />
                    </td>
                    <td className="px-3 py-2">
                      <GuestDiskBar guest={g} />
                    </td>
                    <td className="px-3 py-2">{formatUptime(g.uptime)}</td>
                    <td className="px-3 py-2">
                      <div className="flex gap-1">
                        {perms.start ? (
                          <Button size="icon" variant="ghost" title={t("guest.start")} onClick={() => void guestAction(hid, g.node, g.vmid, "start", row)}>
                            <Play className="h-4 w-4" />
                          </Button>
                        ) : null}
                        {perms.shutdown ? (
                          <Button size="icon" variant="ghost" title={t("guest.shutdown")} onClick={() => void guestAction(hid, g.node, g.vmid, "shutdown", row)}>
                            <Square className="h-4 w-4" />
                          </Button>
                        ) : null}
                        {perms.reboot ? (
                          <Button size="icon" variant="ghost" title={t("guest.reboot")} onClick={() => void guestAction(hid, g.node, g.vmid, "reboot", row)}>
                            <RotateCcw className="h-4 w-4" />
                          </Button>
                        ) : null}
                        {perms.console ? (
                          <Button size="icon" variant="ghost" asChild title={t("guest.console")}>
                            <Link href={`/${detailBase}/${hid}/${g.node}/${g.vmid}?console=1`}>
                              <Terminal className="h-4 w-4" />
                            </Link>
                          </Button>
                        ) : null}
                        {perms.delete ? (
                          <ConfirmAction
                            title={t("guest.deleteTitle", { kind: kindLabel, id: g.vmid })}
                            description={t("guest.deleteBody", { id: g.vmid, name: g.name })}
                            actionLabel={t("guest.delete")}
                            destructive
                            onConfirm={() => guestAction(hid, g.node, g.vmid, "delete", row)}
                          >
                            <Button size="sm" variant="destructive">
                              {t("guest.delete")}
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
    </div>
  );
}
