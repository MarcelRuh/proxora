"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState, memo } from "react";
import { toast } from "sonner";
import { useQuery, useQueryClient } from "@tanstack/react-query";
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
import {
  GUEST_CARD_ESTIMATE_PX,
  GUEST_ROW_ESTIMATE_PX,
  GUEST_TABLE_VIRTUALIZE_AFTER,
  windowRows,
} from "@/lib/table-window";
import type { Guest, PublicHost } from "@/lib/types";
import { useI18n } from "@/components/i18n/locale-provider";
import { useSessionUser } from "@/components/auth/session-user";
import { userHasAnyPermission, userHasPermission, guestFilePermission, type Permission } from "@/lib/permissions";
import { invalidateDashboardQueries, applyGuestIpsToCache } from "@/components/dashboard/use-dashboard";
import { openGuestToolWindow } from "@/lib/guest-tool-window";
import { peerHostAllowsPermission } from "@/lib/federation-access";
import { actionDeniedTitle } from "@/lib/action-lock";

export const GuestTable = memo(function GuestTable({
  kind,
  items,
  hostId,
  loading,
  compact = false,
}: {
  kind: "vm" | "lxc" | "all";
  items: Guest[];
  hostId?: string;
  loading?: boolean;
  compact?: boolean;
}) {
  const { t } = useI18n();
  const mixed = kind === "all";
  const user = useSessionUser();
  const qc = useQueryClient();
  const { data: hostData } = useQuery({
    queryKey: ["hosts"],
    queryFn: () => api<{ hosts: PublicHost[] }>("/api/hosts"),
    staleTime: 30_000,
  });
  const hostById = useMemo(() => {
    const map = new Map<string, PublicHost>();
    for (const host of hostData?.hosts ?? []) map.set(host.id, host);
    return map;
  }, [hostData]);
  const [busyIds, setBusyIds] = useState<Record<string, true>>({});
  const [pendingFrom, setPendingFrom] = useState<Record<string, { from: string; action: string }>>({});
  const pendingGen = useRef<Record<string, number>>({});
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("all");
  const [tag, setTag] = useState("all");
  const [hostFilter, setHostFilter] = useState("all");
  const [sort, setSort] = useState(DEFAULT_GUEST_SORT);
  const tags = useMemo(() => uniqueGuestTags(items), [items]);
  const showHost = userHasPermission(user, "hosts.view");
  const noGrants = !showHost && !(user.allowedGuests?.length);
  const hosts = useMemo(() => {
    if (!showHost) return [];
    const map = new Map<string, string>();
    for (const g of items) {
      const id = g.hostId ?? hostId ?? "";
      if (!id) continue;
      map.set(id, g.hostName ?? id);
    }
    return [...map.entries()].sort((a, b) => a[1].localeCompare(b[1], "de"));
  }, [items, hostId, showHost]);

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
      const hay = showHost
        ? `${g.name} ${g.vmid} ${g.hostName ?? ""} ${g.node} ${g.tags ?? ""} ${g.description ?? ""} ${(g.ips ?? []).join(" ")}`.toLowerCase()
        : `${g.name} ${g.vmid} ${g.tags ?? ""} ${g.description ?? ""} ${(g.ips ?? []).join(" ")}`.toLowerCase();
      const textOk = !needle || hay.includes(needle);
      const statusOk = status === "all" || g.status === status;
      const tagOk = tag === "all" || guestHasTag(g.tags, tag);
      const hostOk = hostFilter === "all" || (g.hostId ?? hostId ?? "") === hostFilter;
      return textOk && statusOk && tagOk && hostOk;
    });
    return sortGuests(matched, sort);
  }, [items, q, status, tag, hostFilter, hostId, sort, showHost]);

  const scrollRef = useRef<HTMLDivElement>(null);
  const mobileScrollRef = useRef<HTMLDivElement>(null);
  const firstRowRef = useRef<HTMLTableRowElement>(null);
  const askedIpsAt = useRef(new Map<string, number>());
  const [scrollTop, setScrollTop] = useState(0);
  const [viewH, setViewH] = useState(560);
  const [mobileScrollTop, setMobileScrollTop] = useState(0);
  const [mobileViewH, setMobileViewH] = useState(560);
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

  useEffect(() => {
    if (!virtualize) return;
    const el = mobileScrollRef.current;
    if (!el) return;
    const onScroll = () => setMobileScrollTop(el.scrollTop);
    const ro = new ResizeObserver(() => setMobileViewH(el.clientHeight));
    el.addEventListener("scroll", onScroll, { passive: true });
    ro.observe(el);
    setMobileViewH(el.clientHeight);
    setMobileScrollTop(el.scrollTop);
    return () => {
      el.removeEventListener("scroll", onScroll);
      ro.disconnect();
    };
  }, [virtualize]);

  const win = virtualize
    ? windowRows(filtered, scrollTop, viewH, rowH)
    : { start: 0, end: filtered.length, padTop: 0, padBottom: 0, slice: filtered };
  const mobileWin = virtualize
    ? windowRows(filtered, mobileScrollTop, mobileViewH, GUEST_CARD_ESTIMATE_PX)
    : { start: 0, end: filtered.length, padTop: 0, padBottom: 0, slice: filtered };

  const firstVisibleKey = win.slice[0] ? rowKey(win.slice[0]) : "";

  useEffect(() => {
    const el = firstRowRef.current;
    if (!el || !virtualize) return;
    const ro = new ResizeObserver(() => {
      const h = el.getBoundingClientRect().height;
      if (h >= 36 && Math.abs(h - rowH) >= 2) setRowH(h);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [virtualize, firstVisibleKey, rowH]);

  const hydrateKey = win.slice
    .filter((g) => g.status === "running" && !g.template && !(g.ips && g.ips.length) && g.node && g.vmid)
    .map((g) => `${g.hostId ?? hostId}:${g.kind ?? kind}:${g.vmid}`)
    .join(",");

  useEffect(() => {
    // Throttle IP hydration requests per visible guest.
    // eslint-disable-next-line react-hooks/purity -- effect body, not render
    const now = Date.now();
    const pending = hydrateKey
      ? hydrateKey.split(",").flatMap((entry) => {
          const [hid = "", row = "", vmidRaw = ""] = entry.split(":");
          const vmid = Number(vmidRaw);
          if (!hid || (row !== "vm" && row !== "lxc") || !Number.isInteger(vmid)) return [];
          const guest = items.find(
            (g) => (g.hostId ?? hostId) === hid && (g.kind === row || (!g.kind && (kind === "lxc" ? "lxc" : "vm") === row)) && g.vmid === vmid,
          );
          if (!guest?.node) return [];
          const key = `${hid}:${row}:${vmid}`;
          const asked = askedIpsAt.current.get(key) ?? 0;
          if (now - asked < 20_000) return [];
          askedIpsAt.current.set(key, now);
          return [{ hostId: hid, node: guest.node, vmid, kind: row as "vm" | "lxc" }];
        })
      : [];
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
  }, [hydrateKey, hostId, items, kind, qc]);

  const pendingEntries = Object.entries(pendingFrom);
  if (pendingEntries.length) {
    let next: Record<string, { from: string; action: string }> | null = null;
    for (const [key, pending] of pendingEntries) {
      const guest = items.find((item) => guestRowKey({ ...item, hostId: item.hostId ?? hostId }, rowKind(item)) === key);
      if (!guest || guest.status !== pending.from) {
        if (!next) next = { ...pendingFrom };
        delete next[key];
      }
    }
    if (next) setPendingFrom(next);
  }

  const visibleKeys = filtered.map((g) => rowKey(g));
  const selectedVisible = visibleKeys.filter((key) => selected.has(key));
  const allVisibleSelected = filtered.length > 0 && selectedVisible.length === filtered.length;
  const someVisibleSelected = selectedVisible.length > 0 && !allVisibleSelected;

  function clearPending(key: string, gen: number) {
    if (pendingGen.current[key] !== gen) return;
    setPendingFrom((current) => {
      if (!(key in current)) return current;
      const next = { ...current };
      delete next[key];
      return next;
    });
  }

  async function guestAction(hid: string, node: string, vmid: number, action: string, row: "vm" | "lxc", extra: Record<string, unknown> = {}) {
    const permPath = row === "vm" ? "vms" : "lxc";
    const id = `${hid}:${vmid}`;
    const power = action === "shutdown" || action === "reboot" || action === "stop" || action === "start";
    const guest = items.find((item) => (item.hostId ?? hostId) === hid && item.vmid === vmid);
    const key = guest ? rowKey(guest) : "";
    let gen = 0;
    if (power && guest && key) {
      gen = (pendingGen.current[key] ?? 0) + 1;
      pendingGen.current[key] = gen;
      setPendingFrom((current) => ({ ...current, [key]: { from: guest.status, action } }));
      window.setTimeout(() => clearPending(key, gen), 45_000);
    }
    setBusyIds((prev) => ({ ...prev, [id]: true }));
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
            : action === "start"
              ? t("guest.sentStart")
              : action === "shutdown"
                ? t("guest.sentShutdown")
                : action === "reboot"
                  ? t("guest.sentReboot")
                  : action === "stop"
                    ? t("guest.sentStop")
                    : t("common.taskDone"),
      );
      await invalidateDashboardQueries(qc);
    } catch (err) {
      if (power && key) clearPending(key, gen);
      if (action === "start") toast.error(err instanceof Error ? err.message : t("common.failed"));
      throw err;
    } finally {
      setBusyIds((prev) => {
        if (!(id in prev)) return prev;
        const next = { ...prev };
        delete next[id];
        return next;
      });
    }
  }

  function shareAllows(hid: string, needed: Permission | Permission[]): boolean {
    return peerHostAllowsPermission(hostById.get(hid) ?? { origin: "LOCAL" }, needed);
  }

  function canBulk(g: Guest, action: BulkGuestAction): boolean {
    const hid = g.hostId ?? hostId ?? "";
    const row = rowKind(g);
    const prefix = row === "vm" ? "vm" : "lxc";
    const guest = { hostId: hid, kind: row, vmid: g.vmid };
    const perm =
      action === "start"
        ? (`${prefix}.start` as Permission)
        : action === "shutdown"
          ? (`${prefix}.shutdown` as Permission)
          : action === "reboot"
            ? (`${prefix}.reboot` as Permission)
            : (`${prefix}.force-stop` as Permission);
    return userHasPermission(user, perm, hid, guest) && shareAllows(hid, perm);
  }

  async function runBulk(action: BulkGuestAction) {
    const targets = filtered.filter((g) => selected.has(rowKey(g)) && bulkActionFits(g, action) && canBulk(g, action));
    if (!targets.length) {
      toast.error(t("table.bulkNone"));
      return;
    }
    setBusyIds((prev) => ({ ...prev, bulk: true }));
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
    setBusyIds((prev) => {
      if (!("bulk" in prev)) return prev;
      const next = { ...prev };
      delete next.bulk;
      return next;
    });
    setSelected(new Set());
    toast.success(t("table.bulkDone", { ok, fail }));
    await invalidateDashboardQueries(qc);
  }

  const colCount = compact ? 4 + (mixed ? 1 : 0) : (mixed ? 12 : 11) - (showHost ? 0 : 1);
  const bulkBusy = Boolean(busyIds.bulk);
  const selectedGuests = filtered.filter((g) => selected.has(rowKey(g)));
  const shareBlocked = t("peers.shareBlocked");
  const noPerm = t("common.noPermission");
  function lockTitle(rbac: boolean, shareOk: boolean, okTitle: string) {
    return actionDeniedTitle(rbac, shareOk, shareBlocked, noPerm) ?? okTitle;
  }
  function pendingLabel(action: string) {
    if (action === "start") return t("guest.pendingStart");
    if (action === "shutdown") return t("guest.pendingShutdown");
    if (action === "reboot") return t("guest.pendingReboot");
    if (action === "stop") return t("guest.pendingStop");
    return t("guest.pendingPower");
  }
  const bulkCanStart = selectedGuests.some((g) => canBulk(g, "start"));
  const bulkCanShutdown = selectedGuests.some((g) => canBulk(g, "shutdown"));
  const bulkCanReboot = selectedGuests.some((g) => canBulk(g, "reboot"));
  const bulkCanStop = selectedGuests.some((g) => canBulk(g, "stop"));

  return (
    <div className="space-y-3">
      {compact ? null : <div className="flex flex-wrap gap-2">
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
      </div>}
      {!compact && selectedVisible.length > 0 ? (
        <div className="flex flex-wrap items-center gap-2 rounded-[4px] border border-border bg-muted/30 px-3 py-2 text-sm">
          <span className="text-muted-foreground">{t("table.selected", { n: selectedVisible.length })}</span>
          <Button
            size="sm"
            disabled={bulkBusy || !bulkCanStart}
            title={bulkCanStart ? undefined : shareBlocked}
            onClick={() => void runBulk("start")}
          >
            {t("guest.start")}
          </Button>
          <ConfirmAction
            title={t("table.bulkShutdownTitle")}
            description={t("table.bulkShutdownBody", { n: selectedVisible.length })}
            actionLabel={t("guest.shutdown")}
            disabled={!bulkCanShutdown}
            onConfirm={() => runBulk("shutdown")}
          >
            <Button size="sm" variant="outline" disabled={bulkBusy || !bulkCanShutdown} title={bulkCanShutdown ? undefined : shareBlocked}>
              {t("guest.shutdown")}
            </Button>
          </ConfirmAction>
          <ConfirmAction
            title={t("table.bulkRebootTitle")}
            description={t("table.bulkRebootBody", { n: selectedVisible.length })}
            actionLabel={t("guest.reboot")}
            disabled={!bulkCanReboot}
            onConfirm={() => runBulk("reboot")}
          >
            <Button size="sm" variant="outline" disabled={bulkBusy || !bulkCanReboot} title={bulkCanReboot ? undefined : shareBlocked}>
              {t("guest.reboot")}
            </Button>
          </ConfirmAction>
          <ConfirmAction
            title={t("table.bulkStopTitle")}
            description={t("table.bulkStopBody", { n: selectedVisible.length })}
            actionLabel={t("guest.stop")}
            destructive
            disabled={!bulkCanStop}
            onConfirm={() => runBulk("stop")}
          >
            <Button size="sm" variant="destructive" disabled={bulkBusy || !bulkCanStop} title={bulkCanStop ? undefined : shareBlocked}>
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
            ? "hidden max-h-[min(70vh,720px)] overflow-auto rounded-[4px] border border-border md:block"
            : "hidden overflow-x-auto rounded-[4px] border border-border md:block"
        }
      >
        <table className={`w-full text-left text-sm ${compact ? "min-w-[640px]" : mixed ? "min-w-[1080px]" : showHost ? "min-w-[860px]" : "min-w-[720px]"}`}>
          <thead className="sticky top-0 z-10 bg-background font-[family-name:var(--font-display)] text-[10px] uppercase tracking-[0.16em] text-muted-foreground shadow-[inset_0_-1px_0_0_hsl(var(--border))]">
            <tr>
              {compact ? null : <th className="w-10 px-3 py-2">
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
              </th>}
              <SortHeader label={t("table.id")} column="vmid" sort={sort} onSort={setSort} />
              {mixed ? <SortHeader label={t("table.type")} column="kind" sort={sort} onSort={setSort} /> : null}
              <SortHeader label={t("table.name")} column="name" sort={sort} onSort={setSort} />
              {compact ? null : <th className="px-3 py-2 font-medium">{t("table.ip")}</th>}
              {!compact && showHost ? <SortHeader label={t("table.host")} column="host" sort={sort} onSort={setSort} /> : null}
              <SortHeader label={t("table.status")} column="status" sort={sort} onSort={setSort} />
              {compact ? null : <SortHeader label={t("table.cpu")} column="cpu" sort={sort} onSort={setSort} />}
              {compact ? null : <SortHeader label={t("table.ram")} column="ram" sort={sort} onSort={setSort} />}
              {compact ? null : <SortHeader label={t("table.disk")} column="disk" sort={sort} onSort={setSort} />}
              {compact ? null : <SortHeader label={t("table.uptime")} column="uptime" sort={sort} onSort={setSort} />}
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
                  {items.length === 0 ? (noGrants ? t("guests.noGrants") : t("dashboard.noGuests")) : t("table.noMatches")}
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
                const guest = { hostId: hid, kind: row, vmid: g.vmid };
                const perms = {
                  start: userHasPermission(user, `${prefix}.start` as Permission, hid, guest),
                  shutdown: userHasPermission(user, `${prefix}.shutdown` as Permission, hid, guest),
                  reboot: userHasPermission(user, `${prefix}.reboot` as Permission, hid, guest),
                  stop: userHasPermission(user, `${prefix}.force-stop` as Permission, hid, guest),
                  console: userHasPermission(user, `${prefix}.console` as Permission, hid, guest),
                  files: userHasAnyPermission(
                    user,
                    [guestFilePermission(row, "read"), guestFilePermission(row, "write")],
                    hid,
                    guest,
                  ),
                  snapshot: userHasPermission(user, `${prefix}.snapshot.create` as Permission, hid, guest),
                  delete: userHasPermission(user, `${prefix}.delete` as Permission, hid, guest),
                };
                const share = {
                  start: shareAllows(hid, `${prefix}.start` as Permission),
                  shutdown: shareAllows(hid, `${prefix}.shutdown` as Permission),
                  reboot: shareAllows(hid, `${prefix}.reboot` as Permission),
                  stop: shareAllows(hid, `${prefix}.force-stop` as Permission),
                  console: shareAllows(hid, `${prefix}.console` as Permission),
                  files: shareAllows(hid, [guestFilePermission(row, "read"), guestFilePermission(row, "write")]),
                  snapshot: shareAllows(hid, `${prefix}.snapshot.create` as Permission),
                  delete: shareAllows(hid, `${prefix}.delete` as Permission),
                };
                const shareBlocked = t("peers.shareBlocked");
                const kindLabel = row === "vm" ? "VM" : "LXC";
                const detailBase = row === "vm" ? "vms" : "containers";
                const rowTags = parseGuestTags(g.tags);
                const running = g.status === "running";
                const stopped = g.status === "stopped";
                const key = rowKey(g);
                const rowBusy = Boolean(busyIds[`${hid}:${g.vmid}`]) || bulkBusy;
                const powerPending = Boolean(pendingFrom[key]);
                const ips = uniqueGuestIps(g.ips);
                const ipLabel = ips.join(", ");
                return (
                  <tr key={key} ref={g === win.slice[0] ? firstRowRef : undefined} data-guest-row className="border-t border-border">
                    {compact ? null : <td className="px-3 py-2">
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
                    </td>}
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
                    {compact ? null : <td className="px-3 py-2 font-mono text-xs leading-tight" title={ipLabel || undefined}>
                      {ips.length ? (
                        ips.map((ip) => (
                          <div key={ip} className="whitespace-nowrap text-foreground">
                            {ip}
                          </div>
                        ))
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </td>}
                    {!compact && showHost ? (
                    <td className="px-3 py-2">
                      <p className="font-medium leading-tight text-foreground">{g.hostName ?? hid}</p>
                      <p className="text-xs leading-tight text-muted-foreground">
                        {t("table.node")}: {g.node}
                        {g.hostOwner ? ` · ${g.hostOwner}` : ""}
                      </p>
                    </td>
                    ) : null}
                    <td className="px-3 py-2">
                      <GuestStateBadge status={g.status} />
                      {pendingFrom[rowKey(g)] ? (
                        <span className="proxora-pending ml-2 text-xs text-warning">{pendingLabel(pendingFrom[rowKey(g)]!.action)}</span>
                      ) : null}
                    </td>
                    {compact ? null : <td className="px-3 py-2">
                      <GuestCpuBar guest={g} />
                    </td>}
                    {compact ? null : <td className="px-3 py-2">
                      <GuestRamBar guest={g} />
                    </td>}
                    {compact ? null : <td className="px-3 py-2">
                      <GuestDiskBar guest={g} />
                    </td>}
                    {compact ? null : <td className="px-3 py-2">{formatUptime(g.uptime)}</td>}
                    <td className="px-3 py-2">
                      <GuestRowActions
                        hid={hid}
                        node={g.node}
                        vmid={g.vmid}
                        name={g.name}
                        status={g.status}
                        row={row}
                        kindLabel={kindLabel}
                        rowBusy={rowBusy}
                        powerPending={powerPending}
                        running={running}
                        stopped={stopped}
                        perms={perms}
                        share={share}
                        onAction={(action, extra) => guestAction(hid, g.node, g.vmid, action, row, extra)}
                        onDeleted={() => void invalidateDashboardQueries(qc)}
                      />
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
      <div
        ref={mobileScrollRef}
        className={
          virtualize
            ? "grid max-h-[min(70vh,720px)] gap-2 overflow-auto md:hidden"
            : "grid gap-2 md:hidden"
        }
      >
        {loading ? (
          Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-28 w-full" />)
        ) : filtered.length === 0 ? (
          <p className="rounded-[4px] border border-border px-3 py-6 text-sm text-muted-foreground">
            {items.length === 0 ? (noGrants ? t("guests.noGrants") : t("dashboard.noGuests")) : t("table.noMatches")}
          </p>
        ) : (
          <>
          {mobileWin.padTop > 0 ? <div aria-hidden style={{ height: mobileWin.padTop }} /> : null}
          {mobileWin.slice.map((g) => {
            const hid = g.hostId ?? hostId ?? "";
            const row = rowKind(g);
            const prefix = row === "vm" ? "vm" : "lxc";
            const guest = { hostId: hid, kind: row, vmid: g.vmid };
            const kindLabel = row === "vm" ? "VM" : "LXC";
            const detailBase = row === "vm" ? "vms" : "containers";
            const running = g.status === "running";
            const stopped = g.status === "stopped";
            const key = rowKey(g);
            const rowBusy = Boolean(busyIds[`${hid}:${g.vmid}`]) || bulkBusy;
            const powerPending = Boolean(pendingFrom[key]);
            const ips = uniqueGuestIps(g.ips);
            const canConsole = userHasPermission(user, `${prefix}.console` as Permission, hid, guest);
            const canStart = userHasPermission(user, `${prefix}.start` as Permission, hid, guest);
            const canShutdown = userHasPermission(user, `${prefix}.shutdown` as Permission, hid, guest);
            const canFiles = userHasAnyPermission(
              user,
              [guestFilePermission(row, "read"), guestFilePermission(row, "write")],
              hid,
              guest,
            );
            const canReboot = userHasPermission(user, `${prefix}.reboot` as Permission, hid, guest);
            const canStop = userHasPermission(user, `${prefix}.force-stop` as Permission, hid, guest);
            const canSnapshot = userHasPermission(user, `${prefix}.snapshot.create` as Permission, hid, guest);
            const canDelete = userHasPermission(user, `${prefix}.delete` as Permission, hid, guest);
            const shareStart = shareAllows(hid, `${prefix}.start` as Permission);
            const shareShutdown = shareAllows(hid, `${prefix}.shutdown` as Permission);
            const shareConsole = shareAllows(hid, `${prefix}.console` as Permission);
            const shareFiles = shareAllows(hid, [guestFilePermission(row, "read"), guestFilePermission(row, "write")]);
            const shareReboot = shareAllows(hid, `${prefix}.reboot` as Permission);
            const shareStop = shareAllows(hid, `${prefix}.force-stop` as Permission);
            const shareSnapshot = shareAllows(hid, `${prefix}.snapshot.create` as Permission);
            const shareDelete = shareAllows(hid, `${prefix}.delete` as Permission);
            return (
              <article key={key} className="rounded-[4px] border border-border bg-card/40 p-3">
                <div className="flex items-start gap-2">
                  <input
                    type="checkbox"
                    className="mt-1 h-4 w-4 accent-primary"
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
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <Link className="truncate font-medium hover:underline" href={`/${detailBase}/${hid}/${g.node}/${g.vmid}`}>
                        {g.name}
                      </Link>
                      <span className="font-mono text-xs text-muted-foreground">{g.vmid}</span>
                      {mixed ? <Badge variant={row === "vm" ? "default" : "muted"}>{kindLabel}</Badge> : null}
                      <GuestStateBadge status={g.status} />
                      {pendingFrom[key] ? <span className="proxora-pending text-xs text-warning">{pendingLabel(pendingFrom[key]!.action)}</span> : null}
                    </div>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {showHost ? `${g.hostName ?? hid} · ${g.node}` : g.node}
                      {ips.length ? ` · ${ips.join(", ")}` : ""}
                    </p>
                    {compact ? null : <div className="mt-2 grid grid-cols-3 gap-2">
                      <GuestCpuBar guest={g} />
                      <GuestRamBar guest={g} />
                      <GuestDiskBar guest={g} />
                    </div>}
                    <div className="mt-2">
                      <GuestRowActions
                        hid={hid}
                        node={g.node}
                        vmid={g.vmid}
                        name={g.name}
                        status={g.status}
                        row={row}
                        kindLabel={kindLabel}
                        rowBusy={rowBusy}
                        powerPending={powerPending}
                        running={running}
                        stopped={stopped}
                        perms={{
                          start: canStart,
                          shutdown: canShutdown,
                          reboot: canReboot,
                          stop: canStop,
                          console: canConsole,
                          files: canFiles,
                          snapshot: canSnapshot,
                          delete: canDelete,
                        }}
                        share={{
                          start: shareStart,
                          shutdown: shareShutdown,
                          reboot: shareReboot,
                          stop: shareStop,
                          console: shareConsole,
                          files: shareFiles,
                          snapshot: shareSnapshot,
                          delete: shareDelete,
                        }}
                        onAction={(action, extra) => guestAction(hid, g.node, g.vmid, action, row, extra)}
                        onDeleted={() => void invalidateDashboardQueries(qc)}
                      />
                    </div>
                  </div>
                </div>
              </article>
            );
          })}
          {mobileWin.padBottom > 0 ? <div aria-hidden style={{ height: mobileWin.padBottom }} /> : null}
          </>
        )}
      </div>
    </div>
  );
});

function menuLock(ok: boolean, shareOk: boolean, label: string, blocked: string, noPerm: string) {
  return actionDeniedTitle(ok, shareOk, blocked, noPerm) ?? label;
}

function GuestRowActions({
  hid,
  node,
  vmid,
  name,
  status,
  row,
  kindLabel,
  rowBusy,
  powerPending,
  running,
  stopped,
  perms,
  share,
  onAction,
  onDeleted,
}: {
  hid: string;
  node: string;
  vmid: number;
  name: string;
  status: string;
  row: "vm" | "lxc";
  kindLabel: string;
  rowBusy: boolean;
  powerPending: boolean;
  running: boolean;
  stopped: boolean;
  perms: Record<"start" | "shutdown" | "reboot" | "stop" | "console" | "files" | "snapshot" | "delete", boolean>;
  share: Record<"start" | "shutdown" | "reboot" | "stop" | "console" | "files" | "snapshot" | "delete", boolean>;
  onAction: (action: string, extra?: Record<string, unknown>) => Promise<void>;
  onDeleted: () => void;
}) {
  const { t } = useI18n();
  const rootRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [pos, setPos] = useState({ top: 0, left: 0 });
  const blocked = t("peers.shareBlocked");
  const noPerm = t("common.noPermission");
  const item = "flex w-full rounded-[var(--ui-radius)] px-3 py-2 text-left text-sm hover:bg-muted disabled:opacity-40";

  useEffect(() => {
    if (!open) return;
    const onPointer = (event: MouseEvent) => {
      if (rootRef.current?.contains(event.target as Node)) return;
      setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  function place(button: HTMLButtonElement) {
    const rect = button.getBoundingClientRect();
    setPos({ top: rect.bottom + 4, left: Math.max(8, rect.right - 224) });
  }

  return (
    <div ref={rootRef} className="flex flex-wrap items-center gap-1">
      <Button
        size="sm"
        variant="outline"
        title={menuLock(perms.start, share.start, t("guest.start"), blocked, noPerm)}
        disabled={!stopped || rowBusy || powerPending || !perms.start || !share.start}
        onClick={() => void onAction("start")}
      >
        {t("guest.start")}
      </Button>
      <Button
        size="sm"
        variant="outline"
        title={menuLock(perms.console, share.console, t("guest.console"), blocked, noPerm)}
        disabled={!perms.console || !share.console}
        onClick={() => openGuestToolWindow({ kind: row, hostId: hid, node, vmid, tool: "console" })}
      >
        {t("guest.console")}
      </Button>
      <Button
        size="sm"
        variant="ghost"
        aria-expanded={open}
        aria-haspopup="menu"
        onClick={(event) => {
          place(event.currentTarget);
          setMounted(true);
          setOpen((current) => !current);
        }}
      >
        {t("table.more")}
      </Button>
      {mounted ? (
        <div
          role="menu"
          className={open ? "fixed z-50 w-56 rounded-[var(--ui-radius)] border border-border bg-card p-1 shadow-lg" : "hidden"}
          style={{ top: pos.top, left: pos.left }}
        >
          <ConfirmAction
            title={t("guest.shutdownTitle")}
            description={t("guest.shutdownBody", { id: vmid, name })}
            actionLabel={t("guest.shutdown")}
            disabled={!running || rowBusy || powerPending || !perms.shutdown || !share.shutdown}
            onConfirm={() => onAction("shutdown")}
          >
            <button type="button" role="menuitem" className={item} disabled={!running || rowBusy || powerPending || !perms.shutdown || !share.shutdown} title={menuLock(perms.shutdown, share.shutdown, t("guest.shutdown"), blocked, noPerm)}>
              {t("guest.shutdown")}
            </button>
          </ConfirmAction>
          <ConfirmAction
            title={t("guest.rebootTitle")}
            description={t("guest.rebootBody", { id: vmid, name })}
            actionLabel={t("guest.reboot")}
            disabled={!running || rowBusy || powerPending || !perms.reboot || !share.reboot}
            onConfirm={() => onAction("reboot")}
          >
            <button type="button" role="menuitem" className={item} disabled={!running || rowBusy || powerPending || !perms.reboot || !share.reboot}>
              {t("guest.reboot")}
            </button>
          </ConfirmAction>
          <ConfirmAction
            title={t("guest.stopTitle")}
            description={t("guest.stopBody", { id: vmid, name })}
            actionLabel={t("guest.stop")}
            destructive
            disabled={stopped || rowBusy || powerPending || !perms.stop || !share.stop}
            onConfirm={() => onAction("stop")}
          >
            <button type="button" role="menuitem" className={`${item} text-destructive`} disabled={stopped || rowBusy || powerPending || !perms.stop || !share.stop}>
              {t("guest.stop")}
            </button>
          </ConfirmAction>
          <ConfirmAction
            title={t("guest.snapshotTitle")}
            description={t("guest.snapshotBody", { name })}
            actionLabel={t("guest.createSnapshot")}
            disabled={rowBusy || !perms.snapshot || !share.snapshot}
            onConfirm={() => onAction("snapshot", { snapname: `snap-${Date.now()}` })}
          >
            <button type="button" role="menuitem" className={item} disabled={rowBusy || !perms.snapshot || !share.snapshot}>
              {t("guest.createSnapshot")}
            </button>
          </ConfirmAction>
          <button
            type="button"
            role="menuitem"
            className={item}
            disabled={!perms.files || !share.files}
            title={menuLock(perms.files, share.files, t("files.show"), blocked, noPerm)}
            onClick={() => openGuestToolWindow({ kind: row, hostId: hid, node, vmid, tool: "files" })}
          >
            {t("files.show")}
          </button>
          <GuestDeleteDialog
            hostId={hid}
            node={node}
            kind={row}
            vmid={vmid}
            name={name}
            status={status}
            kindLabel={kindLabel}
            disabled={!perms.delete || !share.delete || rowBusy}
            onConfirm={(backupVolids, phase) =>
              api<{ upid?: unknown; phase?: "shutdown" | "stop" | "delete" }>(
                `/api/hosts/${hid}/${row === "vm" ? "vms" : "lxc"}/${node}/${vmid}`,
                {
                  method: "POST",
                  body: JSON.stringify({ action: "delete", confirm: true, confirmId: vmid, wait: false, backupVolids, phase }),
                },
              )
            }
            onFinished={onDeleted}
          >
            <button type="button" role="menuitem" className={`${item} text-destructive`} disabled={rowBusy || !perms.delete || !share.delete}>
              {t("guest.delete")}
            </button>
          </GuestDeleteDialog>
        </div>
      ) : null}
    </div>
  );
}

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
        className={active ? "text-foreground" : "hover:text-foreground"}
        aria-sort={active ? (sort.dir === "asc" ? "ascending" : "descending") : "none"}
        onClick={() => onSort(nextGuestSort(sort, column))}
      >
        {label}
        {active ? (sort.dir === "asc" ? " ↑" : " ↓") : ""}
      </button>
    </th>
  );
}
