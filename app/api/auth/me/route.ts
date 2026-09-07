import { json, handleRouteError } from "@/server/http/respond";
import { getSession } from "@/server/auth/session";
import { sessionCookieMaxAgeSeconds } from "@/server/auth/session-core";

export async function GET() {
  try {
    const session = await getSession();
    if (!session) return json({ user: null }, 401);
    return json({
      user: session.user,
      expiresAt: session.expiresAt.toISOString(),
      cookieMaxAge: sessionCookieMaxAgeSeconds(session.expiresAt),
    });
  } catch (error) {
    return handleRouteError(error);
  }
}
