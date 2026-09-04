"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ProgressBar } from "@/components/ui/misc";
import { Badge } from "@/components/ui/badge";
import { api } from "@/lib/api";
import { bytesToSize, percentage } from "@/lib/utils";
import type { PublicHost } from "@/lib/types";
import { PageHeader } from "@/components/layout/page-header";
import { QueryGate } from "@/components/layout/query-gate";
import { EmptyState } from "@/components/ui/misc";
import { useI18n } from "@/components/i18n/locale-provider";
import { ZfsSection, type ZfsHostBlock } from "@/components/storage/zfs-section";
import { StorageContentPanel } from "@/components/storage/storage-content-panel";

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

type OpenStorage = { hostId: string; node: string; storage: string };

export default function StoragePage() {
  const { t } = useI18n();
  const [open, setOpen] = useState<OpenStorage | null>(null);
  const { data: hosts, isPending: hostsPending, error: hostsError, refetch: refetchHosts } = useQuery({
    queryKey: ["hosts"],
    queryFn: () => api<{ hosts: PublicHost[] }>("/api/hosts"),
  });
  const hostIds = hosts?.hosts.map((h) => h.id);
  const hasHosts = Boolean(hosts?.hosts.length);
  const { data, isPending } = useQuery({
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
    refetchInterval: 60_000,
    staleTime: 20_000,
    placeholderData: (previous) => previous,
  });
  const { data: diskAlerts } = useQuery({
    queryKey: ["disk-alerts"],
    queryFn: () => api<{ alertPercent: number }>("/api/disk-alerts"),
    refetchInterval: 60_000,
    retry: false,
  });
  const alertAt = diskAlerts?.alertPercent ?? 90;
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
    refetchInterval: 60_000,
    staleTime: 20_000,
    placeholderData: (previous) => previous,
  });

  return (
    <div className="space-y-4">
      <PageHeader
        kicker={t("page.storage")}
        title={t("storage.title")}
        description={t("storage.description")}
      />
      <QueryGate isLoading={hostsPending || (hasHosts && isPending)} error={hostsError} onRetry={() => void refetchHosts()}>
        {!hasHosts ? (
          <EmptyState title={t("storage.empty")} description={t("storage.emptyBody")} />
        ) : (
          <div className="space-y-4">
          {(data ?? []).map((block) => (
        <Card key={block.host.id}>
          <CardHeader>
            <CardTitle>{block.host.name}</CardTitle>
          </CardHeader>
          <CardContent>
            {"error" in block && block.error ? (
              <p className="text-sm text-destructive">{t("storage.loadError")}</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="font-[family-name:var(--font-display)] text-left text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
                    <tr>
                      <th className="py-2 font-medium">{t("table.name")}</th>
                      <th className="font-medium">{t("table.type")}</th>
                      <th className="font-medium">{t("table.status")}</th>
                      <th className="font-medium">{t("storage.content")}</th>
                      <th className="font-medium">{t("zfs.used")}</th>
                      <th className="font-medium">{t("zfs.free")}</th>
                      <th className="font-medium">{t("storage.usage")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {block.storage.flatMap((n) =>
                      n.storage.map((s) => {
                        const pct = percentage(s.used, s.total);
                        const selected =
                          open?.hostId === block.host.id && open.node === n.node && open.storage === s.storage;
                        return (
                          <tr
                            key={`${n.node}-${s.storage}`}
                            className={`cursor-pointer border-t border-border ${selected ? "bg-primary/5" : "hover:bg-white/[0.03]"}`}
                            onClick={() =>
                              setOpen(selected ? null : { hostId: block.host.id, node: n.node, storage: s.storage })
                            }
                          >
                            <td className="py-2">
                              <button type="button" className="text-left font-medium text-primary hover:underline">
                                {s.storage}
                              </button>
                              <p className="text-[11px] text-muted-foreground">{t("storage.browse")}</p>
                            </td>
                            <td>{s.type}</td>
                            <td>
                              <div className="flex items-center gap-2">
                                {s.active ? (
                                  <Badge variant="success">{t("settings.enabled")}</Badge>
                                ) : (
                                  <Badge variant="danger">{t("settings.disabled")}</Badge>
                                )}
                                {s.active && pct >= alertAt ? <Badge variant="warning">{t("disk.fullBadge")}</Badge> : null}
                              </div>
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
            {open?.hostId === block.host.id ? (
              <StorageContentPanel
                hostId={open.hostId}
                node={open.node}
                storage={open.storage}
                onClose={() => setOpen(null)}
              />
            ) : null}
            <ZfsSection block={zfs?.find((row) => row.hostId === block.host.id)} />
          </CardContent>
        </Card>
          ))}
          </div>
        )}
      </QueryGate>
    </div>
  );
}
