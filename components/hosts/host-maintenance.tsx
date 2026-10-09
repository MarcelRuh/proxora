"use client";

import { useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { ConfirmAction } from "@/components/confirm-action";
import { useCan } from "@/components/auth/session-user";
import { useI18n } from "@/components/i18n/locale-provider";
import { api } from "@/lib/api";
import { hostErrorText } from "@/lib/host-error-text";
import type { PublicHost } from "@/lib/types";

export function HostMaintenanceButton({
  host,
  onDone,
  disabled,
  disabledReason,
}: {
  host: PublicHost;
  onDone: () => void;
  disabled?: boolean;
  disabledReason?: string;
}) {
  const { t } = useI18n();
  const canEdit = useCan("hosts.update", host.id);
  const blocked = Boolean(disabled) || !canEdit;
  const title = disabledReason ?? (!canEdit ? t("common.noPermission") : undefined);
  const inMaintenance = host.connectionState === "MAINTENANCE";
  const [busy, setBusy] = useState(false);
  const inFlight = useRef(false);

  async function apply(state: "MAINTENANCE" | "ONLINE") {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    try {
      const res = await api<{ host: PublicHost }>(`/api/hosts/${host.id}/state`, {
        method: "POST",
        body: JSON.stringify({ state }),
      });
      if (state === "ONLINE" && res.host.connectionState === "ERROR") {
        toast.error(hostErrorText(res.host.lastError, t) || t("common.failed"));
      } else {
        toast.success(state === "MAINTENANCE" ? t("hosts.maintenanceSet") : t("hosts.maintenanceCleared"));
      }
      onDone();
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }

  if (blocked) {
    return (
      <Button size="sm" variant="outline" disabled title={title}>
        {inMaintenance ? t("hosts.maintenanceOff") : t("hosts.maintenanceOn")}
      </Button>
    );
  }

  if (inMaintenance) {
    return (
      <Button
        size="sm"
        variant="outline"
        disabled={busy}
        onClick={() => void apply("ONLINE").catch((e) => toast.error(e instanceof Error ? e.message : t("common.failed")))}
      >
        {busy ? t("common.loading") : t("hosts.maintenanceOff")}
      </Button>
    );
  }

  return (
    <ConfirmAction
      title={t("hosts.maintenanceTitle", { name: host.name })}
      description={t("hosts.maintenanceBody")}
      actionLabel={t("hosts.maintenanceOn")}
      disabled={busy}
      onConfirm={() => apply("MAINTENANCE")}
    >
      <Button size="sm" variant="outline" disabled={busy}>
        {t("hosts.maintenanceOn")}
      </Button>
    </ConfirmAction>
  );
}
