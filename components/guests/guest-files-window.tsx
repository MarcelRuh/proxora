"use client";

import { useEffect } from "react";
import { useParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { GuestFilesPanel } from "@/components/guests/guest-files";
import { api } from "@/lib/api";
import { useI18n } from "@/components/i18n/locale-provider";
import { useCanAny } from "@/components/auth/session-user";
import { QueryGate } from "@/components/layout/query-gate";
import { parseGuestConfigIps } from "@/lib/create-ip";
import { peerHostAllowsPermission } from "@/lib/federation-access";
import type { PublicHost } from "@/lib/types";
import { APP_NAME } from "@/lib/version";
import { isWindowsOstype } from "@/lib/iso-images";

type GuestPayload = {
  status: Record<string, unknown>;
  config: Record<string, unknown>;
  agentEnabled?: boolean;
  ips?: string[];
};

export function GuestFilesWindow({ kind }: { kind: "vm" | "lxc" }) {
  const { t } = useI18n();
  const params = useParams<{ hostId: string; node: string; vmid: string }>();
  const guest = { hostId: params.hostId, kind, vmid: Number(params.vmid) };
  const filePerms = kind === "vm" ? (["vm.files.read", "vm.files.write"] as const) : (["lxc.files.read", "lxc.files.write"] as const);
  const can = useCanAny([...filePerms], params.hostId, guest);
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
  const { data: hosts, isLoading: hostsLoading } = useQuery({
    queryKey: ["hosts"],
    queryFn: () => api<{ hosts: PublicHost[] }>("/api/hosts"),
    enabled: can,
  });

  const status = live?.status ?? data?.status ?? {};
  const config = data?.config ?? {};
  const running = String(status.status ?? "") === "running";
  const name = String(config.name ?? config.hostname ?? status.name ?? params.vmid);
  const ips = data?.ips?.length ? data.ips : parseGuestConfigIps(config);
  const hostMeta = hosts?.hosts.find((h) => h.id === params.hostId);
  const windows = kind === "vm" && isWindowsOstype(String(config.ostype ?? ""));
  const allowed =
    can && peerHostAllowsPermission(hostMeta ?? { origin: "LOCAL" }, [...filePerms]);

  useEffect(() => {
    document.title = t("files.windowTitle", { id: params.vmid, name });
  }, [t, params.vmid, name]);

  if (!can) {
    return (
      <div className="flex h-full items-center justify-center p-6 text-sm text-muted-foreground">
        {t("hosts.terminalForbidden")}
      </div>
    );
  }
  if (hosts && !allowed) {
    return (
      <div className="flex h-full items-center justify-center p-6 text-sm text-muted-foreground">
        {t("hosts.terminalForbidden")}
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="flex shrink-0 items-center gap-2 border-b border-border px-3 py-2">
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold">
            {params.vmid} · {name}
          </p>
          <p className="text-[10px] uppercase tracking-wider text-muted-foreground">
            {APP_NAME} · {t("files.title")}
          </p>
        </div>
      </header>
      <div className="min-h-0 flex-1">
        <QueryGate isLoading={isLoading || hostsLoading} error={error} onRetry={() => void refetch()}>
          {data ? (
            <div className="h-full min-h-0">
              <GuestFilesPanel
                hostId={params.hostId}
                node={params.node}
                vmid={Number(params.vmid)}
                kind={kind}
                ips={ips}
                running={running}
                agentEnabled={Boolean(data.agentEnabled)}
                windows={windows}
                fill
              />
            </div>
          ) : null}
        </QueryGate>
      </div>
    </div>
  );
}
