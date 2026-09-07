import { prisma } from "@/lib/db";
import { apiRoute } from "@/server/http/api-route";
import { json } from "@/server/http/respond";
import { sessionCookieMaxAgeSeconds } from "@/server/auth/session-core";

export const GET = apiRoute(null, async (_req, session) => {
  const rows = await prisma.session.findMany({
    where: { userId: session.user.id, expiresAt: { gt: new Date() } },
    orderBy: { createdAt: "desc" },
    select: { id: true, ip: true, userAgent: true, createdAt: true, expiresAt: true },
  });
  return json({
    cookieMaxAge: sessionCookieMaxAgeSeconds(session.expiresAt),
    sessions: rows.map((row) => ({
      id: row.id,
      ip: row.ip,
      userAgent: row.userAgent,
      createdAt: row.createdAt.toISOString(),
      expiresAt: row.expiresAt.toISOString(),
      current: row.id === session.id,
    })),
  });
});
