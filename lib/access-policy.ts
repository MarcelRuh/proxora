import { ForbiddenError, ValidationError } from "@/lib/errors";
import { expandPermissions, sanitizePermissions } from "@/lib/permissions";
import type { GuestScope } from "@/lib/guest-scope";

export const SUPER_ADMIN_SLUG = "super-admin";

/** The parts of a session user that decide what they may hand out to others. */
export type GrantingActor = {
  id: string;
  role: { slug: string; permissions: readonly string[] };
  allowedHostIds: string[] | null;
  allowedGuests: GuestScope[] | null;
};

export function isSuperAdminRole(role: { slug: string } | null | undefined): boolean {
  return role?.slug === SUPER_ADMIN_SLUG;
}

/** Permissions in `requested` that the actor's own role does not hold. */
export function permissionsBeyondActor(actor: GrantingActor, requested: readonly string[]): string[] {
  const own = expandPermissions(actor.role.permissions);
  return sanitizePermissions(requested).filter((p) => !own.has(p));
}

export function assertCanGrantPermissions(actor: GrantingActor, requested: readonly string[]) {
  const missing = permissionsBeyondActor(actor, requested);
  if (missing.length) {
    throw new ForbiddenError(`You cannot grant permissions you do not hold: ${missing.join(", ")}`);
  }
}

/** Only the permissions newly added on top of `current` must be held by the actor. */
export function assertCanAddPermissions(
  actor: GrantingActor,
  current: readonly string[],
  next: readonly string[],
) {
  const existing = expandPermissions(current);
  assertCanGrantPermissions(
    actor,
    sanitizePermissions(next).filter((p) => !existing.has(p)),
  );
}

export type ScopeGrantInput = {
  hosts: Array<{ hostId: string }>;
  guests: Array<{ hostId: string; kind: "vm" | "lxc"; vmid: number }>;
};

/**
 * A host- or guest-scoped actor may only hand out access inside their own scope,
 * and may not create unscoped users (empty grants mean "every host").
 */
export function assertScopeWithinActor(actor: GrantingActor, scope: ScopeGrantInput) {
  if (actor.allowedHostIds === null && actor.allowedGuests === null) return;
  if (!scope.hosts.length && !scope.guests.length) {
    throw new ForbiddenError("You cannot grant access to all hosts");
  }
  const hosts = new Set(actor.allowedHostIds ?? []);
  for (const h of scope.hosts) {
    if (actor.allowedGuests !== null || !hosts.has(h.hostId)) {
      throw new ForbiddenError("You cannot grant access to hosts outside your own scope");
    }
  }
  for (const g of scope.guests) {
    const inScope =
      actor.allowedGuests === null
        ? hosts.has(g.hostId)
        : actor.allowedGuests.some((a) => a.hostId === g.hostId && a.kind === g.kind && a.vmid === g.vmid);
    if (!inScope) throw new ForbiddenError("You cannot grant access to guests outside your own scope");
  }
}

export type UserChangeTarget = {
  id: string;
  status: "ACTIVE" | "DISABLED";
  role: { slug: string };
};

export type UserChange = {
  roleSlug?: string;
  status?: "ACTIVE" | "DISABLED";
};

/** Super-admin users may only be changed or deleted by another super-admin. */
export function assertCanModifyUser(actor: GrantingActor, target: UserChangeTarget) {
  if (isSuperAdminRole(target.role) && !isSuperAdminRole(actor.role)) {
    throw new ForbiddenError("Only a super-admin can modify a super-admin account");
  }
}

/** True when the change takes an active super-admin out of that set. */
export function removesActiveSuperAdmin(target: UserChangeTarget, change: UserChange | "delete"): boolean {
  if (target.status !== "ACTIVE" || !isSuperAdminRole(target.role)) return false;
  if (change === "delete") return true;
  if (change.status === "DISABLED") return true;
  return change.roleSlug !== undefined && change.roleSlug !== SUPER_ADMIN_SLUG;
}

export function assertUserChangeAllowed(
  actor: GrantingActor,
  target: UserChangeTarget,
  change: UserChange | "delete",
  otherActiveSuperAdmins: number,
) {
  assertCanModifyUser(actor, target);
  if (change !== "delete" && change.status === "DISABLED" && actor.id === target.id) {
    throw new ValidationError("You cannot disable your own account");
  }
  if (removesActiveSuperAdmin(target, change) && otherActiveSuperAdmins < 1) {
    throw new ValidationError("At least one active super-admin must remain");
  }
}
