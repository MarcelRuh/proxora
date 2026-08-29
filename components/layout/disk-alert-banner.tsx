"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { useI18n } from "@/components/i18n/locale-provider";

type DiskAlertRow = { name: string; percent: number; href?: string; hostName: string };

export function DiskAlertBanner() {
  const { t } = useI18n();
  const { data } = useQuery({
    queryKey: ["disk-alerts"],
    queryFn: () => api<{ alertPercent: number; samples: DiskAlertRow[] }>("/api/disk-alerts"),
    refetchInterval: 60_000,
    retry: false,
  });
  const samples = data?.samples ?? [];
  if (!samples.length) return null;
  return (
    <div className="border-b border-warning/40 bg-warning/10 px-4 py-2 text-sm">
      <p className="font-medium text-warning">{t("disk.banner", { n: samples.length })}</p>
      <p className="text-xs text-muted-foreground">
        {samples
          .slice(0, 4)
          .map((s) => `${s.name} (${Math.round(s.percent)} %)`)
          .join(" · ")}
      </p>
      <Link href="/storage" className="text-xs text-primary">
        {t("disk.toStorage")}
      </Link>
    </div>
  );
}
