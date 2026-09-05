"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState, memo } from "react";
import { Play, Square, RotateCcw, Terminal, Camera, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/misc";
import { GuestStateBadge } from "@/components/status-badge";
import { ConfirmAction } from "@/components/confirm-action";
import { GuestDeleteDialog } from "@/components/guests/guest-delete-dialog";
import { GuestCpuBar, GuestDiskBar, GuestRamBar } from "@/components/guests/guest-usage";
import { api } from "@/lib/api";
import { DEFAULT_GUEST_SORT, nextGuestSort, sortGuests, type GuestSortKey } from "@/lib/guest-sort";
import { guestHasTag, parseGuestTags, uniqueGuestTags } from "@/lib/guest-tags";
import { bulkActionFits, guestRowKey, type BulkGuestAction } from "@/lib/guest-bulk";
import { uniqueGuestIps } from "@/lib/guest-ip-display";
import { formatUptime } from "@/lib/utils";
import { GUEST_ROW_ESTIMATE_PX, GUEST_TABLE_VIRTUALIZE_AFTER, windowRows } from "@/lib/table-window";
import type { Guest } from "@/lib/types";
import { useI18n } from "@/components/i18n/locale-provider";
import { useSessionUser } from "@/components/auth/session-user";
import { userHasPermission, type Permission } from "@/lib/permissions";
import { invalidateDashboardQueries, applyGuestIpsToCache } from "@/components/dashboard/use-dashboard";

export const GuestTable = memo(function GuestTable({
  kind,
  items,
  hostId,
  loading,
}: {
  kind: "vm" | "lxc" | "all";
  items: Guest[];
  hostId?: string;
  loading?: boolean;
}) {
  const { t } = useI18n();
  const mixed = kind === "all";
  const user = useSessionUser();
  const qc = useQueryClient();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("all");
  const [tag, setTag] = useState("all");
  const [hostFilter, setHostFilter] = useState("all");
  const [sort, setSort] = useState(DEFAULT_GUEST_SORT);
  const tags = useMemo(() => uniqueGuestTags(items), [items]);
  const hosts = useMemo(() => {
    const map = new Map<string, string>();
    for (const g of items) {
      const id = g.hostId ?? hostId ?? "";
      if (!id) continue;
      map.set(id, g.hostName ?? id);
    }
    return [...map.entries()].sort((a, b) => a[1].localeCompare(b[1], "de"));
  }, [items, hostId]);

  function rowKind(g: Guest): "vm" | "lxc" {
    if (g.kind === "vm" || g.kind === "lxc") return g.kind;
    return kind === "lxc" ? "lxc" : "vm";
  }

  function rowKey(g: Guest): string {
    return guestRowKey({ ...g, hostId: g.hostId ?? hostId }, rowKind(g));
  }

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const matched = items.filter((g) => {
      const hay = `${g.name} ${g.vmid} ${g.hostName ?? ""} ${g.node} ${g.tags ?? ""} ${g.description ?? ""} ${(g.ips ?? []).join(" ")}`.toLowerCase();
      const textOk = !needle || hay.includes(needle);
      const statusOk = status === "all" || g.status === status;
      const tagOk = tag === "all" || guestHasTag(g.tags, tag);
      const hostOk = hostFilter === "all" || (g.hostId ?? hostId ?? "") === hostFilter;
      return textOk && statusOk && tagOk && hostOk;
    });
    return sortGuests(matched, sort);
  }, [items, q, status, tag, hostFilter, hostId, sort]);

  const scrollRef = useRef<HTMLDivElement>(null);
  const firstRowRef = useRef<HTMLTableRowElement>(null);
  const askedIpsAt = useRef(new Map<string, number>());
  const [scrollTop, setScrollTop] = useState(0);
  const [viewH, setViewH] = useState(560);
  const [rowH, setRowH] = useState(GUEST_ROW_ESTIMATE_PX);
  const virtualize = filtered.length > GUEST_TABLE_VIRTUALIZE_AFTER;

  useEffect(() => {
    if (!virtualize) return;
    const el = scrollRef.current;
    if (!el) return;
    const onScroll = () => setScrollTop(el.scrollTop);
    const ro = new ResizeObserver(() => setViewH(el.clientHeight));
    el.addEventListener("scroll", onScroll, { passive: true });
    ro.observe(el);
    setViewH(el.clientHeight);
    setScrollTop(el.scrollTop);
    return () => {
      el.removeEventListener("scroll", onScroll);
      ro.disconnect();
    };
  }, [virtualize]);

  const win = virtualize
    ? windowRows(filtered, scrollTop, viewH, rowH)
    : { start: 0, end: filtered.length, padTop: 0, padBottom: 0, slice: filtered };

  useEffect(() => {
    const el = firstRowRef.current;
    if (!el || !virtualize) return;
    const ro = new ResizeObserver(() => {
      const h = el.getBoundingClientRect().height;
      if (h >= 36 && Math.abs(h - rowH) >= 2) setRowH(h);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [virtualize, win.slice[0], rowH]);

  const hydrateKey = win.slice
    .filter((g) => g.status === "running" && !g.template && !(g.ips && g.ips.length) && g.node && g.vmid)
    .map((g) => `${g.hostId ?? hostId}:${g.kind ?? kind}:${g.vmid}`)
    .join(",");

  useEffect(() => {
    const now = Date.now();
    const pending = win.slice.flatMap((g) => {
      if (g.status !== "running" || g.template || (g.ips && g.ips.length) || !g.node || !g.vmid) return [];
      const hid = g.hostId ?? hostId ?? "";
      if (!hid) return [];
      const row = rowKind(g);
      const key = `${hid}:${row}:${g.vmid}`;
      const asked = askedIpsAt.current.get(key) ?? 0;
      if (now - asked < 20_000) return [];
      askedIpsAt.current.set(key, now);
      return [{ hostId: hid, node: g.node, vmid: g.vmid, kind: row }];
    });
    if (!pending.length) return;
    void api<{ ips: Array<{ hostId: string; kind: "vm" | "lxc"; vmid: number; ips: string[] }> }>("/api/dashboard/guest-ips", {
      method: "POST",
      body: JSON.stringify({ guests: pending }),
    })
      .then((res) => {
        for (const row of res.ips ?? []) {
          const key = `${row.hostId}:${row.kind}:${row.vmid}`;
          if (row.ips.length) askedIpsAt.current.set(key, now + 10 * 60_000);
        }
        applyGuestIpsToCache(qc, res.ips ?? []);
      })
      .catch(() => undefined);
  }, [hydrateKey, hostId, qc, win.slice]);

  const visibleKeys = filtered.map((g) => rowKey(g));
  const selectedVisible = visibleKeys.filter((key) => selected.has(key));
  const allVisibleSelected = filtered.length > 0 && selectedVisible.length === filtered.length;
  const someVisibleSelected = selectedVisible.length > 0 && !allVisibleSelected;

  async function guestAction(hid: string, node: string, vmid: number, action: string, row: "vm" | "lxc", extra: Record<string, unknown> = {}) {
    const permPath = row === "vm" ? "vms" : "lxc";
    const id = `${hid}:${vmid}`;
    setBusyId(id);
    try {
      await api(`/api/hosts/${hid}/${permPath}/${node}/${vmid}`, {
        method: "POST",
        body: JSON.stringify({ action, confirm: action === "delete", ...extra }),
      });
      toast.success(
        action === "snapshot"
          ? t("guest.snapshotCreated")
          : action === "delete"
            ? t("guest.deleted", { kind: row === "vm" ? "VM" : "LXC", id: vmid })
            : t("common.taskDone"),
      );
      await invalidateDashboardQueries(qc);
    } catch (err) {
      if (action !== "delete") {
        toast.error(err instanceof Error ? err.message : t("common.failed"));
      }
      throw err;
    } finally {
      setBusyId(null);
    }
  }

  function canBulk(g: Guest, action: BulkGuestAction): boolean {
    const hid = g.hostId ?? hostId ?? "";
    const prefix = rowKind(g) === "vm" ? "vm" : "lxc";
    if (action === "start") return userHasPermission(user, `${prefix}.start` as Permission, hid);
    if (action === "shutdown") return userHasPermission(user, `${prefix}.shutdown` as Permission, hid);
    if (action === "reboot") return userHasPermission(user, `${prefix}.reboot` as Permission, hid);
    if (action === "stop") return userHasPermission(user, `${prefix}.force-stop` as Permission, hid);
    return false;
  }

  async function runBulk(action: BulkGuestAction) {
    const targets = filtered.filter((g) => selected.has(rowKey(g)) && bulkActionFits(g, action) && canBulk(g, action));
    if (!targets.length) {
      toast.error(t("table.bulkNone"));
      return;
    }
    setBusyId("bulk");
    let ok = 0;
    let fail = 0;
    const queue = [...targets];
    async function worker() {
      while (queue.length) {
        const g = queue.shift();
        if (!g) break;
        const hid = g.hostId ?? hostId ?? "";
        const row = rowKind(g);
        const permPath = row === "vm" ? "vms" : "lxc";
        try {
          await api(`/api/hosts/${hid}/${permPath}/${g.node}/${g.vmid}`, {
            method: "POST",
            body: JSON.stringify({ action }),
          });
          ok += 1;
        } catch {
          fail += 1;
        }
      }
    }
    await Promise.all(Array.from({ length: Math.min(4, targets.length) }, () => worker()));
    setBusyId(null);
    setSelected(new Set());
    toast.success(t("table.bulkDone", { ok, fail }));
    await invalidateDashboardQueries(qc);
  }

  const colCount = mixed ? 12 : 11;
  const bulkBusy = busyId === "bulk";

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
        {hosts.length > 1 ? (
          <select
            className="h-9 rounded-[4px] border border-input bg-white/[0.03] px-2 text-sm"
            value={hostFilter}
            onChange={(e) => setHostFilter(e.target.value)}
            aria-label={t("table.host")}
          >
            <option value="all">{t("table.allHosts")}</option>
            {hosts.map(([id, name]) => (
              <option key={id} value={id}>
                {name}
              </option>
            ))}
          </select>
        ) : null}
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
      {selectedVisible.length > 0 ? (
        <div className="flex flex-wrap items-center gap-2 rounded-[4px] border border-border bg-muted/30 px-3 py-2 text-sm">
          <span className="text-muted-foreground">{t("table.selected", { n: selectedVisible.length })}</span>
          <Button size="sm" disabled={bulkBusy} onClick={() => void runBulk("start")}>
            {t("guest.start")}
          </Button>
          <ConfirmAction
            title={t("table.bulkShutdownTitle")}
            description={t("table.bulkShutdownBody", { n: selectedVisible.length })}
            actionLabel={t("guest.shutdown")}
            onConfirm={() => runBulk("shutdown")}
          >
            <Button size="sm" variant="outline" disabled={bulkBusy}>
              {t("guest.shutdown")}
            </Button>
          </ConfirmAction>
          <Button size="sm" variant="outline" disabled={bulkBusy} onClick={() => void runBulk("reboot")}>
            {t("guest.reboot")}
          </Button>
          <ConfirmAction
            title={t("table.bulkStopTitle")}
            description={t("table.bulkStopBody", { n: selectedVisible.length })}
            actionLabel={t("guest.stop")}
            destructive
            onConfirm={() => runBulk("stop")}
          >
            <Button size="sm" variant="destructive" disabled={bulkBusy}>
              {t("guest.stop")}
            </Button>
          </ConfirmAction>
          <Button size="sm" variant="ghost" disabled={bulkBusy} onClick={() => setSelected(new Set())}>
            {t("table.clearSelection")}
          </Button>
        </div>
      ) : null}
      <div
        ref={scrollRef}
        className={
          virtualize
            ? "max-h-[min(70vh,720px)] overflow-auto rounded-[4px] border border-border"
            : "overflow-x-auto rounded-[4px] border border-border"
        }
      >
        <table className={`w-full text-left text-sm ${mixed ? "min-w-[1080px]" : "min-w-[860px]"}`}>
          <thead className="sticky top-0 z-10 bg-background font-[family-name:var(--font-display)] text-[10px] uppercase tracking-[0.16em] text-muted-foreground shadow-[inset_0_-1px_0_0_hsl(var(--border))]">
            <tr>
              <th className="w-10 px-3 py-2">
                <input
                  type="checkbox"
                  className="h-4 w-4 accent-primary"
                  checked={allVisibleSelected}
                  ref={(el) => {
                    if (el) el.indeterminate = someVisibleSelected;
                  }}
                  onChange={() => {
                    setSelected((prev) => {
                      const next = new Set(prev);
                      if (allVisibleSelected) {
                        visibleKeys.forEach((key) => next.delete(key));
                      } else {
                        visibleKeys.forEach((key) => next.add(key));
                      }
                      return next;
                    });
                  }}
                  aria-label={t("table.selectAll")}
                />
              </th>
              <SortHeader label={t("table.id")} column="vmid" sort={sort} onSort={setSort} />
              {mixed ? <SortHeader label={t("table.type")} column="kind" sort={sort} onSort={setSort} /> : null}
              <SortHeader label={t("table.name")} column="name" sort={sort} onSort={setSort} />
              <th className="px-3 py-2 font-medium">{t("table.ip")}</th>
              <SortHeader label={t("table.host")} column="host" sort={sort} onSort={setSort} />
              <SortHeader label={t("table.status")} column="status" sort={sort} onSort={setSort} />
              <SortHeader label={t("table.cpu")} column="cpu" sort={sort} onSort={setSort} />
              <SortHeader label={t("table.ram")} column="ram" sort={sort} onSort={setSort} />
              <SortHeader label={t("table.disk")} column="disk" sort={sort} onSort={setSort} />
              <SortHeader label={t("table.uptime")} column="uptime" sort={sort} onSort={setSort} />
              <th className="px-3 py-2 font-medium">{t("table.actions")}</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              Array.from({ length: 6 }).map((_, i) => (
                <tr key={i} className="border-t border-border">
                  <td colSpan={colCount} className="px-3 py-3">
                    <Skeleton className="h-6 w-full" />
                  </td>
                </tr>
              ))
            ) : filtered.length === 0 ? (
              <tr>
                <td colSpan={colCount} className="px-3 py-6 text-sm text-muted-foreground">
                  {items.length === 0 ? t("dashboard.noGuests") : t("table.noMatches")}
                </td>
              </tr>
            ) : (
              <>
                {win.padTop > 0 ? (
                  <tr aria-hidden>
                    <td colSpan={colCount} style={{ height: win.padTop, padding: 0, border: 0 }} />
                  </tr>
                ) : null}
                {win.slice.map((g) => {
                const hid = g.hostId ?? hostId ?? "";
                const row = rowKind(g);
                const prefix = row === "vm" ? "vm" : "lxc";
                const perms = {
                  start: userHasPermission(user, `${prefix}.start` as Permission, hid),
                  shutdown: userHasPermission(user, `${prefix}.shutdown` as Permission, hid),
                  reboot: userHasPermission(user, `${prefix}.reboot` as Permission, hid),
                  stop: userHasPermission(user, `${prefix}.force-stop` as Permission, hid),
                  console: userHasPermission(user, `${prefix}.console` as Permission, hid),
                  snapshot: userHasPermission(user, `${prefix}.snapshot.create` as Permission, hid),
                  delete: userHasPermission(user, `${prefix}.delete` as Permission, hid),
                };
                const kindLabel = row === "vm" ? "VM" : "LXC";
                const detailBase = row === "vm" ? "vms" : "containers";
                const rowTags = parseGuestTags(g.tags);
                const running = g.status === "running";
                const stopped = g.status === "stopped";
                const key = rowKey(g);
                const rowBusy = busyId === `${hid}:${g.vmid}` || bulkBusy;
                const ips = uniqueGuestIps(g.ips);
                const ipLabel = ips.join(", ");
                return (
                  <tr key={key} ref={g === win.slice[0] ? firstRowRef : undefined} data-guest-row className="border-t border-border">
                    <td className="px-3 py-2">
                      <input
                        type="checkbox"
                        className="h-4 w-4 accent-primary"
                        checked={selected.has(key)}
                        onChange={() => {
                          setSelected((prev) => {
                            const next = new Set(prev);
                            if (next.has(key)) next.delete(key);
                            else next.add(key);
                            return next;
                          });
                        }}
                        aria-label={`${g.vmid} ${g.name}`}
                      />
                    </td>
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
                    <td className="px-3 py-2 font-mono text-xs leading-tight" title={ipLabel || undefined}>
                      {ips.length ? (
                        ips.map((ip) => (
                          <div key={ip} className="whitespace-nowrap text-foreground">
                            {ip}
                          </div>
                        ))
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </td>
                    <td className="px-3 py-2">
                      <p className="font-medium leading-tight text-foreground">{g.hostName ?? hid}</p>
                      <p className="text-xs leading-tight text-muted-foreground">
                        {t("table.node")}: {g.node}
                        {g.hostOwner ? ` · ${g.hostOwner}` : ""}
                      </p>
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
                          <Button size="icon" variant="ghost" title={t("guest.start")} disabled={!stopped || rowBusy} onClick={() => void guestAction(hid, g.node, g.vmid, "start", row)}>
                            <Play className="h-4 w-4" />
                          </Button>
                        ) : null}
                        {perms.shutdown ? (
                          <Button size="icon" variant="ghost" title={t("guest.shutdown")} disabled={!running || rowBusy} onClick={() => void guestAction(hid, g.node, g.vmid, "shutdown", row)}>
                            <Square className="h-4 w-4" />
                          </Button>
                        ) : null}
                        {perms.reboot ? (
                          <Button size="icon" variant="ghost" title={t("guest.reboot")} disabled={!running || rowBusy} onClick={() => void guestAction(hid, g.node, g.vmid, "reboot", row)}>
                            <RotateCcw className="h-4 w-4" />
                          </Button>
                        ) : null}
                        {perms.snapshot ? (
                          <Button
                            size="icon"
                            variant="ghost"
                            title={t("guest.createSnapshot")}
                            aria-label={t("guest.createSnapshot")}
                            disabled={rowBusy}
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
                          <GuestDeleteDialog
                            hostId={hid}
                            kind={row}
                            vmid={g.vmid}
                            name={g.name}
                            kindLabel={kindLabel}
                            onConfirm={(backupVolids) => guestAction(hid, g.node, g.vmid, "delete", row, { backupVolids })}
                          >
                            <Button
                              size="icon"
                              variant="ghost"
                              disabled={rowBusy}
                              title={t("guest.delete")}
                              aria-label={t("guest.delete")}
                              className="text-destructive hover:bg-destructive/10 hover:text-destructive"
                            >
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </GuestDeleteDialog>
                        ) : null}
                      </div>
                    </td>
                  </tr>
                );
              })}
                {win.padBottom > 0 ? (
                  <tr aria-hidden>
                    <td colSpan={colCount} style={{ height: win.padBottom, padding: 0, border: 0 }} />
                  </tr>
                ) : null}
              </>
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
