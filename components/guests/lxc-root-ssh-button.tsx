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
  const { data, isFetching, error } = useQuery({
    queryKey: ["lxc-ssh-root", hostId, node, vmid],
    queryFn: () => api<SshRootPayload>(path),
    enabled: guestRunning && !locked,
    staleTime: 60_000,
    refetchOnWindowFocus: false,
    retry: 1,
  });
  const toggle = useMutation({
    mutationFn: (enabled: boolean) => api<SshRootPayload>(path, { method: "POST", body: JSON.stringify({ enabled }) }),
    onSuccess: (next) => {
      toast.success(next.enabled ? t("guest.sshRootEnabled") : t("guest.sshRootDisabled"));
      qc.setQueryData(["lxc-ssh-root", hostId, node, vmid], next);
    },
  });

  const needRunning = !guestRunning;
  const title = locked
    ? disabledReason
    : needRunning
      ? t("guest.sshRootNeedRunning")
      : error instanceof Error
        ? error.message
        : undefined;
  const enabled = Boolean(data?.enabled);
  const busy = toggle.isPending || isFetching;
  const label = enabled ? t("guest.sshRootDisable") : t("guest.sshRootEnable");
  const cannotClick = locked || needRunning || busy || Boolean(error);

  const button = (
    <Button
      variant={enabled ? "destructive" : "outline"}
      disabled={cannotClick}
      title={title}
    >
      {busy ? t("common.loading") : label}
    </Button>
  );

  if (cannotClick) return button;

  return (
    <ConfirmAction
      title={enabled ? t("guest.sshRootDisableTitle") : t("guest.sshRootEnableTitle")}
      description={enabled ? t("guest.sshRootDisableBody") : t("guest.sshRootEnableBody")}
      actionLabel={label}
      destructive={enabled}
      onConfirm={async () => {
        await toggle.mutateAsync(!enabled);
      }}
    >
      {button}
    </ConfirmAction>
  );
}
