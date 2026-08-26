import { listHosts } from "@/server/services/host-service";
import { apiRoute } from "@/server/http/api-route";
import { json } from "@/server/http/respond";
import { prisma } from "@/lib/db";

export const GET = apiRoute("tasks.view", async (_req, session) => {
  const hosts = await listHosts(session.user);
  const jobs = await prisma.job.findMany({
    orderBy: { createdAt: "desc" },
    take: 50,
    include: { host: { select: { name: true } } },
  });
  return json({ hosts, jobs });
});
