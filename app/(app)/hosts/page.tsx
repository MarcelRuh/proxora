"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { HostStateBadge } from "@/components/status-badge";
import { ConfirmAction } from "@/components/confirm-action";
import { api } from "@/lib/api";
import type { PublicHost } from "@/lib/types";
import { PageHeader } from "@/components/layout/page-header";
import { QueryGate } from "@/components/layout/query-gate";
import { useI18n } from "@/components/i18n/locale-provider";
import { useCan, useSessionUser } from "@/components/auth/session-user";
import { userHasPermission } from "@/lib/permissions";
import { peerHostAllowsPermission } from "@/lib/federation-access";
import { actionDeniedTitle } from "@/lib/action-lock";
import { HostEditorDialog } from "@/components/hosts/host-editor";
import { HostMaintenanceButton } from "@/components/hosts/host-maintenance";
import { EmptyState, Skeleton } from "@/components/ui/misc";

export default function HostsPage() {
  const { t } = useI18n();
  const canCreate = useCan("hosts.create");
  const qc = useQueryClient();
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ["hosts"],
    queryFn: () => api<{ hosts: PublicHost[] }>("/api/hosts"),
    refetchInterval: 30_000,
    staleTime: 15_000,
    placeholderData: (previous) => previous,
  });
  const [createOpen, setCreateOpen] = useState(false);
  const [editing, setEditing] = useState<PublicHost | null>(null);

  function refresh() {
    void qc.invalidateQueries({ queryKey: ["hosts"] });
  }

  return (
    <div className="space-y-6">
      <PageHeader
        kicker={t("hosts.kicker")}
        title={t("hosts.title")}
        description={t("hosts.description")}
        actions={
          canCreate ? (
            <Button onClick={() => setCreateOpen(true)}>{t("hosts.add")}</Button>
          ) : (
            <Button disabled title={t("common.noPermission")}>
              {t("hosts.add")}
            </Button>
          )
        }
      />
      <QueryGate isLoading={false} error={error} onRetry={() => void refetch()}>
        {isLoading ? (
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {Array.from({ length: 3 }).map((_, i) => (
              <Skeleton key={i} className="h-40" />
            ))}
          </div>
        ) : data?.hosts.length ? (
          <div className="space-y-8">
            <HostSection
              title={t("peers.localGroup")}
              hosts={data.hosts.filter((h) => h.origin !== "PEER")}
              onEdit={setEditing}
              onRefresh={refresh}
            />
            {[...groupPeerHosts(data.hosts, t("peers.unknown"))].map(([owner, hosts]) => (
              <HostSection
                key={owner}
                title={t("peers.peerGroup", { name: owner })}
                hosts={hosts}
                remote
                onEdit={setEditing}
                onRefresh={refresh}
              />
            ))}
          </div>
        ) : (
          <EmptyState
            title={t("hosts.empty")}
            description={t("hosts.emptyBody")}
            action={
              canCreate ? (
                <Button onClick={() => setCreateOpen(true)}>{t("hosts.add")}</Button>
              ) : (
                <Button disabled title={t("common.noPermission")}>
                  {t("hosts.add")}
                </Button>
              )
            }
          />
        )}
      </QueryGate>
      <HostEditorDialog mode="create" open={createOpen} onOpenChange={setCreateOpen} onSaved={refresh} />
      <HostEditorDialog
        mode="edit"
        host={editing}
        open={Boolean(editing)}
        onOpenChange={(next) => {
          if (!next) setEditing(null);
        }}
        onSaved={refresh}
      />
    </div>
  );
}

function groupPeerHosts(hosts: PublicHost[], fallback: string): Map<string, PublicHost[]> {
  const groups = new Map<string, PublicHost[]>();
  for (const host of hosts.filter((h) => h.origin === "PEER")) {
    const key = host.peerName || fallback;
    const bucket = groups.get(key) ?? [];
    bucket.push(host);
    groups.set(key, bucket);
  }
  return groups;
}

function HostSection({
  title,
  hosts,
  remote,
  onEdit,
  onRefresh,
}: {
  title: string;
  hosts: PublicHost[];
  remote?: boolean;
  onEdit: (host: PublicHost) => void;
  onRefresh: () => void;
}) {
  const { t } = useI18n();
  const user = useSessionUser();
  if (!hosts.length) return null;
  return (
    <div className="space-y-3">
      <h2 className="text-sm font-medium uppercase tracking-wide text-muted-foreground">{title}</h2>
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {hosts.map((host) => {
          const noPerm = t("common.noPermission");
          const shareBlocked = t("peers.shareBlocked");
          const canConsoleRbac = userHasPermission(user, "hosts.console", host.id);
          const canConsoleShare = peerHostAllowsPermission(host, "hosts.console");
          const consoleDenied = actionDeniedTitle(canConsoleRbac, canConsoleShare, shareBlocked, noPerm);
          const canEditRbac =
            userHasPermission(user, "hosts.update", host.id) || userHasPermission(user, "hosts.credentials", host.id);
          const editDenied = actionDeniedTitle(canEditRbac, !remote, shareBlocked, noPerm);
          const canDeleteRbac = userHasPermission(user, "hosts.delete", host.id);
          const deleteDenied = actionDeniedTitle(canDeleteRbac, !remote, shareBlocked, noPerm);
          const maintenanceDenied = actionDeniedTitle(
            userHasPermission(user, "hosts.update", host.id),
            !remote,
            shareBlocked,
            noPerm,
          );
          return (
          <Card key={host.id}>
            <CardHeader className="flex flex-row items-start justify-between">
              <div>
                <CardTitle>{host.name}</CardTitle>
                <p className="text-xs text-muted-foreground">
                  {remote ? t("peers.sharedBy", { name: host.peerName ?? title }) : host.url}
                </p>
                <p className="mt-1 text-[11px] text-muted-foreground">
                  {host.isClusterMember
                    ? t("cluster.named", { name: host.clusterName || t("cluster.title") })
                    : t("cluster.standalone")}
                </p>
              </div>
              <HostStateBadge state={host.connectionState} />
            </CardHeader>
            <CardContent className="space-y-3">
              <p className="text-sm">Proxmox VE {host.proxmoxVersion ?? "—"}</p>
              {host.lastError ? <p className="text-sm text-destructive">{host.lastError}</p> : null}
              <div className="flex flex-wrap gap-2">
                <Button size="sm" asChild>
                  <Link href={`/hosts/${host.id}`}>{t("hosts.open")}</Link>
                </Button>
                {consoleDenied ? (
                  <Button size="sm" variant="outline" disabled title={consoleDenied}>
                    {t("hosts.terminal")}
                  </Button>
                ) : (
                  <Button size="sm" variant="outline" asChild>
                    <Link href={`/hosts/${host.id}/console`}>{t("hosts.terminal")}</Link>
                  </Button>
                )}
                <Button
                  size="sm"
                  variant="outline"
                  disabled={Boolean(editDenied)}
                  title={editDenied}
                  onClick={() => onEdit(host)}
                >
                  {t("hosts.edit")}
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={async () => {
                    try {
                      await api(`/api/hosts/${host.id}/test`, { method: "POST" });
                      toast.success(t("hosts.testOk"));
                      onRefresh();
                    } catch (e) {
                      toast.error(e instanceof Error ? e.message : t("common.failed"));
                    }
                  }}
                >
                  {t("hosts.test")}
                </Button>
                <HostMaintenanceButton
                  host={host}
                  onDone={onRefresh}
                  disabled={Boolean(maintenanceDenied)}
                  disabledReason={maintenanceDenied}
                />
                {deleteDenied ? (
                  <Button size="sm" variant="destructive" disabled title={deleteDenied}>
                    {t("hosts.remove")}
                  </Button>
                ) : (
                  <ConfirmAction
                    title={t("hosts.removeTitle", { name: host.name })}
                    description={t("hosts.removeBody")}
                    actionLabel={t("hosts.removeAction")}
                    destructive
                    onConfirm={async () => {
                      await api(`/api/hosts/${host.id}`, { method: "DELETE" });
                      toast.success(t("hosts.removed"));
                      onRefresh();
                    }}
                  >
                    <Button size="sm" variant="destructive">
                      {t("hosts.remove")}
                    </Button>
                  </ConfirmAction>
                )}
              </div>
            </CardContent>
          </Card>
          );
        })}
      </div>
    </div>
  );
}
