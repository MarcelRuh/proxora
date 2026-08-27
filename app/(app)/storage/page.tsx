"use client";

import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ProgressBar } from "@/components/ui/misc";
import { Badge } from "@/components/ui/badge";
import { api } from "@/lib/api";
import { bytesToSize, percentage } from "@/lib/utils";
import type { PublicHost } from "@/lib/types";
import { PageHeader } from "@/components/layout/page-header";
import { ZfsSection, type ZfsHostBlock } from "@/components/storage/zfs-section";

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
  const hostIds = hosts?.hosts.map((h) => h.id);
  const { data } = useQuery({
    queryKey: ["storage", hostIds],
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
  const { data: zfs } = useQuery({
    queryKey: ["zfs", hostIds],
    enabled: Boolean(hosts),
    queryFn: async () => {
      const rows = await Promise.all(
        (hosts?.hosts ?? []).map(async (h) => {
          try {
            const r = await api<{ zfs: ZfsHostBlock["zfs"] }>(`/api/hosts/${h.id}/zfs`);
            return { hostId: h.id, ...r } satisfies { hostId: string } & ZfsHostBlock;
          } catch {
            return { hostId: h.id, zfs: [], error: true };
          }
        }),
      );
      return rows;
    },
    refetchInterval: 30_000,
  });

  return (
    <div className="space-y-4">
      <PageHeader
        kicker="Speicher"
        title="Storage"
        description="Datastores und ZFS-Pools der verbundenen Hosts."
      />
      {(data ?? []).map((block) => (
        <Card key={block.host.id}>
          <CardHeader>
            <CardTitle>{block.host.name}</CardTitle>
          </CardHeader>
          <CardContent>
            {"error" in block && block.error ? (
              <p className="text-sm text-destructive">Storage für diesen Host konnte nicht geladen werden.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="font-[family-name:var(--font-display)] text-left text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
                    <tr>
                      <th className="py-2 font-medium">Name</th>
                      <th className="font-medium">Typ</th>
                      <th className="font-medium">Status</th>
                      <th className="font-medium">Inhalt</th>
                      <th className="font-medium">Belegt</th>
                      <th className="font-medium">Frei</th>
                      <th className="font-medium">Auslastung</th>
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
                              <Badge variant={s.active ? "success" : "danger"}>{s.active ? "aktiv" : "inaktiv"}</Badge>
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
              </div>
            )}
            <ZfsSection block={zfs?.find((row) => row.hostId === block.host.id)} />
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
