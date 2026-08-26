import { ForbiddenError } from "@/lib/errors";
import { prisma } from "@/lib/db";
import { randomToken, sha256 } from "@/lib/crypto";

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

export async function getSessionFromToken(token: string | undefined | null): Promise<AuthSession | null> {
  if (!token) return null;
  const record = await prisma.session.findUnique({
    where: { tokenHash: sha256(token) },
    include: {
      user: {
        include: {
          role: true,
          hostAccess: true,
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

  const allowedHostIds =
    record.user.hostAccess.length > 0 ? record.user.hostAccess.map((h) => h.hostId) : null;

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
    },
  };
}

export function canAccessHost(user: SessionUser, hostId: string): boolean {
  if (user.allowedHostIds === null) return true;
  return user.allowedHostIds.includes(hostId);
}

export function assertHostAccess(user: SessionUser, hostId: string) {
  if (!canAccessHost(user, hostId)) {
    throw new ForbiddenError("You are not allowed to access this host");
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
