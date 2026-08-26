import { cookies, headers } from "next/headers";
import { SESSION_COOKIE } from "@/lib/env";
import { ForbiddenError, UnauthorizedError } from "@/lib/errors";
import type { Permission } from "@/lib/permissions";
import { hasPermission } from "@/lib/permissions";
import {
  getSessionFromToken,
  type AuthSession,
} from "@/server/auth/session-core";

export {
  assertHostAccess,
  canAccessHost,
  createSession,
  destroySession,
  getSessionFromToken,
  hashPassword,
  sessionCookieOptions,
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
  if (!hasPermission(session.user.role.permissions, permission)) {
    throw new ForbiddenError();
  }
  return session;
}

export async function clientIp(): Promise<string | undefined> {
  const h = await headers();
  return h.get("x-forwarded-for")?.split(",")[0]?.trim() ?? h.get("x-real-ip") ?? undefined;
}

export async function clientUserAgent(): Promise<string | undefined> {
  const h = await headers();
  return h.get("user-agent") ?? undefined;
}
