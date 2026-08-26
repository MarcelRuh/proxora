"use client";

import { Badge } from "@/components/ui/badge";
import type { ConnectionState } from "@/lib/types";

const MAP: Record<ConnectionState, { label: string; variant: "success" | "danger" | "warning" | "muted" }> = {
  ONLINE: { label: "Online", variant: "success" },
  OFFLINE: { label: "Offline", variant: "muted" },
  CONNECTING: { label: "Connecting", variant: "warning" },
  ERROR: { label: "Error", variant: "danger" },
  MAINTENANCE: { label: "Maintenance", variant: "warning" },
};

export function HostStateBadge({ state }: { state: ConnectionState }) {
  const item = MAP[state] ?? MAP.ERROR;
  return <Badge variant={item.variant}>{item.label}</Badge>;
}

export function GuestStateBadge({ status }: { status: string }) {
  const variant =
    status === "running" ? "success" : status === "paused" ? "warning" : status === "stopped" ? "muted" : "danger";
  return <Badge variant={variant}>{status}</Badge>;
}
