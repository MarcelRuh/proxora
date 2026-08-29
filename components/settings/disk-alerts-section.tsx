"use client";

import { useState } from "react";
import { toast } from "sonner";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input, Label } from "@/components/ui/input";
import { api } from "@/lib/api";
import { useCan } from "@/components/auth/session-user";
import { useI18n } from "@/components/i18n/locale-provider";

type DiskAlertConfig = { alertPercent: number; clearPercent: number };

export function DiskAlertsSection() {
  const { t } = useI18n();
  const qc = useQueryClient();
  const canEdit = useCan("settings.update");
  const { data } = useQuery({
    queryKey: ["disk-alerts"],
    queryFn: () => api<DiskAlertConfig>("/api/disk-alerts"),
  });
  const [alertPercent, setAlertPercent] = useState<string>();
  const [clearPercent, setClearPercent] = useState<string>();
  const alertValue = alertPercent ?? String(data?.alertPercent ?? 90);
  const clearValue = clearPercent ?? String(data?.clearPercent ?? 85);

  async function save() {
    const next = await api<{ setting: DiskAlertConfig }>("/api/disk-alerts", {
      method: "PATCH",
      body: JSON.stringify({
        alertPercent: Number(alertValue),
        clearPercent: Number(clearValue),
      }),
    });
    toast.success(t("settings.diskSaved"));
    setAlertPercent(String(next.setting.alertPercent));
    setClearPercent(String(next.setting.clearPercent));
    await qc.invalidateQueries({ queryKey: ["disk-alerts"] });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("settings.diskTitle")}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        <p className="text-muted-foreground">{t("settings.diskBody")}</p>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1">
            <Label htmlFor="disk-alert">{t("settings.diskAlert")}</Label>
            <Input
              id="disk-alert"
              type="number"
              min={1}
              max={99}
              disabled={!canEdit}
              value={alertValue}
              onChange={(e) => setAlertPercent(e.target.value)}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="disk-clear">{t("settings.diskClear")}</Label>
            <Input
              id="disk-clear"
              type="number"
              min={1}
              max={99}
              disabled={!canEdit}
              value={clearValue}
              onChange={(e) => setClearPercent(e.target.value)}
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
