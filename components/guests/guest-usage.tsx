"use client";

import { ProgressBar } from "@/components/ui/misc";
import { percentage } from "@/lib/utils";
import type { Guest } from "@/lib/types";

export function guestCpuPercent(g: Pick<Guest, "cpu" | "cpus">): number {
  const cores = g.cpus || 0;
  const raw = cores > 0 ? (g.cpu / cores) * 100 : g.cpu * 100;
  if (!Number.isFinite(raw)) return 0;
  return Math.max(0, Math.min(100, raw));
}

export function GuestUsageBar({ percent, detail }: { percent: number; detail?: string }) {
  const value = Number.isFinite(percent) ? percent : 0;
  return (
    <div className="min-w-[6.5rem] max-w-[10rem]">
      <div className="mb-1 text-right text-[11px] tabular-nums text-muted-foreground">
        {detail ?? `${Math.round(value)}%`}
      </div>
      <ProgressBar value={value} />
    </div>
  );
}

export function GuestCpuBar({ guest }: { guest: Pick<Guest, "cpu" | "cpus"> }) {
  const pct = guestCpuPercent(guest);
  return <GuestUsageBar percent={pct} detail={`${Math.round(pct)}%`} />;
}

export function GuestRamBar({ guest }: { guest: Pick<Guest, "mem" | "maxmem"> }) {
  const pct = percentage(guest.mem, guest.maxmem);
  return <GuestUsageBar percent={pct} />;
}
