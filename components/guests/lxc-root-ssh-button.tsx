"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { ConfirmAction } from "@/components/confirm-action";
import { api } from "@/lib/api";
import { useI18n } from "@/components/i18n/locale-provider";

type SshRootPayload = {
  running: boolean;
  permitRootLogin: string;
  enabled: boolean;
  guestRunning: boolean;
};

export function LxcRootSshButton({
  hostId,
  node,
  vmid,
  guestRunning,
  disabled,
  disabledReason,
}: {
  hostId: string;
  node: string;
  vmid: number;
  guestRunning: boolean;
  disabled?: boolean;
  disabledReason?: string;
}) {
  const { t } = useI18n();
  const qc = useQueryClient();
  const path = `/api/hosts/${hostId}/lxc/${encodeURIComponent(node)}/${vmid}/ssh-root`;
  const locked = Boolean(disabled);
  const { data } = useQuery({
    queryKey: ["lxc-ssh-root", hostId, node, vmid],
    queryFn: () => api<SshRootPayload>(path),
    enabled: guestRunning && !locked,
    staleTime: 60_000,
    refetchOnWindowFocus: false,
    retry: false,
  });
  const toggle = useMutation({
    mutationFn: (enabled: boolean) => api<SshRootPayload>(path, { method: "POST", body: JSON.stringify({ enabled }) }),
    onSuccess: (next) => {
      toast.success(next.enabled ? t("guest.sshRootEnabled") : t("guest.sshRootDisabled"));
      qc.setQueryData(["lxc-ssh-root", hostId, node, vmid], next);
    },
  });

  const needRunning = !guestRunning;
  const blocked = locked || needRunning || toggle.isPending;
  const title = locked ? disabledReason : needRunning ? t("guest.sshRootNeedRunning") : undefined;
  const knownOn = data?.enabled === true;
  const knownOff = data?.enabled === false;

  function actionButton(enable: boolean) {
    const turning = toggle.isPending && toggle.variables === enable;
    const label = enable ? t("guest.sshRootEnable") : t("guest.sshRootDisable");
    const button = (
      <Button
        variant={enable ? (knownOn ? "default" : "outline") : knownOff ? "secondary" : "destructive"}
        disabled={blocked}
        title={title}
      >
        {turning ? t("common.loading") : label}
      </Button>
    );
    if (blocked) return button;
    return (
      <ConfirmAction
        title={enable ? t("guest.sshRootEnableTitle") : t("guest.sshRootDisableTitle")}
        description={enable ? t("guest.sshRootEnableBody") : t("guest.sshRootDisableBody")}
        actionLabel={label}
        destructive={!enable}
        onConfirm={async () => {
          await toggle.mutateAsync(enable);
        }}
      >
        {button}
      </ConfirmAction>
    );
  }

  return (
    <>
      {actionButton(true)}
      {actionButton(false)}
    </>
  );
}
