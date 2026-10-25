"use client";

import { Suspense, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useRouter, useSearchParams } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/api";
import type { PublicHost } from "@/lib/types";
import { PageHeader } from "@/components/layout/page-header";
import { PageSkeleton } from "@/components/layout/page-skeleton";
import { useI18n } from "@/components/i18n/locale-provider";
import { useCan } from "@/components/auth/session-user";
import { LxcTemplatePanel } from "@/components/templates/lxc-template-panel";
import { IsoImagePanel } from "@/components/templates/iso-image-panel";

const selectClass = "h-9 rounded-[4px] border border-input bg-white/[0.03] px-2 text-sm";

export default function TemplatesPage() {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <TemplatesContent />
    </Suspense>
  );
}

function TemplatesContent() {
  const { t } = useI18n();
  const router = useRouter();
  const search = useSearchParams();
  const canLxc = useCan("lxc.create");
  const canVm = useCan("vm.create");
  const requested = search.get("tab") === "iso" ? "iso" : "lxc";
  const tab = requested === "iso" && canVm ? "iso" : canLxc ? "lxc" : "iso";

  const { data: hosts } = useQuery({
    queryKey: ["hosts"],
    queryFn: () => api<{ hosts: PublicHost[] }>("/api/hosts"),
  });

  const allHosts = hosts?.hosts ?? [];
  const hostFilter = search.get("host") ?? "";
  const activeHostId = useMemo(() => {
    if (hostFilter && allHosts.some((host) => host.id === hostFilter)) return hostFilter;
    return allHosts[0]?.id ?? "";
  }, [allHosts, hostFilter]);
  const activeHost = allHosts.find((host) => host.id === activeHostId) ?? null;

  function setTab(next: "lxc" | "iso") {
    const params = new URLSearchParams(search.toString());
    params.set("tab", next);
    router.replace(`/templates?${params.toString()}`);
  }

  function setHost(id: string) {
    const params = new URLSearchParams(search.toString());
    if (id) params.set("host", id);
    else params.delete("host");
    router.replace(`/templates?${params.toString()}`);
  }

  return (
    <div className="space-y-4">
      <PageHeader
        kicker={t("vms.kicker")}
        title={t("tmpl.title")}
        description={t("tmpl.description")}
      />
      <div className="flex flex-wrap items-center gap-2">
        {canLxc && canVm ? (
          <>
            <Button variant={tab === "lxc" ? "default" : "outline"} onClick={() => setTab("lxc")}>
              {t("tmpl.tabLxc")}
            </Button>
            <Button variant={tab === "iso" ? "default" : "outline"} onClick={() => setTab("iso")}>
              {t("tmpl.tabIso")}
            </Button>
          </>
        ) : null}
        {allHosts.length > 1 ? (
          <select
            className={selectClass}
            value={activeHostId}
            aria-label={t("tmpl.selectHost")}
            onChange={(event) => setHost(event.target.value)}
          >
            {allHosts.map((host) => (
              <option key={host.id} value={host.id}>
                {host.name}
              </option>
            ))}
          </select>
        ) : null}
      </div>
      {activeHost ? (
        <Card key={activeHost.id} id={`host-${activeHost.id}`}>
          <CardHeader>
            <CardTitle>{activeHost.name}</CardTitle>
          </CardHeader>
          <CardContent>
            {tab === "iso" ? <IsoImagePanel hostId={activeHost.id} /> : <LxcTemplatePanel hostId={activeHost.id} />}
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
