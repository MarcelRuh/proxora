"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { WebConsole } from "@/components/console/web-console";
import { api } from "@/lib/api";
import { peerHostAllowsPermission } from "@/lib/federation-access";
import { userHasPermission } from "@/lib/permissions";
import type { DashboardHost } from "@/lib/types";
import { useSessionUser } from "@/components/auth/session-user";
import { useI18n } from "@/components/i18n/locale-provider";

type NodeUpdates = { node: string; count: number };

type Shell = { hostId: string; node: string; name: string };

function packageLabel(count: number, one: string, many: (n: number) => string) {
  if (count === 1) return one;
  return many(count);
}

export function HostUpgrade({
  host,
  count,
}: {
  host: DashboardHost;
  count: number;
}) {
  const { t } = useI18n();
  const user = useSessionUser();
  const qc = useQueryClient();
  const [pick, setPick] = useState(false);
  const [node, setNode] = useState("");
  const [shell, setShell] = useState<Shell | null>(null);
  const [starting, setStarting] = useState(false);
  const shellRef = useRef<Shell | null>(null);
  shellRef.current = shell;
  const online = host.connectionState === "ONLINE";
  const canUpgrade =
    online && userHasPermission(user, "updates.upgrade", host.id) && peerHostAllowsPermission(host, "updates.upgrade");
  const canCheck = userHasPermission(user, "updates.check", host.id) && peerHostAllowsPermission(host, "updates.check");
  const { data, isFetching, isError, refetch } = useQuery({
    queryKey: ["update-details", host.id],
    enabled: count > 0 && online,
    queryFn: () => api<{ updates: NodeUpdates[] }>(`/api/hosts/${host.id}/updates`),
    staleTime: 5 * 60_000,
    refetchOnWindowFocus: false,
  });
  const pending = (data?.updates ?? []).filter((item) => item.count > 0);
  const liveCount = pending.reduce((sum, item) => sum + item.count, 0);

  async function closeShell() {
    const current = shellRef.current;
    if (!current) return;
    shellRef.current = null;
    setShell(null);
    if (!canCheck) {
      void qc.invalidateQueries({ queryKey: ["apt-summary"] });
      return;
    }
    try {
      await api(`/api/hosts/${current.hostId}/updates`, {
        method: "POST",
        body: JSON.stringify({ action: "check", node: current.node }),
      });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("updates.listFailed"));
    }
    void qc.invalidateQueries({ queryKey: ["apt-summary"] });
    void qc.invalidateQueries({ queryKey: ["update-details", current.hostId] });
  }

  async function startUpgrade() {
    if (!node || starting) return;
    setStarting(true);
    try {
      const result = await api<{ mode: "console"; node: string }>(`/api/hosts/${host.id}/updates`, {
        method: "POST",
        body: JSON.stringify({ action: "upgrade", node, confirm: true }),
      });
      setPick(false);
      setShell({ hostId: host.id, node: result.node, name: host.name });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("common.failed"));
    } finally {
      setStarting(false);
    }
  }

  if (count <= 0) return null;

  const stale = Boolean(data) && pending.length === 0;
  const labelCount = liveCount || count;

  return (
    <div className="flex flex-wrap items-center gap-2 border-t border-border pt-3">
      {isError ? (
        <>
          <span className="text-sm text-muted-foreground">{t("dashboard.updatesFailed")}</span>
          <Link href={`/updates?host=${host.id}`} className="text-sm text-primary underline-offset-4 hover:underline">
            {t("dashboard.toUpdates")}
          </Link>
          <Button size="sm" variant="outline" onClick={() => void refetch()}>
            {t("common.retry")}
          </Button>
        </>
      ) : (
        <Link href={`/updates?host=${host.id}`} className="text-sm text-primary underline-offset-4 hover:underline">
          {stale ? t("dashboard.updatesStale") : packageLabel(labelCount, t("dashboard.packageOne"), (n) => t("dashboard.packages", { n }))}
        </Link>
      )}
      {canUpgrade && pending.length > 0 ? (
        <Button
          size="sm"
          variant="outline"
          onClick={() => {
            setNode(pending[0]?.node ?? "");
            setPick(true);
          }}
        >
          {t("dashboard.upgrade")}
        </Button>
      ) : null}
      {isFetching && !data && !isError ? <span className="text-xs text-muted-foreground">{t("updates.checkingList")}</span> : null}
      <Dialog open={pick} onOpenChange={setPick}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {t("updates.upgradeTitle", { name: host.name, node: node ? ` (${node})` : "" })}
            </DialogTitle>
            <DialogDescription>{t("updates.upgradeBody")}</DialogDescription>
          </DialogHeader>
          {pending.length > 4 ? (
            <select
              className="h-9 w-full rounded-[var(--ui-radius)] border border-input bg-transparent px-2 text-sm"
              value={node}
              onChange={(event) => setNode(event.target.value)}
              aria-label={t("dashboard.upgrade")}
            >
              {pending.map((item) => (
                <option key={item.node} value={item.node}>
                  {item.node} · {packageLabel(item.count, t("dashboard.packageOne"), (n) => t("dashboard.packages", { n }))}
                </option>
              ))}
            </select>
          ) : pending.length > 1 ? (
            <div className="flex flex-wrap gap-2">
              {pending.map((item) => (
                <Button
                  key={item.node}
                  size="sm"
                  variant={item.node === node ? "default" : "outline"}
                  onClick={() => setNode(item.node)}
                >
                  {item.node} · {packageLabel(item.count, t("dashboard.packageOne"), (n) => t("dashboard.packages", { n }))}
                </Button>
              ))}
            </div>
          ) : null}
          <div className="mt-4 flex justify-end gap-2">
            <Button variant="outline" onClick={() => setPick(false)} disabled={starting}>
              {t("common.cancel")}
            </Button>
            <Button variant="destructive" disabled={!node || starting} onClick={() => void startUpgrade()}>
              {starting ? t("common.loading") : t("updates.upgradeStart")}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
      {shell ? (
        <div className="basis-full space-y-2">
          <p className="text-sm text-muted-foreground">{t("updates.consoleBody", { node: shell.node })}</p>
          <div className="h-[min(28rem,60dvh)] min-h-[18rem]">
            <WebConsole hostId={shell.hostId} node={shell.node} kind="node" cmd="upgrade" fill />
          </div>
          <Button variant="outline" size="sm" onClick={() => void closeShell()}>
            {t("updates.closeConsole")}
          </Button>
        </div>
      ) : null}
    </div>
  );
}
