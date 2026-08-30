"use client";

import Link from "next/link";
import { useMemo, useState, memo } from "react";
import { Play, Square, RotateCcw, Terminal, Camera } from "lucide-react";
import { toast } from "sonner";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { GuestStateBadge } from "@/components/status-badge";
import { ConfirmAction } from "@/components/confirm-action";
import { GuestCpuBar, GuestDiskBar, GuestRamBar } from "@/components/guests/guest-usage";
import { api } from "@/lib/api";
import { DEFAULT_GUEST_SORT, nextGuestSort, sortGuests, type GuestSortKey } from "@/lib/guest-sort";
import { guestHasTag, parseGuestTags, uniqueGuestTags } from "@/lib/guest-tags";
import { formatUptime } from "@/lib/utils";
import type { Guest } from "@/lib/types";
import { useI18n } from "@/components/i18n/locale-provider";
import { useCan } from "@/components/auth/session-user";

export const GuestTable = memo(function GuestTable({
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
      snapshot: useCan("vm.snapshot.create"),
      delete: useCan("vm.delete"),
    },
    lxc: {
      start: useCan("lxc.start"),
      shutdown: useCan("lxc.shutdown"),
      reboot: useCan("lxc.reboot"),
      console: useCan("lxc.console"),
      snapshot: useCan("lxc.snapshot.create"),
      delete: useCan("lxc.delete"),
    },
  };
  const qc = useQueryClient();
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("all");
  const [tag, setTag] = useState("all");
  const [sort, setSort] = useState(DEFAULT_GUEST_SORT);
  const tags = useMemo(() => uniqueGuestTags(items), [items]);
  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const matched = items.filter((g) => {
      const hay = `${g.name} ${g.vmid} ${g.hostName ?? ""} ${g.node} ${g.tags ?? ""} ${g.description ?? ""}`.toLowerCase();
      const textOk = !needle || hay.includes(needle);
      const statusOk = status === "all" || g.status === status;
      const tagOk = tag === "all" || guestHasTag(g.tags, tag);
      return textOk && statusOk && tagOk;
    });
    return sortGuests(matched, sort);
  }, [items, q, status, tag, sort]);

  function rowKind(g: Guest): "vm" | "lxc" {
    if (g.kind === "vm" || g.kind === "lxc") return g.kind;
    return kind === "lxc" ? "lxc" : "vm";
  }

  async function guestAction(hid: string, node: string, vmid: number, action: string, row: "vm" | "lxc", extra: Record<string, unknown> = {}) {
    const permPath = row === "vm" ? "vms" : "lxc";
    try {
      await api(`/api/hosts/${hid}/${permPath}/${node}/${vmid}`, {
        method: "POST",
        body: JSON.stringify({ action, confirm: action === "delete", ...extra }),
      });
      toast.success(action === "snapshot" ? t("guest.snapshotCreated") : t("common.taskDone"));
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
        {tags.length > 0 ? (
          <select
            className="h-9 rounded-[4px] border border-input bg-white/[0.03] px-2 text-sm"
            value={tag}
            onChange={(e) => setTag(e.target.value)}
          >
            <option value="all">{t("table.allTags")}</option>
            {tags.map((item) => (
              <option key={item} value={item}>
                {item}
              </option>
            ))}
          </select>
        ) : null}
      </div>
      <div className="overflow-x-auto rounded-[4px] border border-border">
        <table className={`w-full text-left text-sm ${mixed ? "min-w-[960px]" : "min-w-[720px]"}`}>
          <thead className="font-[family-name:var(--font-display)] text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
            <tr>
              <SortHeader label={t("table.id")} column="vmid" sort={sort} onSort={setSort} />
              {mixed ? <SortHeader label={t("table.type")} column="kind" sort={sort} onSort={setSort} /> : null}
              <SortHeader label={t("table.name")} column="name" sort={sort} onSort={setSort} />
              <SortHeader label={t("table.hostNode")} column="host" sort={sort} onSort={setSort} />
              <SortHeader label={t("table.status")} column="status" sort={sort} onSort={setSort} />
              <SortHeader label={t("table.cpu")} column="cpu" sort={sort} onSort={setSort} />
              <SortHeader label={t("table.ram")} column="ram" sort={sort} onSort={setSort} />
              <SortHeader label={t("table.disk")} column="disk" sort={sort} onSort={setSort} />
              <SortHeader label={t("table.uptime")} column="uptime" sort={sort} onSort={setSort} />
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
                const rowTags = parseGuestTags(g.tags);
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
                      {g.description ? (
                        <p className="mt-0.5 max-w-xs truncate text-xs text-muted-foreground" title={g.description}>
                          {g.description}
                        </p>
                      ) : null}
                      {rowTags.length > 0 ? (
                        <div className="mt-1 flex flex-wrap gap-1">
                          {rowTags.map((item) => (
                            <button
                              key={item}
                              type="button"
                              className="rounded-full bg-muted px-2 py-0.5 text-[10px] uppercase tracking-wide text-muted-foreground hover:text-foreground"
                              onClick={() => setTag(item)}
                            >
                              {item}
                            </button>
                          ))}
                        </div>
                      ) : null}
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
                        {perms.snapshot ? (
                          <Button
                            size="icon"
                            variant="ghost"
                            title={t("guest.createSnapshot")}
                            aria-label={t("guest.createSnapshot")}
                            onClick={() =>
                              void guestAction(hid, g.node, g.vmid, "snapshot", row, { snapname: `snap-${Date.now()}` })
                            }
                          >
                            <Camera className="h-4 w-4" />
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
});

function SortHeader({
  label,
  column,
  sort,
  onSort,
}: {
  label: string;
  column: GuestSortKey;
  sort: { key: GuestSortKey; dir: "asc" | "desc" };
  onSort: (next: { key: GuestSortKey; dir: "asc" | "desc" }) => void;
}) {
  const active = sort.key === column;
  return (
    <th className="px-3 py-2 font-medium">
      <button
        type="button"
        className={`uppercase tracking-[0.16em] ${active ? "text-foreground" : "hover:text-foreground"}`}
        aria-sort={active ? (sort.dir === "asc" ? "ascending" : "descending") : "none"}
        onClick={() => onSort(nextGuestSort(sort, column))}
      >
        {label}
        {active ? (sort.dir === "asc" ? " ↑" : " ↓") : ""}
      </button>
    </th>
  );
}
