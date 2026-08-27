"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { GuestTable } from "@/components/guests/guest-table";
import { api } from "@/lib/api";
import type { Guest, PublicHost } from "@/lib/types";
import { PageHeader } from "@/components/layout/page-header";

export default function VmsPage() {
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
        kicker="Virtualisierung"
        title="VMs"
        description="Alle QEMU-Gäste auf verbundenen Hosts."
        actions={
          <Button asChild>
            <Link href="/vms/create">VM erstellen</Link>
          </Button>
        }
      />
      <GuestTable kind="vm" items={data ?? []} />
    </div>
  );
}
