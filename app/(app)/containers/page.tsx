"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { GuestTable } from "@/components/guests/guest-table";
import { api } from "@/lib/api";
import type { Guest, PublicHost } from "@/lib/types";

export default function ContainersPage() {
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
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Containers</h1>
          <p className="text-sm text-muted-foreground">LXC containers across connected hosts.</p>
        </div>
        <Button asChild>
          <Link href="/containers/create">Create container</Link>
        </Button>
      </div>
      <GuestTable kind="lxc" items={data ?? []} />
    </div>
  );
}
