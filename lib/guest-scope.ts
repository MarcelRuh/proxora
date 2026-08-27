export type GuestScope = {
  hostId: string;
  kind: "vm" | "lxc";
  vmid: number;
};

export type AccessScope = {
  allowedHostIds: string[] | null;
  allowedGuests: GuestScope[] | null;
};

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
