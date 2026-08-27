"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";

export type AptSummary = {
  total: number;
  fingerprint: string;
  checkedAt: string | Date | null;
  hosts: Array<{ id: string; name: string; count: number; checkedAt: string | Date | null }>;
};

export function useAptSummary() {
  return useQuery({
    queryKey: ["apt-summary"],
    queryFn: () => api<AptSummary>("/api/updates/summary"),
    refetchInterval: 60_000,
    retry: false,
  });
}

export function AptUpdateBanner() {
  const pathname = usePathname();
  const { data } = useAptSummary();
  const [hidden, setHidden] = useState(false);

  useEffect(() => {
    if (!data?.total || !data.fingerprint) return;
    const toastKey = `proxora-apt-toast:${data.fingerprint}`;
    if (typeof sessionStorage !== "undefined" && !sessionStorage.getItem(toastKey)) {
      sessionStorage.setItem(toastKey, "1");
      const names = data.hosts
        .filter((h) => h.count > 0)
        .map((h) => `${h.name} (${h.count})`)
        .join(", ");
      toast.warning(`${data.total} Host-Update${data.total === 1 ? "" : "s"} verfügbar`, {
        description: names,
        duration: 12_000,
      });
    }
    const bannerKey = `proxora-apt-banner:${data.fingerprint}`;
    setHidden(typeof sessionStorage !== "undefined" && sessionStorage.getItem(bannerKey) === "1");
  }, [data?.fingerprint, data?.total, data?.hosts]);

  if (!data?.total || hidden || pathname === "/updates") return null;

  const names = data.hosts
    .filter((h) => h.count > 0)
    .map((h) => h.name)
    .join(", ");

  function dismiss() {
    if (data?.fingerprint && typeof sessionStorage !== "undefined") {
      sessionStorage.setItem(`proxora-apt-banner:${data.fingerprint}`, "1");
    }
    setHidden(true);
  }

  return (
    <div className="flex flex-wrap items-center gap-3 border-b border-warning/35 bg-warning/10 px-4 py-2 text-sm">
      <p className="min-w-0 flex-1">
        <span className="font-[family-name:var(--font-display)] text-[10px] tracking-[0.22em] text-warning">
          Update-Hinweise
        </span>
        <span className="ml-3 font-medium text-warning">
          {data.total} Update{data.total === 1 ? "" : "s"} verfügbar
        </span>
        <span className="text-muted-foreground"> · {names}</span>
      </p>
      <Button size="sm" variant="outline" asChild>
        <Link href="/updates">Anzeigen</Link>
      </Button>
      <Button size="sm" variant="ghost" onClick={dismiss}>
        Schließen
      </Button>
    </div>
  );
}
