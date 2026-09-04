"use client";

import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { ConfirmAction } from "@/components/confirm-action";
import { useCan } from "@/components/auth/session-user";
import { useI18n } from "@/components/i18n/locale-provider";
import { api } from "@/lib/api";
import type { PublicHost } from "@/lib/types";

export function HostMaintenanceButton({
  host,
  onDone,
}: {
  host: PublicHost;
  onDone: () => void;
}) {
  const { t } = useI18n();
  const canEdit = useCan("hosts.update");
  if (!canEdit) return null;

  const inMaintenance = host.connectionState === "MAINTENANCE";

  async function apply(state: "MAINTENANCE" | "ONLINE") {
    const res = await api<{ host: PublicHost }>(`/api/hosts/${host.id}/state`, {
      method: "POST",
      body: JSON.stringify({ state }),
    });
    if (state === "ONLINE" && res.host.connectionState === "ERROR") {
      toast.error(res.host.lastError || t("common.failed"));
    } else {
      toast.success(state === "MAINTENANCE" ? t("hosts.maintenanceSet") : t("hosts.maintenanceCleared"));
    }
    onDone();
  }

  if (inMaintenance) {
    return (
      <Button size="sm" variant="outline" onClick={() => void apply("ONLINE").catch((e) => toast.error(e instanceof Error ? e.message : t("common.failed")))}>
        {t("hosts.maintenanceOff")}
      </Button>
    );
  }

  return (
    <ConfirmAction
      title={t("hosts.maintenanceTitle", { name: host.name })}
      description={t("hosts.maintenanceBody")}
      actionLabel={t("hosts.maintenanceOn")}
      onConfirm={() => apply("MAINTENANCE")}
    >
      <Button size="sm" variant="outline">
        {t("hosts.maintenanceOn")}
      </Button>
    </ConfirmAction>
  );
}
