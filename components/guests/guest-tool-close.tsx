"use client";

import { Button } from "@/components/ui/button";
import { useI18n } from "@/components/i18n/locale-provider";
import { closeGuestToolWindow } from "@/lib/guest-tool-window";

export function GuestToolCloseButton({
  kind,
  hostId,
  node,
  vmid,
}: {
  kind: "vm" | "lxc";
  hostId: string;
  node: string;
  vmid: number | string;
}) {
  const { t } = useI18n();
  return (
    <Button size="sm" variant="outline" onClick={() => closeGuestToolWindow({ kind, hostId, node, vmid })}>
      {t("common.close")}
    </Button>
  );
}
