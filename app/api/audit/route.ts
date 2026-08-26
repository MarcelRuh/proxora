import { apiRoute } from "@/server/http/api-route";
import { json } from "@/server/http/respond";
import { prisma } from "@/lib/db";

export const GET = apiRoute("audit.view", async (req) => {
  const url = new URL(req.url);
  const take = Math.min(200, Number(url.searchParams.get("take") ?? 50));
  const cursor = url.searchParams.get("cursor") ?? undefined;
  const logs = await prisma.auditLog.findMany({
    take,
    ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
    orderBy: { createdAt: "desc" },
    include: {
      user: { select: { username: true } },
      host: { select: { name: true } },
    },
  });
  return json({ logs });
});
