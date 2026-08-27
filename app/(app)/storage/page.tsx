"use client";

import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ProgressBar } from "@/components/ui/misc";
import { Badge } from "@/components/ui/badge";
import { api } from "@/lib/api";
import { bytesToSize, percentage } from "@/lib/utils";
import type { PublicHost } from "@/lib/types";
import { PageHeader } from "@/components/layout/page-header";

type StorageResp = {
  storage: Array<{
    node: string;
    storage: Array<{
      storage: string;
      type: string;
      content?: string;
      active?: number;
      used?: number;
      avail?: number;
      total?: number;
    }>;
  }>;
};

export default function StoragePage() {
  const { data: hosts } = useQuery({
    queryKey: ["hosts"],
    queryFn: () => api<{ hosts: PublicHost[] }>("/api/hosts"),
  });
  const { data } = useQuery({
    queryKey: ["storage", hosts?.hosts.map((h) => h.id)],
    enabled: Boolean(hosts),
    queryFn: async () => {
      const rows = await Promise.all(
        (hosts?.hosts ?? []).map(async (h) => {
          try {
            const r = await api<StorageResp>(`/api/hosts/${h.id}/storage`);
            return { host: h, ...r };
          } catch {
            return { host: h, storage: [] as StorageResp["storage"], error: true };
          }
        }),
      );
      return rows;
    },
    refetchInterval: 30_000,
  });

  return (
    <div className="space-y-4">
      <PageHeader kicker="Speicher" title="Storage" />
      {(data ?? []).map((block) => (
        <Card key={block.host.id}>
          <CardHeader>
            <CardTitle>{block.host.name}</CardTitle>
          </CardHeader>
          <CardContent className="overflow-x-auto">
            {"error" in block ? (
              <p className="text-sm text-destructive">Unable to load storage for this host.</p>
            ) : (
              <table className="w-full text-sm">
                <thead className="text-left text-xs uppercase text-muted-foreground">
                  <tr>
                    <th className="py-2">Name</th>
                    <th>Type</th>
                    <th>Status</th>
                    <th>Content</th>
                    <th>Used</th>
                    <th>Free</th>
                    <th>Usage</th>
                  </tr>
                </thead>
                <tbody>
                  {block.storage.flatMap((n) =>
                    n.storage.map((s) => {
                      const pct = percentage(s.used, s.total);
                      return (
                        <tr key={`${n.node}-${s.storage}`} className="border-t border-border">
                          <td className="py-2">{s.storage}</td>
                          <td>{s.type}</td>
                          <td>
                            <Badge variant={s.active ? "success" : "danger"}>{s.active ? "active" : "inactive"}</Badge>
                          </td>
                          <td className="text-muted-foreground">{s.content}</td>
                          <td>{bytesToSize(s.used)}</td>
                          <td>{bytesToSize(s.avail)}</td>
                          <td className="w-40">
                            <ProgressBar value={pct} />
                          </td>
                        </tr>
                      );
                    }),
                  )}
                </tbody>
              </table>
            )}
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
