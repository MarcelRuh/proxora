import { ForbiddenError, NotFoundError } from "@/lib/errors";
import { prisma } from "@/lib/db";
import { randomToken, sha256 } from "@/lib/crypto";
import type { GuestScope } from "@/lib/guest-scope";
import { parseGuestKind, canAccessGuest, canAccessHost } from "@/lib/guest-scope";
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
};

export type AuthSession = {
  id: string;
  user: SessionUser;
};

function sessionDays(): number {
  return Number(process.env.SESSION_DAYS ?? 7);
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

  const guests: GuestScope[] = record.user.guestAccess.flatMap((row) => {
    const kind = parseGuestKind(row.kind);
    return kind ? [{ hostId: row.hostId, kind, vmid: row.vmid }] : [];
  });
  const hostFromAccess = record.user.hostAccess.map((h) => h.hostId);
  const hostFromGuests = guests.map((g) => g.hostId);
  let allowedHostIds: string[] | null = null;
  if (hostFromAccess.length > 0) allowedHostIds = [...new Set(hostFromAccess)];
  else if (hostFromGuests.length > 0) allowedHostIds = [...new Set(hostFromGuests)];

  return {
    id: record.id,
    user: {
      id: record.user.id,
      username: record.user.username,
      email: record.user.email,
      role: {
        id: record.user.role.id,
        slug: record.user.role.slug,
        name: record.user.role.name,
        permissions: record.user.role.permissions,
      },
      allowedHostIds,
      allowedGuests: guests.length ? guests : null,
    },
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

export function sessionCookieOptions(expiresAt: Date) {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: cookieSecure(),
    path: "/",
    expires: expiresAt,
  };
}
