"use client";

import { useState } from "react";
import { toast } from "sonner";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input, Label } from "@/components/ui/input";
import { api } from "@/lib/api";
import type { SuiteApp, SuiteEmbeds } from "@/lib/suite-embeds";
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
  const [draft, setDraft] = useState<SuiteApp[] | null>(null);
  const apps = draft ?? data?.apps ?? [];

  function edit(next: SuiteApp[]) {
    setDraft(next);
  }

  async function save() {
    try {
      const next = await api<SuiteEmbeds>("/api/embeds", {
        method: "PATCH",
        body: JSON.stringify({ apps }),
      });
      setDraft(next.apps);
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
        {apps.length === 0 ? <p className="text-muted-foreground">{t("settings.suiteEmpty")}</p> : null}
        <div className="space-y-3">
          {apps.map((app, index) => (
            <div key={app.id || `new-${index}`} className="space-y-2">
              <div className="grid gap-2 sm:grid-cols-[minmax(0,12rem)_1fr_auto]">
                <div className="space-y-1">
                  <Label htmlFor={`suite-name-${index}`}>{t("settings.suiteName")}</Label>
                  <Input
                    id={`suite-name-${index}`}
                    value={app.name}
                    disabled={!canEdit}
                    maxLength={48}
                    onChange={(event) => {
                      const next = [...apps];
                      next[index] = { ...app, name: event.target.value };
                      edit(next);
                    }}
                  />
                </div>
                <div className="space-y-1">
                  <Label htmlFor={`suite-url-${index}`}>{t("settings.suiteAddress")}</Label>
                  <Input
                    id={`suite-url-${index}`}
                    type="url"
                    inputMode="url"
                    placeholder="https://app.lan"
                    disabled={!canEdit}
                    value={app.url}
                    onChange={(event) => {
                      const next = [...apps];
                      const url = event.target.value;
                      next[index] = { ...app, url, insecureTls: url.trim().toLowerCase().startsWith("https:") ? app.insecureTls : undefined };
                      edit(next);
                    }}
                  />
                </div>
                {canEdit ? (
                  <Button
                    type="button"
                    variant="outline"
                    className="self-end"
                    onClick={() => edit(apps.filter((_, item) => item !== index))}
                  >
                    {t("settings.remove")}
                  </Button>
                ) : null}
              </div>
              {app.url.trim().toLowerCase().startsWith("https:") ? (
                <label className="flex items-center gap-2 text-sm" htmlFor={`suite-tls-${index}`}>
                  <input
                    id={`suite-tls-${index}`}
                    type="checkbox"
                    checked={app.insecureTls === true}
                    disabled={!canEdit}
                    onChange={(event) => {
                      const next = [...apps];
                      next[index] = { ...app, insecureTls: event.target.checked };
                      edit(next);
                    }}
                  />
                  {t("settings.suiteInsecure")}
                </label>
              ) : null}
            </div>
          ))}
        </div>
        {canEdit ? (
          <div className="flex flex-wrap gap-2">
            <Button type="button" size="sm" variant="outline" onClick={() => edit([...apps, { id: "", name: "", url: "" }])}>
              {t("settings.suiteAdd")}
            </Button>
            <Button type="button" size="sm" onClick={() => void save()}>
              {t("common.save")}
            </Button>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
