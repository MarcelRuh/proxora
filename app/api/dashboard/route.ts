import { apiRoute } from "@/server/http/api-route";
import { json } from "@/server/http/respond";
import { getDashboard } from "@/server/services/dashboard-service";
import { prisma } from "@/lib/db";

export const GET = apiRoute("hosts.view", async (_req, session) => {
  const dashboard = await getDashboard(session.user);
  const activity = await prisma.auditLog.findMany({
    orderBy: { createdAt: "desc" },
    take: 12,
    include: { user: { select: { username: true } }, host: { select: { name: true } } },
  });
  return json({ ...dashboard, activity });
});
