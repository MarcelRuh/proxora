"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { WebConsole } from "@/components/console/web-console";
import { VncConsole } from "@/components/console/vnc-console";
import { api } from "@/lib/api";
import { useI18n } from "@/components/i18n/locale-provider";
import { useCan } from "@/components/auth/session-user";
import { QueryGate } from "@/components/layout/query-gate";
import { vmHasGraphics } from "@/lib/guest-console";
import { APP_NAME } from "@/lib/version";

type GuestPayload = {
  status: Record<string, unknown>;
  config: Record<string, unknown>;
};

export function GuestConsoleWindow({ kind }: { kind: "vm" | "lxc" }) {
  const { t } = useI18n();
  const params = useParams<{ hostId: string; node: string; vmid: string }>();
  const can = useCan(kind === "vm" ? "vm.console" : "lxc.console", params.hostId);
  const [mode, setMode] = useState<"vga" | "serial">(kind === "vm" ? "vga" : "serial");
  const path = `/api/hosts/${params.hostId}/${kind === "vm" ? "vms" : "lxc"}/${params.node}/${params.vmid}`;
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ["guest", kind, params.hostId, params.node, params.vmid],
    queryFn: () => api<GuestPayload>(path),
    enabled: can,
  });
  const { data: live } = useQuery({
    queryKey: ["guest-live", kind, params.hostId, params.node, params.vmid],
    queryFn: () => api<Pick<GuestPayload, "status">>(`${path}?light=1`),
    refetchInterval: 15_000,
    staleTime: 8_000,
    placeholderData: (previous) => previous,
    enabled: Boolean(can && data),
  });

  const status = live?.status ?? data?.status ?? {};
  const config = data?.config ?? {};
  const runState = String(status.status ?? "unknown");
  const running = runState === "running";
  const paused = runState === "paused";
  const hasGraphics = kind !== "vm" || vmHasGraphics(config.vga);
  const name = String(config.name ?? config.hostname ?? status.name ?? params.vmid);
  const vga = kind === "vm" && mode === "vga" && hasGraphics;

  useEffect(() => {
    if (kind === "vm" && data?.config && !hasGraphics) setMode("serial");
  }, [kind, data?.config, hasGraphics]);

  useEffect(() => {
    document.title = t("guest.consoleWindow", { id: params.vmid, name });
  }, [t, params.vmid, name]);

  if (!can) {
    return (
      <div className="flex h-full items-center justify-center p-6 text-sm text-muted-foreground">
        {t("hosts.terminalForbidden")}
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="flex shrink-0 flex-wrap items-center gap-2 border-b border-border px-3 py-2">
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold">
            {params.vmid} · {name}
          </p>
          <p className="text-[10px] uppercase tracking-wider text-muted-foreground">
            {APP_NAME} · {t("guest.console")}
          </p>
        </div>
        {kind === "vm" ? (
          <div className="flex gap-1">
            <Button
              size="sm"
              variant={mode === "vga" ? "default" : "outline"}
              disabled={!hasGraphics}
              onClick={() => setMode("vga")}
            >
              {t("guest.consoleVga")}
            </Button>
            <Button size="sm" variant={mode === "serial" ? "default" : "outline"} onClick={() => setMode("serial")}>
              {t("guest.consoleSerial")}
            </Button>
          </div>
        ) : null}
      </header>
      <div className="min-h-0 flex-1 p-2">
        <QueryGate isLoading={isLoading} error={error} onRetry={() => void refetch()}>
          <div className="h-full min-h-0">
            {vga ? (
              <VncConsole
                hostId={params.hostId}
                node={params.node}
                vmid={Number(params.vmid)}
                running={running || paused}
                fill
              />
            ) : (
              <WebConsole hostId={params.hostId} node={params.node} kind={kind} vmid={Number(params.vmid)} fill />
            )}
          </div>
        </QueryGate>
      </div>
    </div>
  );
}
