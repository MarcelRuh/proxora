"use client";

import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ConfirmAction } from "@/components/confirm-action";
import { WebConsole } from "@/components/console/web-console";
import { api } from "@/lib/api";
import { mergeHostUpdateDetails } from "@/lib/apt-updates";
import type { PublicHost } from "@/lib/types";
import { PageHeader } from "@/components/layout/page-header";
import { QueryGate } from "@/components/layout/query-gate";
import { useI18n } from "@/components/i18n/locale-provider";

type AptPackage = { Package: string; Version?: string; OldVersion?: string };
type HostUpdates = {
  host: PublicHost;
  version: string | null;
  updates: Array<{ node: string; count: number; packages: AptPackage[] }>;
  error: string | null;
};

export default function UpdatesPage() {
  const { t, locale } = useI18n();
  const qc = useQueryClient();
  const [shell, setShell] = useState<{ hostId: string; node: string; name: string } | null>(null);
  const recheckTimer = useRef<number>(0);
  useEffect(() => () => window.clearTimeout(recheckTimer.current), []);
  const { data: hosts, error: hostsError, refetch: refetchHosts } = useQuery({
    queryKey: ["hosts"],
    queryFn: () => api<{ hosts: PublicHost[] }>("/api/hosts"),
  });
  const { data: jobs } = useQuery({
    queryKey: ["update-jobs"],
    queryFn: () =>
      api<{
        jobs: Array<{ id: string; status: string; host?: { name: string } | null; error?: string | null }>;
      }>("/api/updates"),
    refetchInterval: 15_000,
    staleTime: 8_000,
    placeholderData: (previous) => previous,
  });
  const { data: details, isFetching } = useQuery({
    queryKey: ["update-details", hosts?.hosts.map((h) => h.id)],
    enabled: Boolean(hosts),
    queryFn: async () => {
      return Promise.all(
        (hosts?.hosts ?? []).map(async (h) => {
          try {
            const r = await api<{ version: string | null; updates: HostUpdates["updates"] }>(
              `/api/hosts/${h.id}/updates`,
            );
            return { host: h, ...r, error: null as string | null };
          } catch (e) {
            return {
              host: h,
              version: h.proxmoxVersion,
              updates: [],
              error: e instanceof Error ? e.message : t("updates.listFailed"),
            };
          }
        }),
      );
    },
    staleTime: 5 * 60_000,
    refetchOnWindowFocus: false,
    placeholderData: (previous) => previous,
  });

  function applyChecked(hostId: string, data: { version: string | null; updates: HostUpdates["updates"] }) {
    const checkedAt = new Date().toISOString();
    qc.setQueriesData<HostUpdates[]>({ queryKey: ["update-details"] }, (prev) =>
      mergeHostUpdateDetails(prev, hostId, data, checkedAt),
    );
    void qc.invalidateQueries({ queryKey: ["apt-summary"] });
    void qc.invalidateQueries({ queryKey: ["hosts"] });
  }

  const checkOne = useMutation({
    mutationFn: ({ hostId, node }: { hostId: string; node?: string }) =>
      api<{ version: string | null; updates: HostUpdates["updates"] }>(`/api/hosts/${hostId}/updates`, {
        method: "POST",
        body: JSON.stringify({ action: "check", node }),
      }),
    onSuccess: (data, { hostId }) => {
      applyChecked(hostId, data);
      toast.success(t("updates.packagesUpdatedOne"));
    },
    onError: (e: Error) => toast.error(e.message),
  });

  function recheckHost(hostId: string, node?: string, delayMs = 0) {
    window.clearTimeout(recheckTimer.current);
    const run = () => {
      if (checkOne.isPending) return;
      checkOne.mutate({ hostId, node });
    };
    if (delayMs <= 0) {
      run();
      return;
    }
    recheckTimer.current = window.setTimeout(run, delayMs);
  }

  const checkAll = useMutation({
    mutationFn: async () => {
      const ids = hosts?.hosts.map((h) => h.id) ?? [];
      const results = await Promise.allSettled(
        ids.map(async (id) => {
          const data = await api<{ version: string | null; updates: HostUpdates["updates"] }>(
            `/api/hosts/${id}/updates`,
            {
              method: "POST",
              body: JSON.stringify({ action: "check" }),
            },
          );
          return { id, data };
        }),
      );
      const ok = results.flatMap((r) => (r.status === "fulfilled" ? [r.value] : []));
      const failed = results.filter((r) => r.status === "rejected").length;
      return { ok, failed };
    },
    onSuccess: ({ ok, failed }) => {
      for (const row of ok) applyChecked(row.id, row.data);
      if (failed) toast.error(t("updates.checkAllFailed", { n: failed }));
      else toast.success(t("updates.packagesUpdated"));
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div className="space-y-4">
      <PageHeader
        kicker={t("page.maintenance")}
        title={t("updates.title")}
        description={t("updates.description")}
        actions={
          <Button
            variant="outline"
            disabled={checkAll.isPending || !hosts?.hosts.length}
            onClick={() => checkAll.mutate()}
          >
            {checkAll.isPending ? t("updates.checkingAll") : t("updates.checkAll")}
          </Button>
        }
      />

      {shell ? (
        <Card>
          <CardHeader>
            <CardTitle>{t("updates.consoleTitle", { name: shell.name })}</CardTitle>
            <CardDescription>{t("updates.consoleBody", { node: shell.node })}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <WebConsole
              hostId={shell.hostId}
              node={shell.node}
              kind="node"
              cmd="upgrade"
              onDisconnected={() => recheckHost(shell.hostId, shell.node, 4_000)}
            />
            <Button
              variant="outline"
              size="sm"
              disabled={checkOne.isPending}
              onClick={() => {
                const hostId = shell.hostId;
                const node = shell.node;
                setShell(null);
                recheckHost(hostId, node);
              }}
            >
              {checkOne.isPending ? t("updates.checkingList") : t("updates.closeConsole")}
            </Button>
          </CardContent>
        </Card>
      ) : null}

      <QueryGate isLoading={false} error={hostsError} onRetry={() => void refetchHosts()}>
        <div className="grid gap-4 md:grid-cols-2">
          {(details ?? []).map((row) => {
            const count = row.updates.reduce((acc, n) => acc + n.count, 0);
            const checking = checkOne.isPending && checkOne.variables?.hostId === row.host.id;
            const checkedAt = row.host.aptCheckedAt
              ? new Date(row.host.aptCheckedAt).toLocaleString(locale === "en" ? "en-GB" : "de-DE")
              : null;
            return (
              <Card key={row.host.id}>
                <CardHeader className="flex flex-row items-center justify-between">
                  <CardTitle>{row.host.name}</CardTitle>
                  <Badge variant={row.error ? "danger" : count > 0 ? "warning" : "success"}>
                    {row.error ? t("updates.error") : t("updates.count", { n: count })}
                  </Badge>
                </CardHeader>
                <CardContent className="space-y-3">
                  <p className="text-sm text-muted-foreground">
                    {t("updates.version", { version: row.version ?? t("updates.unknown") })}
                    {checkedAt ? ` · ${t("updates.lastChecked", { time: checkedAt })}` : ` · ${t("updates.neverChecked")}`}
                  </p>
                  {row.error ? <p className="text-sm text-destructive">{row.error}</p> : null}
                  <ul className="max-h-32 overflow-auto text-xs text-muted-foreground">
                    {row.updates.flatMap((n) =>
                      n.packages.slice(0, 12).map((p) => (
                        <li key={`${n.node}-${p.Package}`}>
                          {p.Package} {p.OldVersion ? `${p.OldVersion} → ` : ""}
                          {p.Version}
                        </li>
                      )),
                    )}
                  </ul>
                  <div className="flex flex-wrap gap-2">
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={checking || checkAll.isPending}
                      onClick={() => recheckHost(row.host.id)}
                    >
                      {checking ? t("updates.checking") : t("updates.checkOne")}
                    </Button>
                    {(row.updates.length ? row.updates : [{ node: "" }]).map((n) => (
                      <ConfirmAction
                        key={n.node || row.host.id}
                        title={t("updates.upgradeTitle", {
                          name: row.host.name,
                          node: n.node ? ` (${n.node})` : "",
                        })}
                        description={t("updates.upgradeBody")}
                        actionLabel={t("updates.upgradeStart")}
                        destructive
                        onConfirm={async () => {
                          const r = await api<{ mode: "console"; node: string }>(`/api/hosts/${row.host.id}/updates`, {
                            method: "POST",
                            body: JSON.stringify({
                              action: "upgrade",
                              node: n.node || undefined,
                              confirm: true,
                            }),
                          });
                          setShell({ hostId: row.host.id, node: r.node, name: row.host.name });
                          toast.success(t("updates.consoleOpened"));
                        }}
                      >
                        <Button size="sm">{t("updates.upgrade", { node: row.updates.length > 1 ? n.node : "" })}</Button>
                      </ConfirmAction>
                    ))}
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
        {isFetching && !details ? <p className="text-sm text-muted-foreground">{t("updates.loading")}</p> : null}
      </QueryGate>

      {(jobs?.jobs ?? []).length ? (
        <Card>
          <CardHeader>
            <CardTitle>{t("updates.jobsTitle")}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            {(jobs?.jobs ?? []).map((j) => (
              <div key={j.id} className="flex flex-wrap justify-between gap-2">
                <span>{j.host?.name ?? t("updates.unknown")}</span>
                <div className="flex items-center gap-2">
                  {j.error ? <span className="text-xs text-destructive">{j.error}</span> : null}
                  <Badge variant={j.status === "FAILED" ? "danger" : j.status === "SUCCESS" ? "success" : "warning"}>
                    {j.status}
                  </Badge>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
