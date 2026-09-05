import type { NextRequest } from "next/server";
import type { Permission } from "@/lib/permissions";
import type { AuthSession } from "@/server/auth/session";
import { requireSession } from "@/server/auth/session";
import { userHasAnyPermission } from "@/lib/permissions";
import { assertSameOrigin, handleRouteError } from "@/server/http/respond";
import { ForbiddenError } from "@/lib/errors";

type Ctx = { params?: Promise<Record<string, string>> };

export function hostIdFromApiPath(pathname: string, params: Record<string, string>): string | undefined {
  const m = /^\/api\/hosts\/([^/]+)/.exec(pathname);
  if (!m) return undefined;
  const raw = m[1] ?? "";
  if (!raw || raw === "test") return undefined;
  return params.id ?? decodeURIComponent(raw);
}

export function apiRoute(
  permission: Permission | Permission[] | null,
  handler: (request: NextRequest, session: AuthSession, params: Record<string, string>) => Promise<Response>,
) {
  return async (request: NextRequest, ctx?: Ctx) => {
    try {
      assertSameOrigin(request);
      const session = await requireSession();
      const params = ctx?.params ? await ctx.params : {};
      if (permission) {
        const needed = Array.isArray(permission) ? permission : [permission];
        const hostId = hostIdFromApiPath(new URL(request.url).pathname, params);
        if (!userHasAnyPermission(session.user, needed, hostId)) {
          throw new ForbiddenError();
        }
      }
      return await handler(request, session, params);
    } catch (error) {
      return handleRouteError(error);
    }
  };
}
