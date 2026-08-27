"use client";

import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import type { PublicHost } from "@/lib/types";
import type { Guest } from "@/lib/types";
import type { GuestScope } from "@/lib/guest-scope";
import { guestScopeKey } from "@/lib/guest-scope";
import { useI18n } from "@/components/i18n/locale-provider";

export function UserScopeFields({
  hostIds,
  guests,
  onHostIds,
  onGuests,
  onGuestNames,
}: {
  hostIds: string[];
  guests: GuestScope[];
  onHostIds: (next: string[]) => void;
  onGuests: (next: GuestScope[]) => void;
  onGuestNames?: (names: Record<string, string>) => void;
}) {
  const { t } = useI18n();
  const { data } = useQuery({
    queryKey: ["hosts"],
    queryFn: () => api<{ hosts: PublicHost[] }>("/api/hosts"),
  });
  const hosts = data?.hosts ?? [];
  const listed = hostIds.length ? hosts.filter((h) => hostIds.includes(h.id)) : hosts;
  const { data: inventory } = useQuery({
    queryKey: ["scope-guests", listed.map((h) => h.id)],
    enabled: listed.length > 0,
    queryFn: async () => {
      return Promise.all(
        listed.map(async (host) => {
          const [vms, containers] = await Promise.all([
            api<{ vms: Guest[] }>(`/api/hosts/${host.id}/vms`).catch(() => ({ vms: [] as Guest[] })),
            api<{ containers: Guest[] }>(`/api/hosts/${host.id}/lxc`).catch(() => ({ containers: [] as Guest[] })),
          ]);
          return { host, vms: vms.vms, containers: containers.containers };
        }),
      );
    },
  });

  useEffect(() => {
    if (inventory) onGuestNames?.(guestNameMap(inventory));
  }, [inventory]);

  function toggleHost(id: string, on: boolean) {
    const next = on ? [...hostIds, id] : hostIds.filter((x) => x !== id);
    onHostIds(next);
    if (!on) onGuests(guests.filter((g) => g.hostId !== id));
  }

  function toggleGuest(scope: GuestScope, on: boolean) {
    if (on) {
      if (guests.some((g) => guestScopeKey(g) === guestScopeKey(scope))) return;
      onGuests([...guests, scope]);
      if (hostIds.length && !hostIds.includes(scope.hostId)) onHostIds([...hostIds, scope.hostId]);
      return;
    }
    onGuests(guests.filter((g) => guestScopeKey(g) !== guestScopeKey(scope)));
  }

  return (
    <div className="space-y-4 text-sm">
      <div>
        <p className="mb-1 font-medium">{t("users.hosts")}</p>
        <p className="mb-2 text-xs text-muted-foreground">{t("users.hostsHint")}</p>
        <div className="grid gap-1.5">
          {hosts.map((h) => (
            <label key={h.id} className="flex items-center gap-2">
              <input type="checkbox" checked={hostIds.includes(h.id)} onChange={(e) => toggleHost(h.id, e.target.checked)} />
              {h.name}
            </label>
          ))}
        </div>
      </div>
      <div>
        <p className="mb-1 font-medium">{t("users.guests")}</p>
        <p className="mb-2 text-xs text-muted-foreground">{t("users.guestsHint")}</p>
        <div className="space-y-3">
          {(inventory ?? []).map((block) => (
            <div key={block.host.id} className="rounded-[4px] border border-border p-2">
              <p className="mb-1 text-xs font-semibold uppercase tracking-wider text-muted-foreground">{block.host.name}</p>
              <GuestChecks
                hostId={block.host.id}
                kind="vm"
                items={block.vms}
                guests={guests}
                onToggle={toggleGuest}
              />
              <GuestChecks
                hostId={block.host.id}
                kind="lxc"
                items={block.containers}
                guests={guests}
                onToggle={toggleGuest}
              />
              {block.vms.length === 0 && block.containers.length === 0 ? (
                <p className="text-xs text-muted-foreground">{t("users.noGuestsOnHost")}</p>
              ) : null}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function GuestChecks({
  hostId,
  kind,
  items,
  guests,
  onToggle,
}: {
  hostId: string;
  kind: "vm" | "lxc";
  items: Guest[];
  guests: GuestScope[];
  onToggle: (scope: GuestScope, on: boolean) => void;
}) {
  if (!items.length) return null;
  return (
    <div className="mb-2 grid gap-1">
      {items.map((g) => {
        const scope: GuestScope = { hostId, kind, vmid: g.vmid };
        const checked = guests.some((x) => guestScopeKey(x) === guestScopeKey(scope));
        return (
          <label key={`${kind}-${g.vmid}`} className="flex items-center gap-2">
            <input type="checkbox" checked={checked} onChange={(e) => onToggle(scope, e.target.checked)} />
            <span>
              {kind.toUpperCase()} {g.vmid}
              <span className="text-muted-foreground"> · {g.name}</span>
            </span>
          </label>
        );
      })}
    </div>
  );
}

export function guestNameMap(
  inventory: Array<{ host: { id: string }; vms: Guest[]; containers: Guest[] }> | undefined,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const block of inventory ?? []) {
    for (const g of block.vms) out[guestScopeKey({ hostId: block.host.id, kind: "vm", vmid: g.vmid })] = g.name;
    for (const g of block.containers) out[guestScopeKey({ hostId: block.host.id, kind: "lxc", vmid: g.vmid })] = g.name;
  }
  return out;
}
