"use client";

import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { api } from "@/lib/api";
import { useI18n } from "@/components/i18n/locale-provider";
import { hostShowsClusterUi } from "@/lib/cluster-features";

type ClusterPayload = {
  clustered: boolean;
  name: string | null;
  quorate: boolean | null;
  nodes: Array<{ name: string; online: boolean; ip?: string }>;
  haGroups: Array<Record<string, unknown>>;
  replications: Array<Record<string, unknown>>;
};

export function HostClusterCard({ hostId, isClusterMember }: { hostId: string; isClusterMember: boolean }) {
  const { t } = useI18n();
  const { data } = useQuery({
    queryKey: ["host-cluster", hostId],
    queryFn: () => api<ClusterPayload>(`/api/hosts/${hostId}/cluster`),
    enabled: hostShowsClusterUi(isClusterMember),
  });
  if (!hostShowsClusterUi(isClusterMember)) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>{t("cluster.title")}</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">{t("cluster.standalone")}</p>
        </CardContent>
      </Card>
    );
  }
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle>{data?.name ? t("cluster.named", { name: data.name }) : t("cluster.title")}</CardTitle>
        {data?.quorate == null ? null : (
          <Badge variant={data.quorate ? "default" : "danger"}>
            {data.quorate ? t("cluster.quorate") : t("cluster.noQuorum")}
          </Badge>
        )}
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[20rem] text-left">
            <thead>
              <tr className="text-xs text-muted-foreground">
                <th className="py-1 pr-2">{t("hosts.node")}</th>
                <th className="py-1 pr-2">{t("cluster.status")}</th>
                <th className="py-1">IP</th>
              </tr>
            </thead>
            <tbody>
              {(data?.nodes ?? []).map((node) => (
                <tr key={node.name} className="border-t border-border">
                  <td className="py-1 pr-2 font-mono">{node.name}</td>
                  <td className="py-1 pr-2">{node.online ? t("cluster.online") : t("cluster.offline")}</td>
                  <td className="py-1 font-mono text-xs">{node.ip ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {data?.replications.length ? (
          <div>
            <p className="mb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">{t("cluster.replication")}</p>
            <ul className="space-y-1 text-xs">
              {data.replications.map((row, i) => (
                <li key={String(row.id ?? i)} className="font-mono">
                  {String(row.id ?? row.guest ?? i)} → {String(row.target ?? "—")}
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
