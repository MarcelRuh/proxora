"use client";

import { useMemo } from "react";
import Link from "next/link";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { WebConsole } from "@/components/console/web-console";
import { api } from "@/lib/api";
import { pickHostConsoleNode } from "@/lib/host-console";
import type { PublicHost } from "@/lib/types";
import { PageHeader } from "@/components/layout/page-header";
import { QueryGate } from "@/components/layout/query-gate";
import { useCan } from "@/components/auth/session-user";
import { useI18n } from "@/components/i18n/locale-provider";

type Status = {
  host: string;
  nodes: Array<{ node: string; online: string }>;
};

export default function HostConsolePage() {
  const { t } = useI18n();
  const params = useParams<{ id: string }>();
  const search = useSearchParams();
  const router = useRouter();
  const canConsole = useCan("hosts.console");
  const requested = search.get("node");
  const { data: meta, isLoading: metaLoading, error: metaError, refetch: refetchMeta } = useQuery({
    queryKey: ["host-meta", params.id],
    queryFn: () => api<{ host: PublicHost }>(`/api/hosts/${params.id}`),
  });
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ["host", params.id],
    queryFn: () => api<Status>(`/api/hosts/${params.id}/status`),
    enabled: canConsole,
  });

  const node = useMemo(
    () => pickHostConsoleNode(data?.nodes ?? [], requested),
    [data?.nodes, requested],
  );

  if (!canConsole) {
    return (
      <div className="proxora-panel p-6">
        <p className="font-medium">{t("hosts.terminalForbidden")}</p>
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-col gap-4">
      <PageHeader
        kicker={t("hosts.kicker")}
        title={t("hosts.terminalTitle", { name: meta?.host.name ?? data?.host ?? params.id })}
        description={t("hosts.terminalBody")}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="outline" size="sm" asChild>
              <Link href={`/hosts/${params.id}`}>{t("hosts.open")}</Link>
            </Button>
            {(data?.nodes ?? []).length > 1 ? (
              <select
                className="h-9 rounded-[4px] border border-input bg-white/[0.03] px-2 text-sm"
                value={node ?? ""}
                onChange={(e) => {
                  const next = e.target.value;
                  router.replace(next ? `/hosts/${params.id}/console?node=${encodeURIComponent(next)}` : `/hosts/${params.id}/console`);
                }}
              >
                {(data?.nodes ?? []).map((item) => (
                  <option key={item.node} value={item.node}>
                    {item.node}
                    {item.online === "online" ? "" : ` (${item.online})`}
                  </option>
                ))}
              </select>
            ) : null}
          </div>
        }
      />
      <QueryGate
        isLoading={isLoading || metaLoading}
        error={error ?? metaError}
        onRetry={() => {
          void refetch();
          void refetchMeta();
        }}
      >
        {node ? (
          <WebConsole key={node} hostId={params.id} node={node} kind="node" fill />
        ) : (
          <div className="proxora-panel p-6">
            <p className="font-medium">{t("hosts.terminalNoNode")}</p>
          </div>
        )}
      </QueryGate>
    </div>
  );
}
