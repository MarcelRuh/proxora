"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input, Label } from "@/components/ui/input";
import { api } from "@/lib/api";
import { useI18n } from "@/components/i18n/locale-provider";

export function NotificationsSection() {
  const { t } = useI18n();
  const qc = useQueryClient();
  const { data } = useQuery({
    queryKey: ["notifications"],
    queryFn: () => api<{ channels: Array<{ id: string; type: string; name: string; enabled: boolean }> }>("/api/notifications"),
  });
  const [form, setForm] = useState({ name: "Discord", url: "" });
  const create = useMutation({
    mutationFn: () =>
      api("/api/notifications", {
        method: "POST",
        body: JSON.stringify({ type: "discord", name: form.name, config: { url: form.url } }),
      }),
    onSuccess: () => {
      toast.success(t("settings.channelSaved"));
      setForm({ name: "Discord", url: "" });
      void qc.invalidateQueries({ queryKey: ["notifications"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>{t("settings.channels")}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          {(data?.channels ?? []).map((c) => (
            <div key={c.id} className="flex justify-between">
              <span>
                {c.name} · {c.type}
              </span>
              <span>{c.enabled ? t("settings.enabled") : t("settings.disabled")}</span>
            </div>
          ))}
          {(data?.channels ?? []).length === 0 ? <p className="text-muted-foreground">{t("settings.noChannels")}</p> : null}
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>{t("settings.addWebhook")}</CardTitle>
        </CardHeader>
        <CardContent className="grid max-w-md gap-3">
          <div className="space-y-1">
            <Label>{t("create.name")}</Label>
            <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          </div>
          <div className="space-y-1">
            <Label>Discord / webhook URL</Label>
            <Input value={form.url} onChange={(e) => setForm({ ...form, url: e.target.value })} />
          </div>
          <Button onClick={() => create.mutate()} disabled={create.isPending || !form.url}>
            {t("settings.saveChannel")}
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
