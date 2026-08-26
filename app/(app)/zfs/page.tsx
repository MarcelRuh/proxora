"use client";

import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { api } from "@/lib/api";
import { bytesToSize } from "@/lib/utils";
import type { PublicHost } from "@/lib/types";

function healthVariant(health: string) {
  const h = health.toUpperCase();
  if (h === "ONLINE") return "success" as const;
  if (h === "DEGRADED") return "warning" as const;
  return "danger" as const;
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
            const r = await api<{
              zfs: Array<{
                node: string;
                pools: Array<{
                  name: string;
                  health: string;
                  size: number;
                  alloc: number;
                  free: number;
                  frag?: number;
                  dedup?: number;
                  detail?: Record<string, unknown> | null;
                }>;
              }>;
            }>(`/api/hosts/${h.id}/zfs`);
            return { host: h, ...r };
          } catch {
            return { host: h, zfs: [], error: true };
          }
        }),
      );
    },
  });

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold">ZFS</h1>
        <p className="text-sm text-muted-foreground">Pool health is read-only in v1. Destructive pool actions are not exposed.</p>
      </div>
      {(data ?? []).map((block) => (
        <Card key={block.host.id}>
          <CardHeader>
            <CardTitle>{block.host.name}</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-4 md:grid-cols-2">
            {"error" in block ? <p className="text-sm text-destructive">Unable to load ZFS status.</p> : null}
            {block.zfs.flatMap((n) =>
              n.pools.map((pool) => (
                <div key={`${n.node}-${pool.name}`} className="rounded-lg border border-border p-4">
                  <div className="mb-2 flex items-center justify-between">
                    <p className="font-medium">{pool.name}</p>
                    <Badge variant={healthVariant(pool.health)}>{pool.health}</Badge>
                  </div>
                  <dl className="grid grid-cols-2 gap-2 text-sm">
                    <dt className="text-muted-foreground">Size</dt>
                    <dd>{bytesToSize(pool.size)}</dd>
                    <dt className="text-muted-foreground">Used</dt>
                    <dd>{bytesToSize(pool.alloc)}</dd>
                    <dt className="text-muted-foreground">Free</dt>
                    <dd>{bytesToSize(pool.free)}</dd>
                    <dt className="text-muted-foreground">Frag</dt>
                    <dd>{pool.frag ?? "—"}%</dd>
                    <dt className="text-muted-foreground">Dedup</dt>
                    <dd>{pool.dedup ?? "—"}</dd>
                  </dl>
                  {pool.detail ? (
                    <pre className="mt-3 max-h-48 overflow-auto rounded bg-muted p-2 text-[11px]">
                      {JSON.stringify(pool.detail, null, 2)}
                    </pre>
                  ) : null}
                </div>
              )),
            )}
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
