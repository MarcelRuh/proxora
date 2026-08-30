import { NextRequest } from "next/server";
import { cookies } from "next/headers";
import { AUDIT_ACTIONS } from "@/lib/audit-actions";
import { SESSION_COOKIE } from "@/lib/env";
import { json, handleRouteError, assertSameOrigin } from "@/server/http/respond";
import { clientIp, destroySession, getSession } from "@/server/auth/session";
import { writeAuditLog } from "@/server/services/audit-service";

export async function POST(request: NextRequest) {
  try {
    assertSameOrigin(request);
    const store = await cookies();
    const token = store.get(SESSION_COOKIE)?.value;
    const session = await getSession();
    if (token) await destroySession(token);
    store.delete({ name: SESSION_COOKIE, path: "/" });
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
