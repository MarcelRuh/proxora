"use client";

import { Badge } from "@/components/ui/badge";
import { bytesToSize, cn } from "@/lib/utils";
import { useI18n } from "@/components/i18n/locale-provider";

export type ZfsDisk = {
  name: string;
  role: string;
  state: string;
  read: number;
  write: number;
  cksum: number;
  healthy: boolean;
};

export type ZfsPool = {
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

export type ZfsHostBlock = {
  zfs: Array<{ node: string; pools: ZfsPool[] }>;
  error?: boolean;
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

export function ZfsSection({ block }: { block?: ZfsHostBlock }) {
  const { t } = useI18n();
  if (!block || block.error) return null;
  const pools = block.zfs.flatMap((n) => n.pools.map((pool) => ({ node: n.node, pool })));
  if (pools.length === 0) return null;

  return (
    <div className="mt-6 space-y-3">
      <p className="proxora-section">{t("zfs.title")}</p>
      <div className="grid gap-4 lg:grid-cols-2">
        {pools.map(({ node, pool }) => {
          const summary = pool.healthSummary;
          const allHealthy = summary?.allHealthy ?? pool.health.toUpperCase() === "ONLINE";
          const tone = poolTone(pool.health, allHealthy);
          return (
            <div key={`${node}-${pool.name}`} className="rounded-[4px] border border-border p-4">
              <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                <div>
                  <p className="font-medium">{pool.name}</p>
                  <p className="text-xs text-muted-foreground">{t("zfs.node", { name: node })}</p>
                </div>
                <Badge variant={tone}>{pool.health}</Badge>
              </div>
              <div
                className={cn(
                  "mb-4 rounded-[4px] px-3 py-2 text-sm font-medium",
                  allHealthy ? "bg-emerald-500/15 text-emerald-400" : "bg-amber-500/15 text-amber-300",
                )}
              >
                {allHealthy
                  ? summary?.totalDisks
                    ? t("zfs.disksOkCount", { healthy: summary.healthyDisks, total: summary.totalDisks })
                    : t("zfs.disksOk")
                  : t("zfs.disksBad", { n: summary?.problemDisks ?? "?" })}
              </div>
              <dl className="mb-4 grid grid-cols-2 gap-2 text-sm">
                <dt className="text-muted-foreground">{t("zfs.size")}</dt>
                <dd>{bytesToSize(pool.size)}</dd>
                <dt className="text-muted-foreground">{t("zfs.used")}</dt>
                <dd>{bytesToSize(pool.alloc)}</dd>
                <dt className="text-muted-foreground">{t("zfs.free")}</dt>
                <dd>{bytesToSize(pool.free)}</dd>
                <dt className="text-muted-foreground">{t("zfs.frag")}</dt>
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
                <p className="text-xs text-muted-foreground">{t("zfs.noVdevs")}</p>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
