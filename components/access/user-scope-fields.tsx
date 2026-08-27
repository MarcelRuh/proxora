"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { api } from "@/lib/api";
import type { PublicHost } from "@/lib/types";
import type { GuestScope } from "@/lib/guest-scope";
import { guestScopeKey } from "@/lib/guest-scope";
import { useI18n } from "@/components/i18n/locale-provider";

export function UserScopeFields({
  hostIds,
  guests,
  onHostIds,
  onGuests,
}: {
  hostIds: string[];
  guests: GuestScope[];
  onHostIds: (next: string[]) => void;
  onGuests: (next: GuestScope[]) => void;
}) {
  const { t } = useI18n();
  const { data } = useQuery({
    queryKey: ["hosts"],
    queryFn: () => api<{ hosts: PublicHost[] }>("/api/hosts"),
  });
  const hosts = data?.hosts ?? [];
  const [draft, setDraft] = useState<{ hostId: string; kind: "vm" | "lxc"; vmid: string }>({
    hostId: "",
    kind: "vm",
    vmid: "",
  });

  function addGuest() {
    const vmid = Number(draft.vmid);
    const hostId = draft.hostId || hosts[0]?.id || "";
    if (!hostId || !Number.isInteger(vmid) || vmid < 1) return;
    const next: GuestScope = { hostId, kind: draft.kind, vmid };
    if (guests.some((g) => guestScopeKey(g) === guestScopeKey(next))) return;
    onGuests([...guests, next]);
    if (!hostIds.includes(hostId)) onHostIds([...hostIds, hostId]);
    setDraft({ ...draft, vmid: "" });
  }

  return (
    <div className="space-y-4 text-sm">
      <div>
        <p className="mb-1 font-medium">{t("users.hosts")}</p>
        <p className="mb-2 text-xs text-muted-foreground">{t("users.hostsHint")}</p>
        <div className="grid gap-1.5">
          {hosts.map((h) => (
            <label key={h.id} className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={hostIds.includes(h.id)}
                onChange={(e) =>
                  onHostIds(e.target.checked ? [...hostIds, h.id] : hostIds.filter((id) => id !== h.id))
                }
              />
              {h.name}
            </label>
          ))}
        </div>
      </div>
      <div>
        <p className="mb-1 font-medium">{t("users.guests")}</p>
        <p className="mb-2 text-xs text-muted-foreground">{t("users.guestsHint")}</p>
        <div className="flex flex-wrap gap-2">
          <select
            className="h-9 rounded-[4px] border border-input bg-white/[0.03] px-2"
            value={draft.hostId}
            onChange={(e) => setDraft({ ...draft, hostId: e.target.value })}
          >
            <option value="">{t("common.chooseHost")}</option>
            {hosts.map((h) => (
              <option key={h.id} value={h.id}>
                {h.name}
              </option>
            ))}
          </select>
          <select
            className="h-9 rounded-[4px] border border-input bg-white/[0.03] px-2"
            value={draft.kind}
            onChange={(e) => setDraft({ ...draft, kind: e.target.value as "vm" | "lxc" })}
          >
            <option value="vm">VM</option>
            <option value="lxc">LXC</option>
          </select>
          <Input
            className="w-24"
            placeholder="ID"
            value={draft.vmid}
            onChange={(e) => setDraft({ ...draft, vmid: e.target.value })}
          />
          <Button type="button" size="sm" variant="outline" onClick={addGuest}>
            {t("users.addGuest")}
          </Button>
        </div>
        <ul className="mt-2 space-y-1">
          {guests.map((g) => {
            const hostName = hosts.find((h) => h.id === g.hostId)?.name ?? g.hostId;
            return (
              <li key={guestScopeKey(g)} className="flex items-center justify-between gap-2 rounded-[4px] border border-border px-2 py-1">
                <span className="font-mono text-xs">
                  {hostName} · {g.kind.toUpperCase()} {g.vmid}
                </span>
                <Button type="button" size="sm" variant="ghost" onClick={() => onGuests(guests.filter((x) => guestScopeKey(x) !== guestScopeKey(g)))}>
                  {t("settings.remove")}
                </Button>
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}
