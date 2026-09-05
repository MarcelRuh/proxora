"use client";

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
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
  proxoraPort: number;
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
    hasPresharedKey: boolean;
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
  const [peerIp, setPeerIp] = useState("");
  const [inviteIn, setInviteIn] = useState("");
  const [inviteOut, setInviteOut] = useState("");
  const [confIn, setConfIn] = useState("");

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
    <div className="space-y-6">
      <Card>
        <CardContent className="space-y-4 pt-6">
          <div>
            <p className="text-sm font-medium">{t("peers.tunnelTitle")}</p>
            <p className="mt-1 text-xs text-muted-foreground">{t("peers.tunnelBody")}</p>
          </div>
          {iface ? (
            <>
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={iface.enabled} onChange={(e) => void patch({ enabled: e.target.checked })} />
                {t("peers.enabled")}
              </label>
              <Field label={t("peers.instanceName")} value={iface.instanceName} onBlur={(instanceName) => void patch({ instanceName })} />
              <div className="space-y-2">
                <p className="text-sm font-medium">{t("peers.importConfTitle")}</p>
                <p className="text-xs text-muted-foreground">{t("peers.importConfBody")}</p>
                <input
                  type="file"
                  accept=".conf,.txt,text/plain"
                  className="block text-sm file:mr-2 file:rounded-md file:border file:border-input file:bg-transparent file:px-3 file:py-1"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    e.target.value = "";
                    if (!file) return;
                    void file.text().then(async (text) => {
                      setConfIn(text);
                      try {
                        await post({ action: "import-conf", config: text });
                        setConfIn("");
                        toast.success(t("peers.importConfDone"));
                      } catch (err) {
                        toast.error(err instanceof Error ? err.message : t("common.failed"));
                      }
                    });
                  }}
                />
                <textarea
                  className="h-28 w-full rounded-md border border-input bg-transparent p-2 font-mono text-xs"
                  placeholder={t("peers.importConfPaste")}
                  value={confIn}
                  onChange={(e) => setConfIn(e.target.value)}
                />
                <Button
                  type="button"
                  variant="outline"
                  onClick={async () => {
                    try {
                      await post({ action: "import-conf", config: confIn });
                      setConfIn("");
                      toast.success(t("peers.importConfDone"));
                    } catch (e) {
                      toast.error(e instanceof Error ? e.message : t("common.failed"));
                    }
                  }}
                >
                  {t("peers.importConfButton")}
                </Button>
              </div>
              {iface.hasPresharedKey ? <p className="text-xs text-muted-foreground">{t("peers.hasPresharedKey")}</p> : null}
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label={t("peers.address")} value={iface.address} onBlur={(address) => void patch({ address })} />
                <Field
                  label={t("peers.serverEndpoint")}
                  value={iface.serverEndpoint}
                  onBlur={(serverEndpoint) => void patch({ serverEndpoint })}
                />
                <div className="space-y-1 sm:col-span-2">
                  <Label>{t("peers.allowedIps")}</Label>
                  <Input
                    defaultValue={iface.allowedIPs}
                    key={iface.allowedIPs}
                    className="font-mono text-xs"
                    onBlur={(e) => {
                      if (e.target.value !== iface.allowedIPs) void patch({ allowedIPs: e.target.value });
                    }}
                  />
                  <p className="text-xs text-muted-foreground">{t("peers.allowedIpsHint")}</p>
                </div>
              </div>
            </>
          ) : null}
        </CardContent>
      </Card>

      <Card>
        <CardContent className="space-y-4 pt-6">
          <div>
            <p className="text-sm font-medium">{t("peers.inviteColleague")}</p>
            <p className="mt-1 text-xs text-muted-foreground">{t("peers.inviteBody")}</p>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1">
              <Label>{t("peers.peerName")}</Label>
              <Input placeholder={t("peers.peerName")} value={peerName} onChange={(e) => setPeerName(e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label>{t("peers.colleagueIp")}</Label>
              <Input placeholder="10.89.0.1" value={peerIp} onChange={(e) => setPeerIp(e.target.value)} className="font-mono text-sm" />
            </div>
          </div>
          <Button
            type="button"
            variant="outline"
            onClick={async () => {
              try {
                const res = await post({
                  action: "create-peer",
                  name: peerName || "Kollege",
                  address: peerIp,
                  proxoraPort: 3000,
                });
                setInviteOut(res.invite ?? "");
                setPeerName("");
                setPeerIp("");
                toast.success(t("peers.peerCreated"));
              } catch (e) {
                toast.error(e instanceof Error ? e.message : t("common.failed"));
              }
            }}
          >
            {t("peers.createInvite")}
          </Button>
          {inviteOut ? (
            <textarea className="h-24 w-full rounded-md border border-input bg-transparent p-2 font-mono text-xs" readOnly value={inviteOut} />
          ) : null}
          <Label className="block">{t("peers.pasteInvite")}</Label>
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
        </CardContent>
      </Card>

      {peers.map((peer) => (
        <PeerCard
          key={peer.id}
          peer={peer}
          localHosts={localHosts}
          onInvite={async () => {
            const res = await post({ action: "invite", peerId: peer.id });
            setInviteOut(res.invite ?? "");
          }}
          onUpdate={async (patch) => {
            await post({ action: "update-peer", peerId: peer.id, ...patch });
            toast.success(t("peers.peerSaved"));
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
    </div>
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
  onUpdate,
  onShares,
  onDelete,
}: {
  peer: PeerRow;
  localHosts: PublicHost[];
  onInvite: () => Promise<void>;
  onUpdate: (patch: { name?: string; address?: string; proxoraPort?: number }) => Promise<void>;
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
    <Card>
      <CardContent className="space-y-3 pt-6">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <p className="font-medium">{peer.name}</p>
            <p className="text-xs text-muted-foreground">
              {peer.paired ? t("peers.paired") : t("peers.waiting")}
              {peer.lastSeenAt ? ` · ${new Date(peer.lastSeenAt).toLocaleString()}` : ""}
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
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label={t("peers.colleagueIp")} value={peer.address} onBlur={(address) => void onUpdate({ address })} />
          <Field
            label={t("peers.colleaguePort")}
            value={String(peer.proxoraPort ?? 3000)}
            onBlur={(v) => void onUpdate({ proxoraPort: Number(v) || 3000 })}
          />
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
      </CardContent>
    </Card>
  );
}
