"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { ProgressBar } from "@/components/ui/misc";
import type { SelfUpdateStatus } from "@/components/settings/self-update-section";
import { api } from "@/lib/api";
import { useI18n } from "@/components/i18n/locale-provider";
import type { MessageKey } from "@/lib/i18n/messages";

export const SELF_UPDATE_FLAG = "proxora-self-update";
const SELF_UPDATE_EVENT = "proxora-update";

const STEP_IDS = new Set([
  "cleanup",
  "start",
  "resolve",
  "sync",
  "build",
  "pull",
  "buildWeb",
  "export",
  "startWeb",
  "finalize",
  "done",
  "error",
  "apply",
]);

export function markSelfUpdateActive(active: boolean) {
  if (active) sessionStorage.setItem(SELF_UPDATE_FLAG, "1");
  else sessionStorage.removeItem(SELF_UPDATE_FLAG);
  window.dispatchEvent(new Event(SELF_UPDATE_EVENT));
}

async function healthOk(): Promise<boolean> {
  try {
    const res = await fetch("/api/health", { cache: "no-store" });
    return res.ok;
  } catch {
    return false;
  }
}

export function UpdateBanner() {
  const { t } = useI18n();
  const qc = useQueryClient();
  const [held, setHeld] = useState(false);
  const sawUpdate = useRef(false);
  const finishing = useRef(false);

  useEffect(() => {
    const sync = () => setHeld(sessionStorage.getItem(SELF_UPDATE_FLAG) === "1");
    sync();
    window.addEventListener(SELF_UPDATE_EVENT, sync);
    return () => window.removeEventListener(SELF_UPDATE_EVENT, sync);
  }, []);

  const { data, isError } = useQuery({
    queryKey: ["self-update"],
    queryFn: () => api<SelfUpdateStatus>("/api/system/self-update"),
    refetchInterval: (q) => (held || q.state.data?.updating ? 1500 : 60_000),
    retry: held ? 0 : 1,
  });

  const active = Boolean(held || data?.updating);

  useEffect(() => {
    if (data?.updating) sawUpdate.current = true;
    if (!sawUpdate.current || finishing.current || !data || data.updating) return;
    if (data.progress?.step === "error") {
      markSelfUpdateActive(false);
      return;
    }
    finishing.current = true;
    const started = Date.now();
    const finish = () => {
      void healthOk().then((ok) => {
        if (ok) {
          markSelfUpdateActive(false);
          window.setTimeout(() => window.location.reload(), 800);
          return;
        }
        if (Date.now() - started > 180_000) {
          finishing.current = false;
          return;
        }
        window.setTimeout(finish, 2000);
      });
    };
    finish();
  }, [data]);

  useEffect(() => {
    if (!held) return;
    const timer = window.setInterval(() => {
      void qc.invalidateQueries({ queryKey: ["self-update"] });
    }, 1500);
    return () => window.clearInterval(timer);
  }, [held, qc]);

  if (!active) return null;

  const progress = data?.progress;
  const offline = isError;
  const percent = progress?.percent ?? 2;
  const stepId = progress?.step && STEP_IDS.has(progress.step) ? progress.step : "apply";
  const stepLabel = t(`proxora.step.${stepId}` as MessageKey);

  return (
    <div className="border-b border-border bg-card px-4 py-3">
      <div className="mx-auto flex max-w-3xl flex-col gap-2">
        <div className="flex items-baseline justify-between gap-3 text-sm">
          <p className="font-medium">{stepLabel}</p>
          <p className="font-mono text-xs text-muted-foreground">{offline ? "…" : `${Math.round(percent)}%`}</p>
        </div>
        <ProgressBar
          className="h-2"
          value={percent}
          indeterminate={offline || !progress}
          autoTone={false}
          tone={progress?.step === "error" ? "danger" : "primary"}
        />
        <p className="text-xs text-muted-foreground">
          {progress?.step === "error"
            ? progress.detail || t("proxora.failed")
            : offline
              ? t("proxora.reconnecting")
              : progress?.detail || t("proxora.applying")}
        </p>
      </div>
    </div>
  );
}
