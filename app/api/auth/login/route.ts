import { NextRequest } from "next/server";
import { cookies } from "next/headers";
import { z } from "zod";
import { AUDIT_ACTIONS } from "@/lib/audit-actions";
import { SESSION_COOKIE } from "@/lib/env";
import { prisma } from "@/lib/db";
import { json, handleRouteError, assertSameOrigin } from "@/server/http/respond";
import { rateLimit } from "@/server/http/rate-limit";
import {
  clientIp,
  clientUserAgent,
  createSession,
  destroySession,
  getSession,
  sessionCookieOptions,
} from "@/server/auth/session";
import { verifyPassword } from "@/lib/password";
import { writeAuditLog } from "@/server/services/audit-service";
import { decryptSecret } from "@/lib/crypto";
import { createTotpTicket, readTotpTicket, verifyTotp } from "@/lib/totp";

const loginSchema = z.object({
  username: z.string().min(1).optional(),
  password: z.string().min(1).optional(),
  ticket: z.string().min(1).optional(),
  totp: z.string().min(6).optional(),
});

export async function POST(request: NextRequest) {
  try {
    assertSameOrigin(request);
    const ip = await clientIp();
    if (!rateLimit(`login:${ip ?? "unknown"}`, 8, 15 * 60 * 1000)) {
      return json({ error: "Too many login attempts", code: "RATE_LIMITED" }, 429);
    }
    const body = loginSchema.parse(await request.json());

    if (body.ticket && body.totp) {
      const ticket = readTotpTicket(body.ticket);
      const user = await prisma.user.findUnique({
        where: { id: ticket.userId },
        include: { role: true, hostAccess: true },
      });
      if (!user || user.status !== "ACTIVE" || !user.totpEnabled || !user.totpSecret) {
        return json({ error: "Invalid username or password", code: "INVALID_CREDENTIALS" }, 401);
      }
      let secret: string;
      try {
        secret = decryptSecret(user.totpSecret);
      } catch {
        return json({ error: "Invalid 2FA code", code: "INVALID_TOTP" }, 401);
      }
      if (!verifyTotp(secret, body.totp)) {
        await writeAuditLog({
          userId: user.id,
          ip,
          action: AUDIT_ACTIONS.LOGIN_FAILED,
          target: user.username,
          result: "FAILURE",
          error: "Invalid TOTP",
        });
        return json({ error: "Invalid 2FA code", code: "INVALID_TOTP" }, 401);
      }
      return finishLogin(user, ip);
    }

    if (!body.username || !body.password) {
      return json({ error: "Username and password are required", code: "VALIDATION_ERROR" }, 400);
    }

    const user = await prisma.user.findUnique({
      where: { username: body.username },
      include: { role: true, hostAccess: true },
    });
    const valid = user ? await verifyPassword(body.password, user.passwordHash) : false;
    if (!user || !valid || user.status !== "ACTIVE") {
      await writeAuditLog({
        userId: user?.id,
        ip,
        action: AUDIT_ACTIONS.LOGIN_FAILED,
        target: body.username,
        result: "FAILURE",
        error: "Invalid credentials",
      });
      return json({ error: "Invalid username or password", code: "INVALID_CREDENTIALS" }, 401);
    }
    if (user.totpEnabled) {
      return json({ totpRequired: true, ticket: createTotpTicket(user.id) });
    }
    return finishLogin(user, ip);
  } catch (error) {
    return handleRouteError(error);
  }
}

async function finishLogin(
  user: {
    id: string;
    username: string;
    email: string;
    role: { slug: string; name: string; permissions: string[] };
    hostAccess: Array<{ hostId: string }>;
  },
  ip: string | undefined,
) {
  const { token, expiresAt } = await createSession(user.id, ip, await clientUserAgent());
  await prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
  await writeAuditLog({
    userId: user.id,
    ip,
    action: AUDIT_ACTIONS.LOGIN_SUCCESS,
    target: user.username,
    result: "SUCCESS",
  });
  const store = await cookies();
  store.set(SESSION_COOKIE, token, sessionCookieOptions(expiresAt));
  return json({
    user: {
      id: user.id,
      username: user.username,
      email: user.email,
      role: { slug: user.role.slug, name: user.role.name, permissions: user.role.permissions },
      allowedHostIds: user.hostAccess.length ? user.hostAccess.map((h) => h.hostId) : null,
    },
  });
}

export async function GET() {
  try {
    const session = await getSession();
    if (!session) return json({ user: null }, 200);
    return json({ user: session.user });
  } catch (error) {
    return handleRouteError(error);
  }
}

export async function DELETE(request: NextRequest) {
  try {
    assertSameOrigin(request);
    const store = await cookies();
    const token = store.get(SESSION_COOKIE)?.value;
    const session = await getSession();
    if (token) await destroySession(token);
    store.delete(SESSION_COOKIE);
    if (session) {
      await writeAuditLog({
        userId: session.user.id,
        ip: await clientIp(),
        action: AUDIT_ACTIONS.LOGOUT,
        target: session.user.username,
        result: "SUCCESS",
      });
    }
    return json({ ok: true });
  } catch (error) {
    return handleRouteError(error);
  }
}
