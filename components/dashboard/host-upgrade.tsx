"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ConfirmAction } from "@/components/confirm-action";
import { WebConsole } from "@/components/console/web-console";
import { api } from "@/lib/api";
import { peerHostAllowsPermission } from "@/lib/federation-access";
import { userHasPermission } from "@/lib/permissions";
import type { DashboardHost } from "@/lib/types";
import { useSessionUser } from "@/components/auth/session-user";
import { useI18n } from "@/components/i18n/locale-provider";

type NodeUpdates = { node: string; count: number };

type Shell = { hostId: string; node: string; name: string };

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
  const [shell, setShell] = useState<Shell | null>(null);
  const shellRef = useRef<Shell | null>(null);
  shellRef.current = shell;
  const canUpgrade =
    userHasPermission(user, "updates.upgrade", host.id) && peerHostAllowsPermission(host, "updates.upgrade");
  const canCheck = userHasPermission(user, "updates.check", host.id) && peerHostAllowsPermission(host, "updates.check");
  const { data } = useQuery({
    queryKey: ["update-details", host.id],
    enabled: count > 0,
    queryFn: () => api<{ updates: NodeUpdates[] }>(`/api/hosts/${host.id}/updates`),
    staleTime: 5 * 60_000,
    refetchOnWindowFocus: false,
  });
  const pending = (data?.updates ?? []).filter((node) => node.count > 0);

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

  if (count <= 0) return null;
  if (!data) {
    return (
      <div className="border-t border-border pt-3">
        <Link href="/updates" className="text-sm text-warning">
          {t("dashboard.updatesCount", { n: count })}
        </Link>
      </div>
    );
  }
  if (pending.length === 0) return null;

  return (
    <div className="flex flex-wrap items-center gap-2 border-t border-border pt-3">
      <Link href="/updates" className="text-sm text-warning">
        {t("dashboard.updatesCount", { n: pending.reduce((sum, node) => sum + node.count, 0) })}
      </Link>
      {canUpgrade
        ? pending.map((node) => (
            <ConfirmAction
              key={node.node || host.id}
              title={t("updates.upgradeTitle", {
                name: host.name,
                node: node.node ? ` (${node.node})` : "",
              })}
              description={t("updates.upgradeBody")}
              actionLabel={t("updates.upgradeStart")}
              destructive
              onConfirm={async () => {
                const result = await api<{ mode: "console"; node: string }>(`/api/hosts/${host.id}/updates`, {
                  method: "POST",
                  body: JSON.stringify({
                    action: "upgrade",
                    node: node.node || undefined,
                    confirm: true,
                  }),
                });
                setShell({ hostId: host.id, node: result.node, name: host.name });
                toast.success(t("updates.consoleOpened"));
              }}
            >
              <Button size="sm">
                {pending.length > 1 ? t("updates.upgrade", { node: node.node }) : t("updates.upgradeStart")}
              </Button>
            </ConfirmAction>
          ))
        : null}
      <Dialog open={Boolean(shell)} onOpenChange={(next) => { if (!next) void closeShell(); }}>
        <DialogContent instant className="flex max-h-[min(92dvh,52rem)] max-w-5xl flex-col overflow-hidden">
          <DialogHeader>
            <DialogTitle>{shell ? t("updates.consoleTitle", { name: shell.name }) : t("updates.upgradeStart")}</DialogTitle>
            <DialogDescription>
              {shell ? t("updates.consoleBody", { node: shell.node }) : null}
            </DialogDescription>
          </DialogHeader>
          {shell ? (
            <div className="h-[min(68dvh,34rem)] min-h-[22rem]">
              <WebConsole hostId={shell.hostId} node={shell.node} kind="node" cmd="upgrade" fill />
            </div>
          ) : null}
          <div className="mt-3">
            <Button variant="outline" size="sm" onClick={() => void closeShell()}>
              {t("updates.closeConsole")}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
