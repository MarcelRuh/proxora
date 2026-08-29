"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ProgressBar } from "@/components/ui/misc";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/api";
import { bytesToSize, percentage } from "@/lib/utils";
import type { PublicHost } from "@/lib/types";
import { PageHeader } from "@/components/layout/page-header";
import { useI18n } from "@/components/i18n/locale-provider";
import { ZfsSection, type ZfsHostBlock } from "@/components/storage/zfs-section";
import { DownloadLxcTemplateDialog } from "@/components/templates/download-lxc-dialog";
import { useCan } from "@/components/auth/session-user";

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
  const { t } = useI18n();
  const canDownloadTemplates = useCan("lxc.create");
  const [templateHostId, setTemplateHostId] = useState<string | null>(null);
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
        kicker={t("page.storage")}
        title={t("storage.title")}
        description={t("storage.description")}
      />
      {(data ?? []).map((block) => (
        <Card key={block.host.id}>
          <CardHeader className="flex flex-row items-center justify-between gap-3 space-y-0">
            <CardTitle>{block.host.name}</CardTitle>
            {canDownloadTemplates ? (
              <Button type="button" variant="outline" size="sm" onClick={() => setTemplateHostId(block.host.id)}>
                {t("tmpl.download")}
              </Button>
            ) : null}
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
                        return (
                          <tr key={`${n.node}-${s.storage}`} className="border-t border-border">
                            <td className="py-2">{s.storage}</td>
                            <td>{s.type}</td>
                            <td>
                              <Badge variant={s.active ? "success" : "danger"}>
                                {s.active ? t("settings.enabled") : t("settings.disabled")}
                              </Badge>
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
      {templateHostId ? (
        <DownloadLxcTemplateDialog
          hostId={templateHostId}
          open={Boolean(templateHostId)}
          onOpenChange={(next) => {
            if (!next) setTemplateHostId(null);
          }}
        />
      ) : null}
    </div>
  );
}
