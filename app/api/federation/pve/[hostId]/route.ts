import { z } from "zod";
import { handleRouteError, json } from "@/server/http/respond";
import { assertSharedHost, proxyPveRequest, requireFederationPeer } from "@/server/services/federation-service";

const bodySchema = z.object({
  method: z.string().min(1),
  path: z.string().min(1),
  query: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])).optional(),
  body: z.record(z.string(), z.unknown()).nullable().optional(),
});

export async function POST(request: Request, ctx: { params: Promise<{ hostId: string }> }) {
  try {
    const peer = await requireFederationPeer(request);
    const { hostId } = await ctx.params;
    const payload = bodySchema.parse(await request.json());
    const host = await assertSharedHost(peer, hostId, payload.method, payload.path);
    const query: Record<string, string> = {};
    for (const [key, value] of Object.entries(payload.query ?? {})) {
      query[key] = String(value);
    }
    const data = await proxyPveRequest(
      host,
      payload.method,
      payload.path,
      query,
      (payload.body ?? undefined) as Record<string, unknown> | undefined,
    );
    return json({ data });
  } catch (error) {
    return handleRouteError(error);
  }
}
