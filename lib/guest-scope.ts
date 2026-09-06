export type GuestScope = {
  hostId: string;
  kind: "vm" | "lxc";
  vmid: number;
};

export type AccessScope = {
  allowedHostIds: string[] | null;
  allowedGuests: GuestScope[] | null;
};

export type HostAccessGrant = {
  hostId: string;
  permissions?: string[];
  override?: boolean;
};

export type GuestAccessGrant = {
  hostId: string;
  kind: string;
  vmid: number;
};

export function sessionScopeFromGrants(
  hostAccess: HostAccessGrant[],
  guestAccess: GuestAccessGrant[],
): AccessScope & { hostPermissions: Record<string, string[] | null> | null } {
  const guests: GuestScope[] = guestAccess.flatMap((row) => {
    const kind = parseGuestKind(row.kind);
    return kind ? [{ hostId: row.hostId, kind, vmid: row.vmid }] : [];
  });
  const hostFromAccess = hostAccess.map((h) => h.hostId);
  const hostFromGuests = guests.map((g) => g.hostId);
  let allowedHostIds: string[] | null = null;
  if (hostFromAccess.length > 0) allowedHostIds = [...new Set(hostFromAccess)];
  else if (hostFromGuests.length > 0) allowedHostIds = [...new Set(hostFromGuests)];

  const hostPermissions: Record<string, string[] | null> = {};
  for (const row of hostAccess) {
    hostPermissions[row.hostId] = row.override ? [...(row.permissions ?? [])] : null;
  }
  for (const hostId of hostFromGuests) {
    if (!(hostId in hostPermissions)) hostPermissions[hostId] = null;
  }

  return {
    allowedHostIds,
    allowedGuests: guests.length ? guests : null,
    hostPermissions: Object.keys(hostPermissions).length ? hostPermissions : null,
  };
}

/** Empty host+guest grants mean "all hosts" only when the role can see hosts. */
export function lockHostsWithoutHostView(
  allowedHostIds: string[] | null,
  hasHostView: boolean,
): string[] | null {
  if (allowedHostIds === null && !hasHostView) return [];
  return allowedHostIds;
}

export function parseGuestKind(value: string): GuestScope["kind"] | null {
  return value === "vm" || value === "lxc" ? value : null;
}

export function guestScopeKey(scope: GuestScope): string {
  return `${scope.hostId}:${scope.kind}:${scope.vmid}`;
}

export function canAccessHost(user: AccessScope, hostId: string): boolean {
  if (user.allowedHostIds === null) return true;
  return user.allowedHostIds.includes(hostId);
}

export function canAccessGuest(user: AccessScope, hostId: string, kind: GuestScope["kind"], vmid: number): boolean {
  if (!canAccessHost(user, hostId)) return false;
  if (user.allowedGuests === null) return true;
  return user.allowedGuests.some((g) => g.hostId === hostId && g.kind === kind && g.vmid === vmid);
}

export function filterGuestsForUser<T extends { vmid: number }>(
  user: AccessScope,
  hostId: string,
  kind: GuestScope["kind"],
  items: T[],
): T[] {
  if (!canAccessHost(user, hostId)) return [];
  if (user.allowedGuests === null) return items;
  const allowed = new Set(
    user.allowedGuests.filter((g) => g.hostId === hostId && g.kind === kind).map((g) => g.vmid),
  );
  return items.filter((item) => allowed.has(item.vmid));
}
