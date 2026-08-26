import type { NextRequest } from "next/server";
import type { Permission } from "@/lib/permissions";
import type { AuthSession } from "@/server/auth/session";
import { requirePermission, requireSession } from "@/server/auth/session";
import { assertSameOrigin, handleRouteError } from "@/server/http/respond";

type Ctx = { params?: Promise<Record<string, string>> };

export function apiRoute(
  permission: Permission | Permission[] | null,
  handler: (request: NextRequest, session: AuthSession, params: Record<string, string>) => Promise<Response>,
) {
  return async (request: NextRequest, ctx?: Ctx) => {
    try {
      assertSameOrigin(request);
      const session = Array.isArray(permission)
        ? await requireAny(permission)
        : permission
          ? await requirePermission(permission)
          : await requireSession();
      const params = ctx?.params ? await ctx.params : {};
      return await handler(request, session, params);
    } catch (error) {
      return handleRouteError(error);
    }
  };
}

async function requireAny(permissions: Permission[]) {
  const session = await requireSession();
  const granted = session.user.role.permissions;
  if (!permissions.some((p) => granted.includes(p))) {
    const { ForbiddenError } = await import("@/lib/errors");
    throw new ForbiddenError();
  }
  return session;
}
