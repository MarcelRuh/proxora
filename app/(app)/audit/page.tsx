"use client";

import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { api } from "@/lib/api";
import { PageHeader } from "@/components/layout/page-header";
import { QueryGate } from "@/components/layout/query-gate";
import { EmptyState } from "@/components/ui/misc";
import { useI18n } from "@/components/i18n/locale-provider";

type Log = {
  id: string;
  action: string;
  target: string | null;
  ip: string | null;
  result: string;
  error: string | null;
  createdAt: string;
  user: { username: string } | null;
  host: { name: string } | null;
};

export default function AuditPage() {
  const { t, locale } = useI18n();
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ["audit"],
    queryFn: () => api<{ logs: Log[] }>("/api/audit"),
    refetchInterval: 30_000,
    staleTime: 15_000,
    placeholderData: (previous) => previous,
  });
  const logs = data?.logs ?? [];

  return (
    <div className="space-y-4">
      <PageHeader
        kicker={t("page.security")}
        title={t("audit.title")}
        description={t("audit.description")}
      />
      <QueryGate isLoading={isLoading} error={error} onRetry={() => void refetch()}>
        {logs.length === 0 ? (
          <EmptyState title={t("audit.empty")} />
        ) : (
          <Card>
            <CardHeader>
              <CardTitle>{t("audit.events")}</CardTitle>
            </CardHeader>
            <CardContent className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-left text-xs uppercase text-muted-foreground">
                  <tr>
                    <th className="py-2">{t("audit.time")}</th>
                    <th>{t("audit.user")}</th>
                    <th>{t("audit.host")}</th>
                    <th>{t("audit.action")}</th>
                    <th>{t("audit.target")}</th>
                    <th>{t("audit.result")}</th>
                    <th>{t("audit.ip")}</th>
                  </tr>
                </thead>
                <tbody>
                  {logs.map((l) => (
                    <tr key={l.id} className="border-t border-border">
                      <td className="py-2">
                        {new Date(l.createdAt).toLocaleString(locale === "en" ? "en-GB" : "de-DE")}
                      </td>
                      <td>{l.user?.username ?? "—"}</td>
                      <td>{l.host?.name ?? "—"}</td>
                      <td>{l.action}</td>
                      <td>{l.target}</td>
                      <td>
                        <Badge variant={l.result === "SUCCESS" ? "success" : "danger"}>{l.result}</Badge>
                      </td>
                      <td>{l.ip}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </CardContent>
          </Card>
        )}
      </QueryGate>
    </div>
  );
}
