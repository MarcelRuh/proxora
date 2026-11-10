import { cookies, headers } from "next/headers";
import { SESSION_COOKIE } from "@/lib/env";
import { ForbiddenError, UnauthorizedError } from "@/lib/errors";
import { userHasPermission, type Permission } from "@/lib/permissions";
import { PEER_IP_HEADER, resolveClientIp } from "@/server/http/client-ip";
import {
  getSessionFromToken,
  type AuthSession,
} from "@/server/auth/session-core";

export {
  assertGuestAccess,
  assertHostAccess,
  canAccessGuest,
  canAccessHost,
  createSession,
  destroySession,
  destroyUserSessions,
  filterGuestsForUser,
  getSessionFromToken,
  hashPassword,
  sessionCookieOptions,
  sessionDays,
  verifyPassword,
} from "@/server/auth/session-core";
export type { AuthSession, SessionUser } from "@/server/auth/session-core";

export async function getSession(): Promise<AuthSession | null> {
  const store = await cookies();
  return getSessionFromToken(store.get(SESSION_COOKIE)?.value);
}

export async function requireSession(): Promise<AuthSession> {
  const session = await getSession();
  if (!session) throw new UnauthorizedError();
  return session;
}

export async function requirePermission(permission: Permission): Promise<AuthSession> {
  const session = await requireSession();
  if (!userHasPermission(session.user, permission)) {
    throw new ForbiddenError();
  }
  return session;
}

/** See server/http/client-ip.ts: forwarded headers only count with TRUST_PROXY. */
export async function clientIp(): Promise<string | undefined> {
  const h = await headers();
  return resolveClientIp((name) => h.get(name), h.get(PEER_IP_HEADER));
}

export async function clientUserAgent(): Promise<string | undefined> {
  const h = await headers();
  return h.get("user-agent") ?? undefined;
}
