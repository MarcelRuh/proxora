"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { GuestTable } from "@/components/guests/guest-table";
import { api } from "@/lib/api";
import type { Guest, PublicHost } from "@/lib/types";
import { PageHeader } from "@/components/layout/page-header";
import { useI18n } from "@/components/i18n/locale-provider";

export default function ContainersPage() {
  const { t } = useI18n();
  const { data: hosts } = useQuery({
    queryKey: ["hosts"],
    queryFn: () => api<{ hosts: PublicHost[] }>("/api/hosts"),
  });
  const { data } = useQuery({
    queryKey: ["all-lxc", hosts?.hosts.map((h) => h.id)],
    enabled: Boolean(hosts),
    queryFn: async () => {
      const lists = await Promise.all(
        (hosts?.hosts ?? []).map(async (h) => {
          try {
            const r = await api<{ containers: Guest[] }>(`/api/hosts/${h.id}/lxc`);
            return r.containers.map((ct) => ({ ...ct, hostId: h.id, hostName: h.name }));
          } catch {
            return [] as Guest[];
          }
        }),
      );
      return lists.flat();
    },
    refetchInterval: 10_000,
  });

  return (
    <div className="space-y-4">
      <PageHeader
        kicker={t("vms.kicker")}
        title={t("lxc.title")}
        description={t("lxc.description")}
        actions={
          <Button asChild>
            <Link href="/containers/create">{t("lxc.create")}</Link>
          </Button>
        }
      />
      <GuestTable kind="lxc" items={data ?? []} />
    </div>
  );
}
