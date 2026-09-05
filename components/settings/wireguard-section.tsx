"use client";

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input, Label } from "@/components/ui/input";
import { api } from "@/lib/api";
import { useCan } from "@/components/auth/session-user";
import { useI18n } from "@/components/i18n/locale-provider";
import type { PublicHost } from "@/lib/types";

type ShareLevel = "view" | "control" | "create";

type PeerRow = {
  id: string;
  name: string;
  kind: "PROXORA" | "GATEWAY";
  publicKey: string;
  endpoint: string;
  address: string;
  allowedIPs: string;
  paired: boolean;
  lastSeenAt: string | null;
  shares: Array<{ hostId: string; level: string }>;
};

type WgPayload = {
  interface: {
    enabled: boolean;
    instanceName: string;
    address: string;
    publicKey: string;
    serverPublicKey: string;
    serverEndpoint: string;
    allowedIPs: string;
    persistentKeepalive: number;
    serverPeerSnippet: string;
  };
  peers: PeerRow[];
};

export function WireguardSection() {
  const { t } = useI18n();
  const can = useCan("peers.manage");
  const qc = useQueryClient();
  const { data: wg } = useQuery({
    queryKey: ["wireguard"],
    enabled: can,
    queryFn: () => api<WgPayload>("/api/wireguard"),
  });
  const { data: hostData } = useQuery({
    queryKey: ["hosts"],
    enabled: can,
    queryFn: () => api<{ hosts: PublicHost[] }>("/api/hosts"),
  });
  const localHosts = (hostData?.hosts ?? []).filter((h) => h.origin !== "PEER");
  const [peerName, setPeerName] = useState("");
  const [inviteIn, setInviteIn] = useState("");
  const [inviteOut, setInviteOut] = useState("");

  const iface = wg?.interface;
  const peers = (wg?.peers ?? []).filter((p) => p.kind === "PROXORA");

  async function patch(body: Record<string, unknown>) {
    await api("/api/wireguard", { method: "PATCH", body: JSON.stringify(body) });
    await qc.invalidateQueries({ queryKey: ["wireguard"] });
    toast.success(t("peers.saved"));
  }

  async function post(body: Record<string, unknown>) {
    const res = await api<{ invite?: string; peer?: PeerRow; peers?: PeerRow[] }>("/api/wireguard", {
      method: "POST",
      body: JSON.stringify(body),
    });
    await qc.invalidateQueries({ queryKey: ["wireguard"] });
    await qc.invalidateQueries({ queryKey: ["hosts"] });
    return res;
  }

  if (!can) return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("peers.title")}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-6">
        <p className="text-sm text-muted-foreground">{t("peers.body")}</p>
        {iface ? (
          <>
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="flex items-center gap-2 text-sm sm:col-span-2">
                <input type="checkbox" checked={iface.enabled} onChange={(e) => void patch({ enabled: e.target.checked })} />
                {t("peers.enabled")}
              </label>
              <Field label={t("peers.instanceName")} value={iface.instanceName} onBlur={(instanceName) => void patch({ instanceName })} />
              <Field label={t("peers.address")} value={iface.address} onBlur={(address) => void patch({ address })} />
            </div>

            <div className="space-y-3 rounded-lg border border-border p-3">
              <p className="text-sm font-medium">{t("peers.gatewayTitle")}</p>
              <p className="text-xs text-muted-foreground">{t("peers.gatewayBody")}</p>
              <div className="grid gap-3 sm:grid-cols-2">
                <Field
                  label={t("peers.serverEndpoint")}
                  value={iface.serverEndpoint}
                  onBlur={(serverEndpoint) => void patch({ serverEndpoint })}
                />
                <Field
                  label={t("peers.allowedIps")}
                  value={iface.allowedIPs}
                  onBlur={(allowedIPs) => void patch({ allowedIPs })}
                />
                <div className="space-y-1 sm:col-span-2">
                  <Label>{t("peers.serverPublicKey")}</Label>
                  <Input
                    defaultValue={iface.serverPublicKey}
                    key={iface.serverPublicKey}
                    className="font-mono text-xs"
                    onBlur={(e) => {
                      if (e.target.value !== iface.serverPublicKey) void patch({ serverPublicKey: e.target.value });
                    }}
                  />
                </div>
              </div>
            </div>

            <div className="space-y-2 rounded-lg border border-border p-3">
              <p className="text-sm font-medium">{t("peers.clientSnippetTitle")}</p>
              <p className="text-xs text-muted-foreground">{t("peers.clientSnippetBody")}</p>
              <div className="space-y-1">
                <Label>{t("peers.publicKey")}</Label>
                <Input readOnly value={iface.publicKey} className="font-mono text-xs" />
              </div>
              <textarea
                className="h-24 w-full rounded-md border border-input bg-transparent p-2 font-mono text-xs"
                readOnly
                value={iface.serverPeerSnippet}
              />
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={async () => {
                  try {
                    await navigator.clipboard.writeText(iface.serverPeerSnippet);
                    toast.success(t("peers.copied"));
                  } catch {
                    toast.error(t("common.failed"));
                  }
                }}
              >
                {t("peers.copySnippet")}
              </Button>
            </div>
          </>
        ) : null}

        <div className="space-y-2 rounded-lg border border-border p-3">
          <p className="text-sm font-medium">{t("peers.inviteColleague")}</p>
          <p className="text-xs text-muted-foreground">{t("peers.inviteBody")}</p>
          <div className="flex flex-wrap gap-2">
            <Input
              placeholder={t("peers.peerName")}
              value={peerName}
              onChange={(e) => setPeerName(e.target.value)}
              className="max-w-56"
            />
            <Button
              type="button"
              variant="outline"
              onClick={async () => {
                try {
                  const res = await post({ action: "create-peer", name: peerName || "Kollege" });
                  setInviteOut(res.invite ?? "");
                  toast.success(t("peers.peerCreated"));
                } catch (e) {
                  toast.error(e instanceof Error ? e.message : t("common.failed"));
                }
              }}
            >
              {t("peers.createInvite")}
            </Button>
          </div>
          {inviteOut ? (
            <textarea className="mt-2 h-24 w-full rounded-md border border-input bg-transparent p-2 font-mono text-xs" readOnly value={inviteOut} />
          ) : null}
          <Label className="mt-2 block">{t("peers.pasteInvite")}</Label>
          <textarea
            className="h-24 w-full rounded-md border border-input bg-transparent p-2 font-mono text-xs"
            value={inviteIn}
            onChange={(e) => setInviteIn(e.target.value)}
          />
          <Button
            type="button"
            onClick={async () => {
              try {
                const res = await post({ action: "import", invite: inviteIn });
                setInviteOut(res.invite ?? inviteOut);
                setInviteIn("");
                toast.success(t("peers.imported"));
              } catch (e) {
                toast.error(e instanceof Error ? e.message : t("common.failed"));
              }
            }}
          >
            {t("peers.importInvite")}
          </Button>
        </div>

        {peers.map((peer) => (
          <PeerCard
            key={peer.id}
            peer={peer}
            localHosts={localHosts}
            onInvite={async () => {
              const res = await post({ action: "invite", peerId: peer.id });
              setInviteOut(res.invite ?? "");
            }}
            onShares={async (shares) => {
              await post({ action: "shares", peerId: peer.id, shares });
              toast.success(t("peers.sharesSaved"));
            }}
            onDelete={async () => {
              await post({ action: "delete-peer", peerId: peer.id });
              toast.success(t("peers.removed"));
            }}
          />
        ))}
      </CardContent>
    </Card>
  );
}

function Field({ label, value, onBlur }: { label: string; value: string; onBlur: (v: string) => void }) {
  return (
    <div className="space-y-1">
      <Label>{label}</Label>
      <Input
        defaultValue={value}
        key={value}
        onBlur={(e) => {
          if (e.target.value !== value) onBlur(e.target.value);
        }}
      />
    </div>
  );
}

function PeerCard({
  peer,
  localHosts,
  onInvite,
  onShares,
  onDelete,
}: {
  peer: PeerRow;
  localHosts: PublicHost[];
  onInvite: () => Promise<void>;
  onShares: (shares: Array<{ hostId: string; level: string }>) => Promise<void>;
  onDelete: () => Promise<void>;
}) {
  const { t } = useI18n();
  const [levels, setLevels] = useState<Record<string, ShareLevel | "">>(() => {
    const next: Record<string, ShareLevel | ""> = {};
    for (const host of localHosts) {
      const share = peer.shares.find((s) => s.hostId === host.id);
      next[host.id] = (share?.level as ShareLevel) ?? "";
    }
    return next;
  });

  return (
    <div className="space-y-3 rounded-lg border border-border p-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="font-medium">{peer.name}</p>
          <p className="text-xs text-muted-foreground">
            {peer.paired ? t("peers.paired") : t("peers.waiting")}
            {peer.address ? ` · ${peer.address}` : ""}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="outline" onClick={() => void onInvite().catch((e) => toast.error(e instanceof Error ? e.message : t("common.failed")))}>
            {t("peers.showInvite")}
          </Button>
          <Button size="sm" variant="destructive" onClick={() => void onDelete().catch((e) => toast.error(e instanceof Error ? e.message : t("common.failed")))}>
            {t("peers.remove")}
          </Button>
        </div>
      </div>
      {localHosts.length ? (
        <div className="space-y-2">
          <p className="text-xs font-medium">{t("peers.shareHosts")}</p>
          {localHosts.map((host) => (
            <label key={host.id} className="flex items-center justify-between gap-2 text-sm">
              <span>{host.name}</span>
              <select
                className="h-8 rounded-[4px] border border-input bg-white/[0.03] px-2 text-sm"
                value={levels[host.id] ?? ""}
                onChange={(e) => setLevels((prev) => ({ ...prev, [host.id]: e.target.value as ShareLevel | "" }))}
              >
                <option value="">{t("peers.shareNone")}</option>
                <option value="view">{t("peers.shareView")}</option>
                <option value="control">{t("peers.shareControl")}</option>
                <option value="create">{t("peers.shareCreate")}</option>
              </select>
            </label>
          ))}
          <Button
            size="sm"
            type="button"
            onClick={() =>
              void onShares(
                Object.entries(levels)
                  .filter(([, level]) => level)
                  .map(([hostId, level]) => ({ hostId, level: level as string })),
              ).catch((e) => toast.error(e instanceof Error ? e.message : t("common.failed")))
            }
          >
            {t("peers.saveShares")}
          </Button>
        </div>
      ) : null}
    </div>
  );
}
