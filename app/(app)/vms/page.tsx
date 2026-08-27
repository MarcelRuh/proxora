"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { GuestTable } from "@/components/guests/guest-table";
import { api } from "@/lib/api";
import type { Guest, PublicHost } from "@/lib/types";
import { PageHeader } from "@/components/layout/page-header";
import { useI18n } from "@/components/i18n/locale-provider";
import { useCan } from "@/components/auth/session-user";

export default function VmsPage() {
  const { t } = useI18n();
  const canCreate = useCan("vm.create");
  const { data: hosts } = useQuery({
    queryKey: ["hosts"],
    queryFn: () => api<{ hosts: PublicHost[] }>("/api/hosts"),
  });
  const { data } = useQuery({
    queryKey: ["all-vms", hosts?.hosts.map((h) => h.id)],
    enabled: Boolean(hosts),
    queryFn: async () => {
      const lists = await Promise.all(
        (hosts?.hosts ?? []).map(async (h) => {
          try {
            const r = await api<{ vms: Guest[] }>(`/api/hosts/${h.id}/vms`);
            return r.vms.map((vm) => ({ ...vm, hostId: h.id, hostName: h.name }));
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
        title={t("vms.title")}
        description={t("vms.description")}
        actions={
          canCreate ? (
            <Button asChild>
              <Link href="/vms/create">{t("vms.create")}</Link>
            </Button>
          ) : undefined
        }
      />
      <GuestTable kind="vm" items={data ?? []} />
    </div>
  );
}
