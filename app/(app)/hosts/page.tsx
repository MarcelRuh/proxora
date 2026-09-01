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
import { useCan } from "@/components/auth/session-user";
import { HostEditorDialog } from "@/components/hosts/host-editor";
import { EmptyState, Skeleton } from "@/components/ui/misc";

export default function HostsPage() {
  const { t } = useI18n();
  const canCreate = useCan("hosts.create");
  const canDelete = useCan("hosts.delete");
  const canEdit = useCan("hosts.update") || useCan("hosts.credentials");
  const canConsole = useCan("hosts.console");
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
        actions={canCreate ? <Button onClick={() => setCreateOpen(true)}>{t("hosts.add")}</Button> : undefined}
      />
      <QueryGate isLoading={false} error={error} onRetry={() => void refetch()}>
        {isLoading ? (
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {Array.from({ length: 3 }).map((_, i) => (
              <Skeleton key={i} className="h-40" />
            ))}
          </div>
        ) : data?.hosts.length ? (
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {data.hosts.map((host) => (
              <Card key={host.id}>
                <CardHeader className="flex flex-row items-start justify-between">
                  <div>
                    <CardTitle>{host.name}</CardTitle>
                    <p className="text-xs text-muted-foreground">{host.url}</p>
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
                    {canConsole ? (
                      <Button size="sm" variant="outline" asChild>
                        <Link href={`/hosts/${host.id}/console`}>{t("hosts.terminal")}</Link>
                      </Button>
                    ) : null}
                    {canEdit ? (
                      <Button size="sm" variant="outline" onClick={() => setEditing(host)}>
                        {t("hosts.edit")}
                      </Button>
                    ) : null}
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={async () => {
                        try {
                          await api(`/api/hosts/${host.id}/test`, { method: "POST" });
                          toast.success(t("hosts.testOk"));
                          refresh();
                        } catch (e) {
                          toast.error(e instanceof Error ? e.message : t("common.failed"));
                        }
                      }}
                    >
                      {t("hosts.test")}
                    </Button>
                    {canDelete ? (
                      <ConfirmAction
                        title={t("hosts.removeTitle", { name: host.name })}
                        description={t("hosts.removeBody")}
                        actionLabel={t("hosts.removeAction")}
                        destructive
                        onConfirm={async () => {
                          await api(`/api/hosts/${host.id}`, { method: "DELETE" });
                          toast.success(t("hosts.removed"));
                          refresh();
                        }}
                      >
                        <Button size="sm" variant="destructive">
                          {t("hosts.remove")}
                        </Button>
                      </ConfirmAction>
                    ) : null}
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        ) : (
          <EmptyState
            title={t("hosts.empty")}
            description={t("hosts.emptyBody")}
            action={canCreate ? <Button onClick={() => setCreateOpen(true)}>{t("hosts.add")}</Button> : undefined}
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
