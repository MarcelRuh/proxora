"use client";

import { Badge } from "@/components/ui/badge";
import type { ConnectionState } from "@/lib/types";

const MAP: Record<ConnectionState, { label: string; variant: "success" | "danger" | "warning" | "muted" }> = {
  ONLINE: { label: "Online", variant: "success" },
  OFFLINE: { label: "Offline", variant: "muted" },
  CONNECTING: { label: "Verbinden", variant: "warning" },
  ERROR: { label: "Fehler", variant: "danger" },
  MAINTENANCE: { label: "Wartung", variant: "warning" },
};

export function HostStateBadge({ state }: { state: ConnectionState }) {
  const item = MAP[state] ?? MAP.ERROR;
  return <Badge variant={item.variant}>{item.label}</Badge>;
}

const GUEST_STATUS: Record<string, string> = {
  running: "Laufend",
  stopped: "Gestoppt",
  paused: "Pausiert",
  unknown: "Unbekannt",
};

export function GuestStateBadge({ status }: { status: string }) {
  const variant =
    status === "running" ? "success" : status === "paused" ? "warning" : status === "stopped" ? "muted" : "danger";
  return <Badge variant={variant}>{GUEST_STATUS[status] ?? status}</Badge>;
}
