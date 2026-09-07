"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ConfirmAction } from "@/components/confirm-action";
import { api } from "@/lib/api";
import { useI18n } from "@/components/i18n/locale-provider";

type SessionRow = {
  id: string;
  ip: string | null;
  userAgent: string | null;
  createdAt: string;
  expiresAt: string;
  current: boolean;
};

export function SessionsSection() {
  const { t, locale } = useI18n();
  const qc = useQueryClient();
  const { data } = useQuery({
    queryKey: ["account-sessions"],
    queryFn: () => api<{ sessions: SessionRow[]; cookieMaxAge: number }>("/api/account/sessions"),
  });
  const revoke = useMutation({
    mutationFn: (id: string) => api(`/api/account/sessions/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      toast.success(t("settings.sessionRevoked"));
      void qc.invalidateQueries({ queryKey: ["account-sessions"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("settings.sessions")}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        <p className="text-muted-foreground">{t("settings.sessionsHint")}</p>
        {(data?.sessions ?? []).map((row) => (
          <div key={row.id} className="flex flex-wrap items-start justify-between gap-2 rounded-[4px] border border-border p-3">
            <div className="min-w-0">
              <p className="font-medium">
                {row.ip || t("settings.sessionUnknownIp")}
                {row.current ? ` · ${t("settings.sessionCurrent")}` : ""}
              </p>
              <p className="truncate text-xs text-muted-foreground">{row.userAgent || "—"}</p>
              <p className="text-xs text-muted-foreground">
                {new Date(row.createdAt).toLocaleString(locale === "en" ? "en-GB" : "de-DE")}
              </p>
            </div>
            {row.current ? null : (
              <ConfirmAction
                title={t("settings.sessionRevokeTitle")}
                description={t("settings.sessionRevokeBody")}
                actionLabel={t("settings.sessionRevoke")}
                destructive
                onConfirm={async () => {
                  await revoke.mutateAsync(row.id);
                }}
              >
                <Button size="sm" variant="destructive" disabled={revoke.isPending}>
                  {t("settings.sessionRevoke")}
                </Button>
              </ConfirmAction>
            )}
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
