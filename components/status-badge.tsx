"use client";

import { Badge } from "@/components/ui/badge";
import type { ConnectionState } from "@/lib/types";
import { useI18n } from "@/components/i18n/locale-provider";
import type { MessageKey } from "@/lib/i18n/messages";

const HOST_KEYS: Record<ConnectionState, MessageKey> = {
  ONLINE: "host.state.ONLINE",
  OFFLINE: "host.state.OFFLINE",
  CONNECTING: "host.state.CONNECTING",
  ERROR: "host.state.ERROR",
  MAINTENANCE: "host.state.MAINTENANCE",
};

export function HostStateBadge({ state }: { state: ConnectionState }) {
  const { t } = useI18n();
  const key = HOST_KEYS[state] ?? HOST_KEYS.ERROR;
  const variant =
    state === "ONLINE" ? "success" : state === "ERROR" ? "danger" : state === "OFFLINE" ? "muted" : "warning";
  return <Badge variant={variant}>{t(key)}</Badge>;
}

const GUEST_KEYS: Record<string, MessageKey> = {
  running: "guest.status.running",
  stopped: "guest.status.stopped",
  paused: "guest.status.paused",
  unknown: "guest.status.unknown",
};

export function GuestStateBadge({ status }: { status: string }) {
  const { t } = useI18n();
  const variant =
    status === "running" ? "success" : status === "paused" ? "warning" : status === "stopped" ? "muted" : "danger";
  return <Badge variant={variant}>{t(GUEST_KEYS[status] ?? "guest.status.unknown")}</Badge>;
}
