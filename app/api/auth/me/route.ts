import { json, handleRouteError } from "@/server/http/respond";
import { getSession } from "@/server/auth/session";

export async function GET() {
  try {
    const session = await getSession();
    if (!session) return json({ user: null }, 401);
    return json({ user: session.user });
  } catch (error) {
    return handleRouteError(error);
  }
}
