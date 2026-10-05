"use client";

import { useState } from "react";
import { toast } from "sonner";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input, Label } from "@/components/ui/input";
import { api } from "@/lib/api";
import type { SuiteEmbeds } from "@/lib/suite-embeds";
import { useCan } from "@/components/auth/session-user";
import { useI18n } from "@/components/i18n/locale-provider";

export function SuiteEmbedsSection() {
  const { t } = useI18n();
  const qc = useQueryClient();
  const canEdit = useCan("settings.update");
  const { data } = useQuery({
    queryKey: ["embeds"],
    queryFn: () => api<SuiteEmbeds>("/api/embeds"),
  });
  const [dockora, setDockora] = useState<string>();
  const [sambora, setSambora] = useState<string>();
  const dockoraValue = dockora ?? data?.dockora ?? "";
  const samboraValue = sambora ?? data?.sambora ?? "";

  async function save() {
    try {
      const next = await api<SuiteEmbeds>("/api/embeds", {
        method: "PATCH",
        body: JSON.stringify({ dockora: dockoraValue, sambora: samboraValue }),
      });
      setDockora(next.dockora ?? "");
      setSambora(next.sambora ?? "");
      await qc.invalidateQueries({ queryKey: ["embeds"] });
      toast.success(t("settings.suiteSaved"));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("common.failed"));
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("settings.suiteTitle")}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        <p className="text-muted-foreground">{t("settings.suiteBody")}</p>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1">
            <Label htmlFor="suite-dockora">{t("nav.dockora")}</Label>
            <Input
              id="suite-dockora"
              type="url"
              inputMode="url"
              placeholder="https://dockora.lan:3000"
              disabled={!canEdit}
              value={dockoraValue}
              onChange={(event) => setDockora(event.target.value)}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="suite-sambora">{t("nav.sambora")}</Label>
            <Input
              id="suite-sambora"
              type="url"
              inputMode="url"
              placeholder="https://sambora.lan"
              disabled={!canEdit}
              value={samboraValue}
              onChange={(event) => setSambora(event.target.value)}
            />
          </div>
        </div>
        {canEdit ? (
          <Button type="button" size="sm" onClick={() => void save()}>
            {t("common.save")}
          </Button>
        ) : null}
      </CardContent>
    </Card>
  );
}
