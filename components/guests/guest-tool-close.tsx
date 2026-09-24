"use client";

import { useEffect } from "react";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/components/i18n/locale-provider";
import { closeGuestToolWindow, guestDetailPath } from "@/lib/guest-tool-window";

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
  useEffect(() => {
    const parent = guestDetailPath({ kind, hostId, node, vmid });
    if (window.history.state?.proxoraLeave) return;
    window.history.pushState({ proxoraLeave: true }, "");
    const onPop = () => {
      window.location.assign(parent);
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, [kind, hostId, node, vmid]);
  return (
    <Button size="sm" variant="outline" onClick={() => closeGuestToolWindow({ kind, hostId, node, vmid })}>
      {t("common.close")}
    </Button>
  );
}
