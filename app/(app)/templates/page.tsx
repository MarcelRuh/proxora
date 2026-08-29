"use client";

import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { api } from "@/lib/api";
import type { PublicHost } from "@/lib/types";
import { PageHeader } from "@/components/layout/page-header";
import { useI18n } from "@/components/i18n/locale-provider";
import { LxcTemplatePanel } from "@/components/templates/lxc-template-panel";

export default function TemplatesPage() {
  const { t } = useI18n();
  const { data: hosts } = useQuery({
    queryKey: ["hosts"],
    queryFn: () => api<{ hosts: PublicHost[] }>("/api/hosts"),
  });

  return (
    <div className="space-y-4">
      <PageHeader
        kicker={t("vms.kicker")}
        title={t("tmpl.title")}
        description={t("tmpl.description")}
      />
      {(hosts?.hosts ?? []).map((host) => (
        <Card key={host.id}>
          <CardHeader>
            <CardTitle>{host.name}</CardTitle>
          </CardHeader>
          <CardContent>
            <LxcTemplatePanel hostId={host.id} />
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
