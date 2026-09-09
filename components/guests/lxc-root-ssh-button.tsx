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
  const { data, error } = useQuery({
    queryKey: ["lxc-ssh-root", hostId, node, vmid],
    queryFn: () => api<SshRootPayload>(path),
    enabled: guestRunning && !locked,
    staleTime: 15_000,
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

  const on = data?.enabled === true;
  const next = !on;
  const needRunning = !guestRunning;
  const blocked = locked || needRunning || toggle.isPending;
  const title = locked
    ? disabledReason
    : needRunning
      ? t("guest.sshRootNeedRunning")
      : error instanceof Error
        ? error.message
        : undefined;
  const label = on ? t("guest.sshRootDisable") : t("guest.sshRootEnable");
  const button = (
    <Button variant={on ? "destructive" : "outline"} disabled={blocked} title={title}>
      {toggle.isPending ? t("common.loading") : label}
    </Button>
  );

  if (blocked) return button;

  return (
    <ConfirmAction
      title={next ? t("guest.sshRootEnableTitle") : t("guest.sshRootDisableTitle")}
      description={next ? t("guest.sshRootEnableBody") : t("guest.sshRootDisableBody")}
      actionLabel={label}
      destructive={on}
      onConfirm={async () => {
        await toggle.mutateAsync(next);
      }}
    >
      {button}
    </ConfirmAction>
  );
}
