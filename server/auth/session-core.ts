import { ForbiddenError, NotFoundError } from "@/lib/errors";
import { prisma } from "@/lib/db";
import { randomToken, sha256 } from "@/lib/crypto";
import { canAccessGuest, canAccessHost, lockHostsWithoutHostView, sessionScopeFromGrants, type GuestScope } from "@/lib/guest-scope";
import { hasPermission, sanitizePermissions } from "@/lib/permissions";
import { ensureSystemRoles } from "@/server/services/role-sync";

export { canAccessGuest, canAccessHost, filterGuestsForUser } from "@/lib/guest-scope";

export { hashPassword, verifyPassword } from "@/lib/password";

export type SessionUser = {
  id: string;
  username: string;
  email: string;
  role: {
    id: string;
    slug: string;
    name: string;
    permissions: string[];
  };
  allowedHostIds: string[] | null;
  allowedGuests: GuestScope[] | null;
  hostPermissions: Record<string, string[] | null> | null;
  guestPermissions: Record<string, string[] | null> | null;
};

export type AuthSession = {
  id: string;
  user: SessionUser;
  expiresAt: Date;
};

type SessionUserSource = {
  id: string;
  username: string;
  email: string;
  role: { id: string; slug: string; name: string; permissions: string[] };
  hostAccess: Array<{ hostId: string; permissions?: string[]; override?: boolean }>;
  guestAccess: Array<{ hostId: string; kind: string; vmid: number; permissions?: string[]; override?: boolean }>;
};

export function toSessionUser(user: SessionUserSource): SessionUser {
  const scope = sessionScopeFromGrants(user.hostAccess, user.guestAccess);
  const hostPermissions = scope.hostPermissions
    ? Object.fromEntries(
        Object.entries(scope.hostPermissions).map(([hostId, granted]) => [
          hostId,
          granted ? sanitizePermissions(granted) : null,
        ]),
      )
    : null;
  const guestPermissions = scope.guestPermissions
    ? Object.fromEntries(
        Object.entries(scope.guestPermissions).map(([key, granted]) => [
          key,
          granted ? sanitizePermissions(granted) : null,
        ]),
      )
    : null;
  return {
    id: user.id,
    username: user.username,
    email: user.email,
    role: {
      id: user.role.id,
      slug: user.role.slug,
      name: user.role.name,
      permissions: user.role.permissions,
    },
    allowedHostIds: lockHostsWithoutHostView(
      scope.allowedHostIds,
      hasPermission(user.role.permissions, "hosts.view"),
    ),
    allowedGuests: scope.allowedGuests,
    hostPermissions,
    guestPermissions,
  };
}

export function sessionDays(): number {
  const n = Number(process.env.SESSION_DAYS ?? 7);
  return Number.isFinite(n) && n > 0 ? Math.min(365, n) : 7;
}

export async function createSession(userId: string, ip?: string, userAgent?: string) {
  const token = randomToken(32);
  const expiresAt = new Date(Date.now() + sessionDays() * 24 * 60 * 60 * 1000);
  await prisma.session.create({
    data: {
      userId,
      tokenHash: sha256(token),
      ip,
      userAgent,
      expiresAt,
    },
  });
  return { token, expiresAt };
}

export async function destroySession(token: string) {
  await prisma.session.deleteMany({ where: { tokenHash: sha256(token) } });
}

export async function destroyUserSessions(userId: string, exceptId?: string) {
  await prisma.session.deleteMany({
    where: exceptId ? { userId, id: { not: exceptId } } : { userId },
  });
}

export async function getSessionFromToken(token: string | undefined | null): Promise<AuthSession | null> {
  if (!token) return null;
  await ensureSystemRoles();
  const record = await prisma.session.findUnique({
    where: { tokenHash: sha256(token) },
    include: {
      user: {
        include: {
          role: true,
          hostAccess: true,
          guestAccess: true,
        },
      },
    },
  });
  if (!record || record.expiresAt < new Date()) {
    if (record) {
      await prisma.session.delete({ where: { id: record.id } }).catch(() => undefined);
    }
    return null;
  }
  if (record.user.status !== "ACTIVE") return null;

  return {
    id: record.id,
    user: toSessionUser(record.user),
    expiresAt: record.expiresAt,
  };
}

export function assertHostAccess(user: SessionUser, hostId: string) {
  if (!canAccessHost(user, hostId)) {
    throw new ForbiddenError("You are not allowed to access this host");
  }
}

export function assertGuestAccess(user: SessionUser, hostId: string, kind: "vm" | "lxc", vmid: number) {
  if (!canAccessGuest(user, hostId, kind, vmid)) {
    throw new NotFoundError(kind === "vm" ? "VM not found" : "Container not found");
  }
}

export function cookieSecure(
  appUrl = process.env.APP_URL,
  override = process.env.COOKIE_SECURE,
): boolean {
  if (override === "true") return true;
  if (override === "false") return false;
  return (appUrl ?? "").trim().toLowerCase().startsWith("https://");
}

export function sessionCookieMaxAgeSeconds(expiresAt: Date, now = Date.now()): number {
  return Math.max(0, Math.floor((expiresAt.getTime() - now) / 1000));
}

export function sessionCookieOptions(expiresAt: Date) {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: cookieSecure(),
    path: "/",
    expires: expiresAt,
    maxAge: sessionCookieMaxAgeSeconds(expiresAt),
  };
}
