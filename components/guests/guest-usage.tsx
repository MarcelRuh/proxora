"use client";

import { ProgressBar } from "@/components/ui/misc";
import { guestCpuPercent, guestSizeDetail, percentage } from "@/lib/utils";
import type { Guest } from "@/lib/types";
import { useI18n } from "@/components/i18n/locale-provider";

export function GuestUsageBar({ percent, detail }: { percent: number; detail?: string }) {
  const value = Number.isFinite(percent) ? percent : 0;
  return (
    <div className="min-w-[7.5rem] max-w-[12rem]">
      <div className="mb-1 whitespace-nowrap text-right text-[11px] tabular-nums text-muted-foreground">
        {detail ?? `${Math.round(value)}%`}
      </div>
      <ProgressBar value={value} />
    </div>
  );
}

export function GuestCpuBar({ guest }: { guest: Pick<Guest, "cpu" | "cpus"> }) {
  const { t } = useI18n();
  const pct = guestCpuPercent(guest.cpu, guest.cpus);
  const cores = guest.cpus || 0;
  const detail = cores
    ? `${t("dashboard.cores", { n: cores })} · ${Math.round(pct)}%`
    : `${Math.round(pct)}%`;
  return <GuestUsageBar percent={pct} detail={detail} />;
}

export function GuestRamBar({ guest }: { guest: Pick<Guest, "mem" | "maxmem"> }) {
  const pct = percentage(guest.mem, guest.maxmem);
  return <GuestUsageBar percent={pct} detail={guestSizeDetail(guest.mem, guest.maxmem)} />;
}

export function GuestDiskBar({ guest }: { guest: Pick<Guest, "disk" | "maxdisk"> }) {
  const pct = percentage(guest.disk, guest.maxdisk);
  return <GuestUsageBar percent={pct} detail={guestSizeDetail(guest.disk, guest.maxdisk)} />;
}
