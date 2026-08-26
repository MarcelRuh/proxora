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

const loginSchema = z.object({
  username: z.string().min(1),
  password: z.string().min(1),
});

export async function POST(request: NextRequest) {
  try {
    assertSameOrigin(request);
    const ip = await clientIp();
    if (!rateLimit(`login:${ip ?? "unknown"}`, 8, 15 * 60 * 1000)) {
      return json({ error: "Too many login attempts", code: "RATE_LIMITED" }, 429);
    }
    const body = loginSchema.parse(await request.json());
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
  } catch (error) {
    return handleRouteError(error);
  }
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
