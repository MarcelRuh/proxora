"use client";

import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import type { PublicHost } from "@/lib/types";
import type { Guest } from "@/lib/types";
import type { GuestGrant, GuestScope } from "@/lib/guest-scope";
import { guestScopeKey } from "@/lib/guest-scope";
import { useI18n } from "@/components/i18n/locale-provider";
import { Button } from "@/components/ui/button";
import { RolePermissionPicker } from "@/components/access/role-permission-picker";
import {
  filesOnlyGuestPermissions,
  guestGrantCatalog,
  guestScopedFromRole,
  hostGrantCatalog,
  hostScopedFromRole,
} from "@/lib/permissions";

export type HostGrant = {
  hostId: string;
  permissions: string[] | null;
};

export function UserScopeFields({
  hosts: grants,
  guests,
  rolePermissions,
  roleSlug,
  onHosts,
  onGuests,
  onGuestNames,
}: {
  hosts: HostGrant[];
  guests: GuestGrant[];
  rolePermissions?: readonly string[];
  roleSlug?: string;
  onHosts: (next: HostGrant[]) => void;
  onGuests: (next: GuestGrant[]) => void;
  onGuestNames?: (names: Record<string, string>) => void;
}) {
  const { t } = useI18n();
  const { data } = useQuery({
    queryKey: ["hosts"],
    queryFn: () => api<{ hosts: PublicHost[] }>("/api/hosts"),
  });
  const allHosts = data?.hosts ?? [];
  const hostIds = grants.map((g) => g.hostId);
  const listed = hostIds.length ? allHosts.filter((h) => hostIds.includes(h.id)) : allHosts;
  const [openHost, setOpenHost] = useState<string | null>(null);
  const [openGuestHost, setOpenGuestHost] = useState<string | null>(null);
  const [openGuest, setOpenGuest] = useState<string | null>(null);
  const guestHostIds = [...new Set([...guests.map((g) => g.hostId), ...(openGuestHost ? [openGuestHost] : [])])].sort();
  const { data: inventory } = useQuery({
    queryKey: ["scope-guests", guestHostIds],
    enabled: guestHostIds.length > 0 && allHosts.length > 0,
    queryFn: async () => {
      return Promise.all(
        guestHostIds.map(async (id) => {
          const host = allHosts.find((h) => h.id === id) ?? { id, name: id };
          const row = await api<{ vms: Guest[]; containers: Guest[] }>(`/api/hosts/${id}/guests`).catch(() => ({
            vms: [] as Guest[],
            containers: [] as Guest[],
          }));
          return { host, vms: row.vms, containers: row.containers };
        }),
      );
    },
    staleTime: 30_000,
  });

  useEffect(() => {
    if (inventory) onGuestNames?.(guestNameMap(inventory));
  }, [inventory]);

  function grantFor(id: string): HostGrant | undefined {
    return grants.find((g) => g.hostId === id);
  }

  function toggleHost(id: string, on: boolean) {
    if (on) {
      onHosts([...grants, { hostId: id, permissions: null }]);
      return;
    }
    onHosts(grants.filter((g) => g.hostId !== id));
    onGuests(guests.filter((g) => g.hostId !== id));
    if (openHost === id) setOpenHost(null);
  }

  function setOverride(id: string, on: boolean) {
    onHosts(
      grants.map((g) =>
        g.hostId === id
          ? { hostId: id, permissions: on ? hostScopedFromRole(rolePermissions) : null }
          : g,
      ),
    );
    setOpenHost(on ? id : null);
  }

  function setHostPerms(id: string, permissions: string[]) {
    onHosts(grants.map((g) => (g.hostId === id ? { hostId: id, permissions } : g)));
  }

  function toggleGuest(scope: GuestScope, on: boolean) {
    const key = guestScopeKey(scope);
    if (on) {
      if (guests.some((g) => guestScopeKey(g) === key)) return;
      onGuests([...guests, { ...scope, permissions: null }]);
      if (roleSlug !== "nothing" && grants.length && !hostIds.includes(scope.hostId)) {
        onHosts([...grants, { hostId: scope.hostId, permissions: null }]);
      }
      return;
    }
    onGuests(guests.filter((g) => guestScopeKey(g) !== key));
    if (openGuest === key) setOpenGuest(null);
  }

  function patchGuest(scope: GuestScope, next: GuestGrant) {
    onGuests(guests.map((g) => (guestScopeKey(g) === guestScopeKey(scope) ? next : g)));
  }

  function setGuestOverride(scope: GuestScope, on: boolean) {
    patchGuest(scope, {
      ...scope,
      permissions: on ? guestScopedFromRole(scope.kind, rolePermissions) : null,
    });
    setOpenGuest(on ? guestScopeKey(scope) : null);
  }

  function setGuestFilesOnly(scope: GuestScope) {
    patchGuest(scope, { ...scope, permissions: filesOnlyGuestPermissions(scope.kind) });
    setOpenGuest(guestScopeKey(scope));
  }

  function setGuestPerms(scope: GuestScope, permissions: string[]) {
    patchGuest(scope, { ...scope, permissions });
  }

  return (
    <div className="space-y-4 text-sm">
      <div>
        <p className="mb-1 font-medium">{t("users.hosts")}</p>
        <p className="mb-2 text-xs text-muted-foreground">
          {roleSlug === "nothing" ? t("users.nothingHostsHint") : t("users.hostsHint")}
        </p>
        <div className="grid gap-2">
          {allHosts.map((h) => {
            const grant = grantFor(h.id);
            const checked = Boolean(grant);
            const custom = Boolean(grant && grant.permissions);
            const expanded = openHost === h.id && custom;
            return (
              <div key={h.id} className="rounded-[4px] border border-border p-2">
                <div className="flex flex-wrap items-center gap-2">
                  <label className="flex min-w-0 flex-1 items-center gap-2">
                    <input type="checkbox" checked={checked} onChange={(e) => toggleHost(h.id, e.target.checked)} />
                    <span className="truncate">{h.name}</span>
                  </label>
                  {checked ? (
                    <Button type="button" size="sm" variant="outline" onClick={() => setOverride(h.id, !custom)}>
                      {custom ? t("users.hostInherit") : t("users.hostCustomize")}
                    </Button>
                  ) : null}
                </div>
                {checked && custom ? (
                  <p className="mt-1 text-xs text-muted-foreground">
                    {t("users.hostOverrideMeta", { n: grant?.permissions?.length ?? 0 })}
                  </p>
                ) : null}
                {expanded ? (
                  <div className="mt-3 border-t border-border pt-3">
                    <RolePermissionPicker
                      catalog={hostGrantCatalog()}
                      value={grant?.permissions ?? []}
                      onChange={(permissions) => setHostPerms(h.id, permissions)}
                    />
                  </div>
                ) : custom && checked ? (
                  <Button type="button" size="sm" variant="ghost" className="mt-1" onClick={() => setOpenHost(h.id)}>
                    {t("users.hostEditPerms")}
                  </Button>
                ) : null}
              </div>
            );
          })}
        </div>
      </div>
      <div>
        <p className="mb-1 font-medium">{t("users.guests")}</p>
        <p className="mb-2 text-xs text-muted-foreground">
          {roleSlug === "nothing" ? t("users.nothingGuestsHint") : t("users.guestsHint")}
        </p>
        <div className="space-y-3">
          {listed.map((host) => {
            const loaded = inventory?.find((block) => block.host.id === host.id);
            const expanded = openGuestHost === host.id || guests.some((g) => g.hostId === host.id);
            return (
              <div key={host.id} className="rounded-[4px] border border-border p-2">
                <div className="mb-1 flex items-center justify-between gap-2">
                  <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">{host.name}</p>
                  {!expanded ? (
                    <Button type="button" size="sm" variant="outline" onClick={() => setOpenGuestHost(host.id)}>
                      {t("users.showGuests")}
                    </Button>
                  ) : null}
                </div>
                {expanded ? (
                  loaded ? (
                    <>
                      <GuestChecks
                        hostId={host.id}
                        kind="vm"
                        items={loaded.vms}
                        guests={guests}
                        openGuest={openGuest}
                        onToggle={toggleGuest}
                        onOverride={setGuestOverride}
                        onFilesOnly={setGuestFilesOnly}
                        onPerms={setGuestPerms}
                        onOpen={setOpenGuest}
                      />
                      <GuestChecks
                        hostId={host.id}
                        kind="lxc"
                        items={loaded.containers}
                        guests={guests}
                        openGuest={openGuest}
                        onToggle={toggleGuest}
                        onOverride={setGuestOverride}
                        onFilesOnly={setGuestFilesOnly}
                        onPerms={setGuestPerms}
                        onOpen={setOpenGuest}
                      />
                      {loaded.vms.length === 0 && loaded.containers.length === 0 ? (
                        <p className="text-xs text-muted-foreground">{t("users.noGuestsOnHost")}</p>
                      ) : null}
                    </>
                  ) : (
                    <p className="text-xs text-muted-foreground">{t("common.loading")}</p>
                  )
                ) : null}
              </div>
            );
          })}
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
  openGuest,
  onToggle,
  onOverride,
  onFilesOnly,
  onPerms,
  onOpen,
}: {
  hostId: string;
  kind: "vm" | "lxc";
  items: Guest[];
  guests: GuestGrant[];
  openGuest: string | null;
  onToggle: (scope: GuestScope, on: boolean) => void;
  onOverride: (scope: GuestScope, on: boolean) => void;
  onFilesOnly: (scope: GuestScope) => void;
  onPerms: (scope: GuestScope, permissions: string[]) => void;
  onOpen: (key: string | null) => void;
}) {
  const { t } = useI18n();
  if (!items.length) return null;
  return (
    <div className="mb-2 grid gap-2">
      {items.map((g) => {
        const scope: GuestScope = { hostId, kind, vmid: g.vmid };
        const key = guestScopeKey(scope);
        const grant = guests.find((x) => guestScopeKey(x) === key);
        const checked = Boolean(grant);
        const custom = Boolean(grant?.permissions);
        const expanded = openGuest === key && custom;
        return (
          <div key={`${kind}-${g.vmid}`} className="rounded-[4px] border border-border/70 p-2">
            <div className="flex flex-wrap items-center gap-2">
              <label className="flex min-w-0 flex-1 items-center gap-2">
                <input type="checkbox" checked={checked} onChange={(e) => onToggle(scope, e.target.checked)} />
                <span>
                  {kind.toUpperCase()} {g.vmid}
                  <span className="text-muted-foreground"> · {g.name}</span>
                </span>
              </label>
              {checked ? (
                <>
                  <Button type="button" size="sm" variant="outline" onClick={() => onFilesOnly(scope)}>
                    {t("users.guestFilesOnly")}
                  </Button>
                  <Button type="button" size="sm" variant="outline" onClick={() => onOverride(scope, !custom)}>
                    {custom ? t("users.hostInherit") : t("users.hostCustomize")}
                  </Button>
                </>
              ) : null}
            </div>
            {checked && custom ? (
              <p className="mt-1 text-xs text-muted-foreground">
                {t("users.hostOverrideMeta", { n: grant?.permissions?.length ?? 0 })}
              </p>
            ) : null}
            {expanded ? (
              <div className="mt-3 border-t border-border pt-3">
                <RolePermissionPicker
                  catalog={guestGrantCatalog(kind)}
                  value={grant?.permissions ?? []}
                  onChange={(permissions) => onPerms(scope, permissions)}
                />
              </div>
            ) : custom && checked ? (
              <Button type="button" size="sm" variant="ghost" className="mt-1" onClick={() => onOpen(key)}>
                {t("users.hostEditPerms")}
              </Button>
            ) : null}
          </div>
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
