"use client";

import { Suspense, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useRouter, useSearchParams } from "next/navigation";
import { api } from "@/lib/api";
import type { PublicHost } from "@/lib/types";
import { PageHeader } from "@/components/layout/page-header";
import { PageSkeleton } from "@/components/layout/page-skeleton";
import { useI18n } from "@/components/i18n/locale-provider";
import { useCan } from "@/components/auth/session-user";
import { CommunityScriptsPanel } from "@/components/community-scripts/community-scripts-panel";

export default function CommunityScriptsPage() {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <CommunityScriptsContent />
    </Suspense>
  );
}

function CommunityScriptsContent() {
  const { t } = useI18n();
  const router = useRouter();
  const search = useSearchParams();
  const canView = useCan("hosts.view");
  const { data: hosts } = useQuery({
    queryKey: ["hosts"],
    queryFn: () => api<{ hosts: PublicHost[] }>("/api/hosts"),
    enabled: canView,
  });

  const allHosts = hosts?.hosts ?? [];
  const hostFilter = search.get("host") ?? "";
  const activeHostId = useMemo(() => {
    if (hostFilter && allHosts.some((host) => host.id === hostFilter)) return hostFilter;
    return allHosts[0]?.id ?? "";
  }, [allHosts, hostFilter]);

  function setHost(id: string) {
    const params = new URLSearchParams(search.toString());
    if (id) params.set("host", id);
    else params.delete("host");
    router.replace(`/community-scripts?${params.toString()}`);
  }

  if (!canView) {
    return (
      <div className="p-6 text-sm text-muted-foreground">{t("hosts.terminalForbidden")}</div>
    );
  }

  return (
    <div className="space-y-4">
      <PageHeader
        kicker={t("vms.kicker")}
        title={t("cs.title")}
        description={t("cs.description")}
      />
      <CommunityScriptsPanel hosts={allHosts} hostId={activeHostId} onHostChange={setHost} />
    </div>
  );
}
