"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ConfirmAction } from "@/components/confirm-action";
import { api } from "@/lib/api";
import { useCan } from "@/components/auth/session-user";
import { useI18n } from "@/components/i18n/locale-provider";
import type { MessageKey } from "@/lib/i18n/messages";
import { markSelfUpdateActive, SELF_UPDATE_FLAG } from "@/components/layout/update-banner";

export type SelfUpdateStatus = {
  enabled: boolean;
  mode: string;
  sidecar: "ready" | "missing" | "host";
  currentVersion: string;
  sourceVersion: string | null;
  remoteVersion: string | null;
  localRevision: string | null;
  remoteRevision: string | null;
  updateAvailable: boolean;
  message: string;
  installDir: string | null;
  repo: string | null;
  branch: string | null;
  targetTag?: string | null;
  updating: boolean;
  progress: { percent: number; step: string; detail: string | null } | null;
  changelog: string | null;
  targetVersion: string | null;
  imageReady?: boolean | null;
  imageRef?: string | null;
};

function shortRev(value: string | null | undefined): string {
  if (!value) return "—";
  return value.length > 12 ? `${value.slice(0, 12)}…` : value;
}

type Translate = ReturnType<typeof useI18n>["t"];

/** Localize the server status line from structured fields; raw text only for error details. */
function statusLine(status: SelfUpdateStatus, t: Translate): string {
  if (status.updating) return t("proxora.msg.updating");
  if (status.sidecar === "missing") return t("proxora.msg.sidecarMissing");
  if (!status.enabled) return t("proxora.msg.unavailable");
  if (status.updateAvailable && status.imageReady === false) {
    return t("proxora.msg.imagePending", { v: status.targetVersion ?? "" });
  }
  if (status.updateAvailable) {
    return t("proxora.msg.available", { from: status.currentVersion, to: status.targetVersion ?? t("proxora.latest") });
  }
  if (/^GitHub check failed/i.test(status.message)) return status.message;
  if (/^Checking/i.test(status.message)) return t("proxora.msg.checking");
  return t("proxora.msg.upToDate");
}

export function SelfUpdateSection({ compact = false }: { compact?: boolean }) {
  const { t } = useI18n();
  const qc = useQueryClient();
  const canApply = useCan("proxora.update");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  useEffect(() => {
    const sync = () => {
      if (sessionStorage.getItem(SELF_UPDATE_FLAG) !== "1") setBusy(false);
    };
    window.addEventListener("proxora-update", sync);
    return () => window.removeEventListener("proxora-update", sync);
  }, []);

  const { data: status } = useQuery({
    queryKey: ["self-update"],
    queryFn: () => api<SelfUpdateStatus>("/api/system/self-update"),
    refetchInterval: (q) => {
      if (busy || q.state.data?.updating) return 1500;
      // Poll faster while waiting for GHCR to publish the release image.
      if (q.state.data?.updateAvailable && q.state.data.imageReady === false) return 15_000;
      return 60_000;
    },
  });

  const handleApply = async () => {
    setBusy(true);
    setError(null);
    setSuccess(null);
    markSelfUpdateActive(true);
    try {
      const result = await api<{ ok: boolean; message: string }>("/api/system/self-update", {
        method: "POST",
      });
      await qc.invalidateQueries({ queryKey: ["self-update"] });
      if (!result.ok) {
        setBusy(false);
        markSelfUpdateActive(false);
        setError(result.message);
        return;
      }
      setSuccess(result.message);
    } catch (err) {
      setBusy(false);
      markSelfUpdateActive(false);
      setError(err instanceof Error ? err.message : t("proxora.failed"));
      throw err;
    }
  };

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle>{t("proxora.cardTitle")}</CardTitle>
        {status?.updateAvailable ? (
          <Badge variant="warning">{t("proxora.available")}</Badge>
        ) : (
          <Badge variant="success">v{status?.currentVersion ?? "—"}</Badge>
        )}
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        {error ? <p className="text-destructive">{error}</p> : null}
        {success ? <p className="whitespace-pre-wrap text-success">{success}</p> : null}
        {status ? (
          <>
            <p className="text-muted-foreground" aria-live="polite">{statusLine(status, t)}</p>
            <div className="flex flex-wrap items-baseline gap-2 font-mono text-lg font-semibold">
              {status.updateAvailable ? (
                <>
                  <span>{status.currentVersion}</span>
                  <span className="text-muted-foreground">→</span>
                  <span className="text-primary">{status.targetVersion ?? "latest"}</span>
                </>
              ) : (
                <span>v{status.currentVersion}</span>
              )}
            </div>
            {!compact ? (
              <dl className="grid grid-cols-[minmax(7rem,max-content)_1fr] gap-x-6 gap-y-1 text-xs text-muted-foreground [&_dd]:min-w-0 [&_dd]:break-all [&_dd]:text-foreground">
                <dt>{t("proxora.repo")}</dt>
                <dd>
                  {status.repo}@{status.targetTag ?? status.branch}
                </dd>
                <dt>{t("proxora.installDir")}</dt>
                <dd>{status.installDir ?? "—"}</dd>
                <dt>{t("proxora.localRev")}</dt>
                <dd className="font-mono">{shortRev(status.localRevision)}</dd>
                <dt>{t("proxora.remoteRev")}</dt>
                <dd className="font-mono">{shortRev(status.remoteRevision)}</dd>
                <dt>{t("proxora.sidecar")}</dt>
                <dd>{t(`proxora.sidecar.${status.sidecar}` as MessageKey)}</dd>
              </dl>
            ) : null}
            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant="outline" onClick={() => void qc.invalidateQueries({ queryKey: ["self-update"] })}>
                {t("proxora.check")}
              </Button>
              {canApply ? (
                <Button size="sm" variant="outline" asChild>
                  <a href="/api/proxora/backup">{t("proxora.backup")}</a>
                </Button>
              ) : null}
              {canApply ? (
                status.updateAvailable && status.imageReady === false ? (
                  <Button size="sm" disabled title={status.message}>
                    {t("proxora.waitingImage")}
                  </Button>
                ) : status.updateAvailable ? (
                  <ConfirmAction
                    title={t("proxora.confirmTitle")}
                    description={`${t("proxora.confirmBody", {
                      from: status.currentVersion,
                      to: status.targetVersion ?? t("proxora.latest"),
                    })} ${t("proxora.confirmOverwrite")}`}
                    actionLabel={t("proxora.apply")}
                    onConfirm={handleApply}
                  >
                    <Button
                      size="sm"
                      disabled={busy || status.updating || status.sidecar === "missing"}
                    >
                      {busy || status.updating ? t("proxora.applying") : t("proxora.apply")}
                    </Button>
                  </ConfirmAction>
                ) : (
                  <Button size="sm" disabled title={status.message}>
                    {t("proxora.apply")}
                  </Button>
                )
              ) : null}
            </div>
            {!compact && status.changelog ? (
              <pre className="max-h-48 overflow-auto whitespace-pre-wrap rounded-md bg-muted p-3 text-xs">
                {status.changelog}
              </pre>
            ) : null}
          </>
        ) : (
          <p className="text-muted-foreground">{t("proxora.loading")}</p>
        )}
      </CardContent>
    </Card>
  );
}
