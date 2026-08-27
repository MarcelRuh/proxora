"use client";

import { useState } from "react";
import { toast } from "sonner";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input, Label } from "@/components/ui/input";
import { api } from "@/lib/api";
import { GUEST_IP_SETTING_KEY, parseGuestIpSettings, type GuestIpNetwork, type GuestIpSettings } from "@/lib/create-ip";
import type { PublicHost } from "@/lib/types";
import { useI18n } from "@/components/i18n/locale-provider";

type SettingRow = { key: string; value: unknown };

function emptyNet(): GuestIpNetwork {
  return { id: "192.168.0.0", prefix: 24, gateway: "192.168.0.1" };
}

function NetworkList({
  value,
  onChange,
}: {
  value: GuestIpNetwork[];
  onChange: (next: GuestIpNetwork[]) => void;
}) {
  const { t } = useI18n();
  return (
    <div className="space-y-2">
      {value.map((net, i) => (
        <div key={`${net.id}-${i}`} className="grid gap-2 sm:grid-cols-[1fr_5rem_1fr_auto]">
          <div className="space-y-1">
            <Label>{t("create.network")}</Label>
            <Input
              value={net.id}
              onChange={(e) => {
                const next = [...value];
                next[i] = { ...net, id: e.target.value };
                onChange(next);
              }}
            />
          </div>
          <div className="space-y-1">
            <Label>/{t("settings.netPrefix")}</Label>
            <Input
              value={String(net.prefix)}
              onChange={(e) => {
                const next = [...value];
                next[i] = { ...net, prefix: Number(e.target.value) || 24 };
                onChange(next);
              }}
            />
          </div>
          <div className="space-y-1">
            <Label>{t("create.gateway")}</Label>
            <Input
              value={net.gateway}
              onChange={(e) => {
                const next = [...value];
                next[i] = { ...net, gateway: e.target.value };
                onChange(next);
              }}
            />
          </div>
          <Button type="button" variant="outline" className="self-end" onClick={() => onChange(value.filter((_, j) => j !== i))}>
            {t("settings.remove")}
          </Button>
        </div>
      ))}
      <Button type="button" size="sm" variant="outline" onClick={() => onChange([...value, emptyNet()])}>
        {t("settings.addNetwork")}
      </Button>
    </div>
  );
}

export function GuestNetworksSection() {
  const { t } = useI18n();
  const qc = useQueryClient();
  const { data } = useQuery({
    queryKey: ["settings"],
    queryFn: () => api<{ settings: SettingRow[] }>("/api/settings"),
  });
  const { data: hosts } = useQuery({
    queryKey: ["hosts"],
    queryFn: () => api<{ hosts: PublicHost[] }>("/api/hosts"),
  });
  const parsed = parseGuestIpSettings(data?.settings?.find((s) => s.key === GUEST_IP_SETTING_KEY)?.value);
  const [draft, setDraft] = useState<GuestIpSettings | null>(null);
  const form = draft ?? parsed;
  const [hostId, setHostId] = useState("");
  const [busy, setBusy] = useState(false);

  const override = hostId ? (form.byHost[hostId] ?? []) : [];

  async function save(next: GuestIpSettings) {
    setBusy(true);
    try {
      await api("/api/settings", { method: "PATCH", body: JSON.stringify({ key: GUEST_IP_SETTING_KEY, value: next }) });
      setDraft(next);
      toast.success(t("settings.networksSaved"));
      await qc.invalidateQueries({ queryKey: ["settings"] });
      await qc.invalidateQueries({ queryKey: ["options"] });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("common.failed"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("settings.networks")}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4 text-sm">
        <p className="text-muted-foreground">{t("settings.networksHint")}</p>
        <NetworkList value={form.defaults} onChange={(defaults) => setDraft({ ...form, defaults })} />
        <div className="space-y-2 border-t border-border pt-4">
          <p className="font-medium">{t("settings.hostNetworks")}</p>
          <select
            className="h-9 w-full max-w-md rounded-[4px] border border-input bg-white/[0.03] px-2 text-sm"
            value={hostId}
            onChange={(e) => setHostId(e.target.value)}
          >
            <option value="">{t("common.chooseHost")}</option>
            {(hosts?.hosts ?? []).map((h) => (
              <option key={h.id} value={h.id}>
                {h.name}
              </option>
            ))}
          </select>
          {hostId ? (
            <NetworkList
              value={override.length ? override : form.defaults.map((n) => ({ ...n }))}
              onChange={(list) => setDraft({ ...form, byHost: { ...form.byHost, [hostId]: list } })}
            />
          ) : null}
        </div>
        <Button type="button" disabled={busy || form.defaults.length === 0} onClick={() => void save(form)}>
          {t("common.save")}
        </Button>
      </CardContent>
    </Card>
  );
}
