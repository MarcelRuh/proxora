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

type CpuTempConfig = { alertCelsius: number; clearCelsius: number };

export function CpuTempSection() {
  const { t } = useI18n();
  const qc = useQueryClient();
  const canEdit = useCan("settings.update");
  const { data } = useQuery({
    queryKey: ["cpu-temp"],
    queryFn: () => api<CpuTempConfig>("/api/cpu-temp"),
  });
  const [alertCelsius, setAlertCelsius] = useState<string>();
  const [clearCelsius, setClearCelsius] = useState<string>();
  const alertValue = alertCelsius ?? String(data?.alertCelsius ?? 85);
  const clearValue = clearCelsius ?? String(data?.clearCelsius ?? 75);

  async function save() {
    const next = await api<{ setting: CpuTempConfig }>("/api/cpu-temp", {
      method: "PATCH",
      body: JSON.stringify({
        alertCelsius: Number(alertValue),
        clearCelsius: Number(clearValue),
      }),
    });
    toast.success(t("settings.cpuTempSaved"));
    setAlertCelsius(String(next.setting.alertCelsius));
    setClearCelsius(String(next.setting.clearCelsius));
    await qc.invalidateQueries({ queryKey: ["cpu-temp"] });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("settings.cpuTempTitle")}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        <p className="text-muted-foreground">{t("settings.cpuTempBody")}</p>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1">
            <Label htmlFor="cpu-temp-alert">{t("settings.cpuTempAlert")}</Label>
            <Input
              id="cpu-temp-alert"
              type="number"
              min={40}
              max={120}
              disabled={!canEdit}
              value={alertValue}
              onChange={(e) => setAlertCelsius(e.target.value)}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="cpu-temp-clear">{t("settings.cpuTempClear")}</Label>
            <Input
              id="cpu-temp-clear"
              type="number"
              min={40}
              max={120}
              disabled={!canEdit}
              value={clearValue}
              onChange={(e) => setClearCelsius(e.target.value)}
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
