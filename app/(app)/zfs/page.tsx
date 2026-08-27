"use client";

import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { api } from "@/lib/api";
import { bytesToSize, cn } from "@/lib/utils";
import type { PublicHost } from "@/lib/types";
import { PageHeader } from "@/components/layout/page-header";

type ZfsDisk = {
  name: string;
  role: string;
  state: string;
  read: number;
  write: number;
  cksum: number;
  healthy: boolean;
};

type ZfsPool = {
  name: string;
  health: string;
  size: number;
  alloc: number;
  free: number;
  frag?: number;
  dedup?: number;
  healthSummary?: {
    allHealthy: boolean;
    healthyDisks: number;
    totalDisks: number;
    problemDisks: number;
    devices: ZfsDisk[];
  };
};

function poolTone(health: string, allHealthy: boolean) {
  const h = health.toUpperCase();
  if (allHealthy && h === "ONLINE") return "success" as const;
  if (h === "DEGRADED" || !allHealthy) return "warning" as const;
  return "danger" as const;
}

function diskDotClass(disk: ZfsDisk) {
  if (disk.healthy) return "bg-emerald-500";
  if (disk.state === "DEGRADED") return "bg-amber-400";
  return "bg-red-500";
}

export default function ZfsPage() {
  const { data: hosts } = useQuery({
    queryKey: ["hosts"],
    queryFn: () => api<{ hosts: PublicHost[] }>("/api/hosts"),
  });
  const { data } = useQuery({
    queryKey: ["zfs", hosts?.hosts.map((h) => h.id)],
    enabled: Boolean(hosts),
    queryFn: async () => {
      return Promise.all(
        (hosts?.hosts ?? []).map(async (h) => {
          try {
            const r = await api<{ zfs: Array<{ node: string; pools: ZfsPool[] }> }>(`/api/hosts/${h.id}/zfs`);
            return { host: h, ...r };
          } catch {
            return { host: h, zfs: [] as Array<{ node: string; pools: ZfsPool[] }>, error: true };
          }
        }),
      );
    },
  });

  return (
    <div className="space-y-4">
      <PageHeader
        kicker="Speicher"
        title="ZFS"
        description="Pool- und Plattenstatus. Grün = ONLINE ohne I/O-Fehler."
      />
      {(data ?? []).map((block) => (
        <Card key={block.host.id}>
          <CardHeader>
            <CardTitle>{block.host.name}</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-4 lg:grid-cols-2">
            {"error" in block && block.error ? <p className="text-sm text-destructive">Unable to load ZFS status.</p> : null}
            {block.zfs.flatMap((n) =>
              n.pools.map((pool) => {
                const summary = pool.healthSummary;
                const allHealthy = summary?.allHealthy ?? pool.health.toUpperCase() === "ONLINE";
                const tone = poolTone(pool.health, allHealthy);
                return (
                  <div key={`${n.node}-${pool.name}`} className="rounded-lg border border-border p-4">
                    <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                      <div>
                        <p className="font-medium">{pool.name}</p>
                        <p className="text-xs text-muted-foreground">Node {n.node}</p>
                      </div>
                      <Badge variant={tone}>{pool.health}</Badge>
                    </div>
                    <div
                      className={cn(
                        "mb-4 rounded-md px-3 py-2 text-sm font-medium",
                        allHealthy ? "bg-emerald-500/15 text-emerald-400" : "bg-amber-500/15 text-amber-300",
                      )}
                    >
                      {allHealthy
                        ? `Alle Platten grün${summary?.totalDisks ? ` · ${summary.healthyDisks}/${summary.totalDisks}` : ""}`
                        : `${summary?.problemDisks ?? "?"} Platte(n) nicht OK`}
                    </div>
                    <dl className="mb-4 grid grid-cols-2 gap-2 text-sm">
                      <dt className="text-muted-foreground">Size</dt>
                      <dd>{bytesToSize(pool.size)}</dd>
                      <dt className="text-muted-foreground">Used</dt>
                      <dd>{bytesToSize(pool.alloc)}</dd>
                      <dt className="text-muted-foreground">Free</dt>
                      <dd>{bytesToSize(pool.free)}</dd>
                      <dt className="text-muted-foreground">Frag</dt>
                      <dd>{pool.frag ?? "—"}%</dd>
                    </dl>
                    {summary?.devices.length ? (
                      <ul className="space-y-2">
                        {summary.devices.map((disk) => (
                          <li key={`${pool.name}-${disk.name}`} className="flex items-center justify-between gap-3 text-sm">
                            <span className="flex min-w-0 items-center gap-2">
                              <span className={cn("h-2.5 w-2.5 shrink-0 rounded-full", diskDotClass(disk))} />
                              <span className="truncate font-mono">{disk.name}</span>
                              <span className="text-xs text-muted-foreground">{disk.role}</span>
                            </span>
                            <span className="shrink-0 text-xs text-muted-foreground">
                              {disk.state}
                              {disk.read || disk.write || disk.cksum
                                ? ` · r${disk.read}/w${disk.write}/c${disk.cksum}`
                                : ""}
                            </span>
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <p className="text-xs text-muted-foreground">Keine VDEV-Details vom Host.</p>
                    )}
                  </div>
                );
              }),
            )}
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
