"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ProgressBar } from "@/components/ui/misc";
import { ConfirmAction } from "@/components/confirm-action";
import { api } from "@/lib/api";
import { useCan } from "@/components/auth/session-user";
import { useI18n } from "@/components/i18n/locale-provider";
import type { MessageKey } from "@/lib/i18n/messages";

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
};

const STEP_IDS = new Set([
  "cleanup",
  "start",
  "resolve",
  "sync",
  "build",
  "buildWeb",
  "export",
  "startWeb",
  "finalize",
  "done",
  "error",
  "apply",
]);

function shortRev(value: string | null | undefined): string {
  if (!value) return "—";
  return value.length > 12 ? `${value.slice(0, 12)}…` : value;
}

async function waitForHealth(timeoutMs = 180_000): Promise<boolean> {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    try {
      const res = await fetch("/api/health", { cache: "no-store" });
      if (res.ok) return true;
    } catch {
      /* down during rebuild */
    }
    await new Promise((r) => setTimeout(r, 2000));
  }
  return false;
}

export function SelfUpdateSection({ compact = false }: { compact?: boolean }) {
  const { t } = useI18n();
  const qc = useQueryClient();
  const canApply = useCan("proxora.update");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [optimisticProgress, setOptimisticProgress] = useState<SelfUpdateStatus["progress"]>(null);

  const { data: status } = useQuery({
    queryKey: ["self-update"],
    queryFn: () => api<SelfUpdateStatus>("/api/system/self-update"),
    refetchInterval: (q) => (busy || q.state.data?.updating ? 1500 : 60_000),
  });

  const progress = status?.progress ?? optimisticProgress;
  const showProgress = Boolean(busy || status?.updating || progress?.step === "error");
  const percent = progress?.percent ?? (showProgress ? 2 : 0);
  const stepId = progress?.step && STEP_IDS.has(progress.step) ? progress.step : "apply";
  const stepLabel = t(`proxora.step.${stepId}` as MessageKey);

  const handleApply = async () => {
    setBusy(true);
    setError(null);
    setSuccess(null);
    setOptimisticProgress({ percent: 2, step: "start", detail: null });
    try {
      const result = await api<{ ok: boolean; message: string }>("/api/system/self-update", {
        method: "POST",
      });
      setSuccess(result.message);
      await qc.invalidateQueries({ queryKey: ["self-update"] });
      if (!result.ok) {
        setBusy(false);
        return;
      }
    } catch (err) {
      setBusy(false);
      setError(err instanceof Error ? err.message : t("proxora.failed"));
      throw err;
    }

    const deadline = Date.now() + 20 * 60 * 1000;
    while (Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 1500));
      try {
        await qc.invalidateQueries({ queryKey: ["self-update"] });
        const next = qc.getQueryData<SelfUpdateStatus>(["self-update"]);
        if (next && !next.updating) break;
      } catch {
        /* API down during rebuild */
      }
    }
    const ok = await waitForHealth();
    setSuccess(ok ? t("proxora.healthOk") : t("proxora.healthManual"));
    setBusy(false);
    if (ok) window.setTimeout(() => window.location.reload(), 1500);
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
            <p className="text-muted-foreground">{status.message}</p>
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
              <dl className="grid gap-1 text-xs text-muted-foreground sm:grid-cols-2">
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
            {showProgress ? (
              <div className="space-y-2">
                <div className="flex justify-between text-xs">
                  <span>{stepLabel}</span>
                  <span>{Math.round(percent)}%</span>
                </div>
                <ProgressBar
                  value={percent}
                  autoTone={false}
                  tone={progress?.step === "error" ? "danger" : "primary"}
                />
                {progress?.detail ? <p className="text-xs text-muted-foreground">{progress.detail}</p> : null}
              </div>
            ) : null}
            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant="outline" onClick={() => void qc.invalidateQueries({ queryKey: ["self-update"] })}>
                {t("proxora.check")}
              </Button>
              {canApply ? (
                status.updateAvailable ? (
                  <ConfirmAction
                    title={t("proxora.confirmTitle")}
                    description={`${t("proxora.confirmBody", {
                      from: status.currentVersion,
                      to: status.targetVersion ?? t("proxora.latest"),
                    })} ${t("proxora.confirmOverwrite")}`}
                    actionLabel={t("proxora.apply")}
                    onConfirm={handleApply}
                  >
                    <Button size="sm" disabled={busy || status.updating || status.sidecar === "missing"}>
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
