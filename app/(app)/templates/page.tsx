"use client";

import { useQuery } from "@tanstack/react-query";
import { useRouter, useSearchParams } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/api";
import type { PublicHost } from "@/lib/types";
import { PageHeader } from "@/components/layout/page-header";
import { useI18n } from "@/components/i18n/locale-provider";
import { useCan } from "@/components/auth/session-user";
import { LxcTemplatePanel } from "@/components/templates/lxc-template-panel";
import { IsoImagePanel } from "@/components/templates/iso-image-panel";
import { cn } from "@/lib/utils";

export default function TemplatesPage() {
  const { t } = useI18n();
  const router = useRouter();
  const search = useSearchParams();
  const canLxc = useCan("lxc.create");
  const canVm = useCan("vm.create");
  const requested = search.get("tab") === "iso" ? "iso" : "lxc";
  const tab = requested === "iso" && canVm ? "iso" : canLxc ? "lxc" : "iso";
  const hostFilter = search.get("host") ?? "";

  const { data: hosts } = useQuery({
    queryKey: ["hosts"],
    queryFn: () => api<{ hosts: PublicHost[] }>("/api/hosts"),
  });

  const allHosts = hosts?.hosts ?? [];
  const list =
    hostFilter && allHosts.some((host) => host.id === hostFilter)
      ? allHosts.filter((host) => host.id === hostFilter)
      : allHosts;

  function setTab(next: "lxc" | "iso") {
    const params = new URLSearchParams(search.toString());
    params.set("tab", next);
    router.replace(`/templates?${params.toString()}`);
  }

  return (
    <div className="space-y-4">
      <PageHeader
        kicker={t("vms.kicker")}
        title={t("tmpl.title")}
        description={t("tmpl.description")}
      />
      {canLxc && canVm ? (
        <div className="flex flex-wrap gap-2">
          <Button variant={tab === "lxc" ? "default" : "outline"} onClick={() => setTab("lxc")}>
            {t("tmpl.tabLxc")}
          </Button>
          <Button variant={tab === "iso" ? "default" : "outline"} onClick={() => setTab("iso")}>
            {t("tmpl.tabIso")}
          </Button>
        </div>
      ) : null}
      {list.map((host) => (
        <Card key={host.id} id={`host-${host.id}`} className={cn(hostFilter === host.id && "ring-1 ring-primary/40")}>
          <CardHeader>
            <CardTitle>{host.name}</CardTitle>
          </CardHeader>
          <CardContent>
            {tab === "iso" ? <IsoImagePanel hostId={host.id} /> : <LxcTemplatePanel hostId={host.id} />}
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
